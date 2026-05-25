import { config } from '../../config';
import type { AccountDoc } from '../../db/models/Account';
import type { DialogSessionDoc } from '../../db/models/DialogSession';

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How far back (seconds) to scan Telegram on first / forced sync. */
export function inboundSyncLookbackSec(): number {
  return config.INBOUND_SYNC_LOOKBACK_SEC;
}

/** Min seconds between automatic inbound syncs for one sender account. */
export function inboundSyncIntervalSec(): number {
  return config.INBOUND_SYNC_INTERVAL_SEC;
}

/** Pause between each account sync in one scheduler tick. */
export function inboundSyncStaggerMs(): number {
  return config.INBOUND_SYNC_STAGGER_MS;
}

export function inboundSyncBatchPerTick(): number {
  return config.INBOUND_SYNC_BATCH_PER_TICK;
}

/** Min seconds between peer inbox polls while a dialog waits for a reply (floor). */
export function dialogPeerSyncIntervalSec(): number {
  return config.DIALOG_PEER_SYNC_INTERVAL_SEC;
}

/** Seconds between peer-reply Telegram polls after send (5 → 30 → 60 → 180). */
export function dialogPeerCheckDelaysSec(): number[] {
  return config.DIALOG_PEER_CHECK_DELAYS_SEC;
}

export function peerCheckDelaySec(attempt: number): number {
  const delays = dialogPeerCheckDelaysSec();
  const idx = Math.min(Math.max(0, attempt), delays.length - 1);
  return delays[idx] ?? delays[delays.length - 1] ?? 180;
}

export function nextPeerCheckAt(attempt: number, fromMs: number = Date.now()): Date {
  return new Date(fromMs + peerCheckDelaySec(attempt) * 1000);
}

/** Delay before re-checking a session in waiting_peer (queue / poll). */
export function dialogWaitPollMs(): number {
  return config.DIALOG_WAIT_POLL_MS;
}

/**
 * Whether a waiting dialog session may poll Telegram for a peer reply.
 * Uses `nextRunAt` from progressive backoff; manual step passes `force: true`.
 */
export function sessionDueForPeerCheck(
  session: DialogSessionDoc,
  opts?: { force?: boolean },
): boolean {
  if (opts?.force) return true;
  if (session.nextRunAt && session.nextRunAt.getTime() > Date.now()) return false;
  return sessionDueForPeerSync(session, opts);
}

/** Stagger between dialog sessions in one batch tick. */
export function dialogSessionStaggerMs(): number {
  return config.DIALOG_SESSION_STAGGER_MS;
}

/**
 * `sinceEpochSec` for list_incoming: only messages within the lookback window
 * (with a small overlap so edge messages are not missed).
 */
export function sinceEpochForInboundSync(
  account: AccountDoc,
  opts?: { sinceEpochSec?: number; lookbackSec?: number },
): number {
  if (opts?.sinceEpochSec !== undefined) {
    return Math.max(0, Math.floor(opts.sinceEpochSec));
  }
  const lookback = opts?.lookbackSec ?? inboundSyncLookbackSec();
  const overlap = 30;
  if (account.lastInboundSyncAt) {
    return Math.max(0, Math.floor(account.lastInboundSyncAt.getTime() / 1000) - overlap);
  }
  return Math.max(0, Math.floor(Date.now() / 1000) - lookback);
}

export function accountDueForInboundSync(
  account: AccountDoc,
  opts?: { force?: boolean; intervalSec?: number },
): boolean {
  if (opts?.force) return true;
  const intervalMs = (opts?.intervalSec ?? inboundSyncIntervalSec()) * 1000;
  const last = account.lastInboundSyncAt;
  if (!last) return true;
  return Date.now() - last.getTime() >= intervalMs;
}

export function sessionDueForPeerSync(
  session: DialogSessionDoc,
  opts?: { force?: boolean; intervalSec?: number },
): boolean {
  if (opts?.force) return true;
  if (session.nextRunAt && session.nextRunAt.getTime() > Date.now()) return false;
  const intervalMs = (opts?.intervalSec ?? dialogPeerSyncIntervalSec()) * 1000;
  const last = session.lastPeerSyncAt;
  if (!last) return true;
  return Date.now() - last.getTime() >= intervalMs;
}
