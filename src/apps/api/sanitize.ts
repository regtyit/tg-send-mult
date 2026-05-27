import { logger } from '../../logger';
import { describeSendingWindowAccount } from '../../modules/antilimit/window';
import { describeSenderEligibility, formatEligibilityReasons } from '../../modules/multi/senderEligibility';
import type { AccountDoc } from '../../db/models/Account';

/**
 * Strip sensitive fields from API responses.
 *
 * Account responses strip encrypted session blobs and `telegramApiHash`. Proxy
 * rows keep `secret` / `login` / `password` (Basic Auth dashboard); presence
 * flags are still added for convenience.
 *
 * Each sanitizer is shape-tolerant — it accepts plain objects (from `.lean()`),
 * Mongoose hydrated docs (via `toObject()`), and arrays of either.
 */

function plain(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') return null;
  const obj = input as { toObject?: () => Record<string, unknown> };
  if (typeof obj.toObject === 'function') return obj.toObject();
  return input as Record<string, unknown>;
}

const ACCOUNT_SENSITIVE_FIELDS = ['sessionEnc', 'telegramApiHash'] as const;

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0;
}

export function sanitizeAccount(doc: unknown): Record<string, unknown> | null {
  const obj = plain(doc);
  if (!obj) return null;
  const out: Record<string, unknown> = { ...obj };
  out.hasSession = nonEmptyString(obj.sessionEnc);
  out.hasTelegramApiHash = nonEmptyString(obj.telegramApiHash);
  const sw = obj.sendingWindow as AccountDoc['sendingWindow'] | undefined;
  if (sw && typeof sw === 'object') {
    out.sendingWindow = sw;
    try {
      const status = describeSendingWindowAccount({ sendingWindow: sw } as AccountDoc);
      out.sendingActiveNow = status.inWindow;
      if (!status.inWindow && status.quietUntil) {
        out.sendingQuietUntil = status.quietUntil;
      }
      if (status.resumesAtLocal) {
        out.sendingResumesAtLocal = status.resumesAtLocal;
      }
    } catch (err) {
      logger.warn({ err, accountId: obj._id }, 'api: sending window check failed; defaulting to unknown');
      out.sendingActiveNow = false;
      out.sendingQuietUntil = 'Could not evaluate quiet hours (check timezone / HH:MM)';
    }
  }
  try {
    const { eligible, reasons } = describeSenderEligibility({
      sessionEnc: typeof obj.sessionEnc === 'string' ? obj.sessionEnc : '',
      role: typeof obj.role === 'string' ? obj.role : 'sender',
      status: typeof obj.status === 'string' ? obj.status : 'new',
      healthScore: typeof obj.healthScore === 'number' ? obj.healthScore : 0,
      floodWaitUntil: obj.floodWaitUntil instanceof Date ? obj.floodWaitUntil : null,
      quarantineUntil: obj.quarantineUntil instanceof Date ? obj.quarantineUntil : null,
    });
    out.sendable = eligible;
    if (!eligible && reasons.length) {
      out.sendBlockReason = formatEligibilityReasons(reasons);
    }
  } catch (err) {
    logger.warn({ err, accountId: obj._id }, 'api: sender eligibility check failed');
    out.sendable = false;
    out.sendBlockReason = 'Could not evaluate send eligibility';
  }
  for (const key of ACCOUNT_SENSITIVE_FIELDS) {
    delete out[key];
  }
  return out;
}

export function sanitizeAccounts(docs: unknown): Record<string, unknown>[] {
  if (!Array.isArray(docs)) return [];
  const out: Record<string, unknown>[] = [];
  for (const d of docs) {
    try {
      const row = sanitizeAccount(d);
      if (row) out.push(row);
    } catch (err) {
      const obj = plain(d);
      logger.warn({ err, accountId: obj?._id }, 'api: skipped account in list (sanitize failed)');
    }
  }
  return out;
}

export function sanitizeProxy(doc: unknown): Record<string, unknown> | null {
  const obj = plain(doc);
  if (!obj) return null;
  const out: Record<string, unknown> = { ...obj };
  out.hasSecret = nonEmptyString(obj.secret);
  out.hasLogin = nonEmptyString(obj.login);
  out.hasPassword = nonEmptyString(obj.password);
  return out;
}

export function sanitizeProxies(docs: unknown): Record<string, unknown>[] {
  if (!Array.isArray(docs)) return [];
  return docs.map((d) => sanitizeProxy(d)).filter((x): x is Record<string, unknown> => x !== null);
}
