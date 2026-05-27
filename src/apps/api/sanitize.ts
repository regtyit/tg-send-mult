import { logger } from '../../logger';
import { isWithinSendingWindowAccount } from '../../modules/antilimit/window';
import { describeSenderEligibility, formatEligibilityReasons } from '../../modules/multi/senderEligibility';
import type { AccountDoc } from '../../db/models/Account';

/**
 * Strip sensitive fields from API responses.
 *
 * The API used to return full Mongoose docs, which include encrypted session
 * blobs, Telegram api_hash, and proxy credentials. Even though the dashboard
 * is gated by Basic Auth, leaking these values into browser caches, log files,
 * or third-party requests is unnecessary.
 *
 * Each sanitizer is shape-tolerant — it accepts plain objects (from `.lean()`),
 * Mongoose hydrated docs (via `toObject()`), and arrays of either. Fields are
 * replaced with a boolean presence flag so the UI can still display "session
 * attached" / "secret set" without the actual value.
 */

function plain(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') return null;
  const obj = input as { toObject?: () => Record<string, unknown> };
  if (typeof obj.toObject === 'function') return obj.toObject();
  return input as Record<string, unknown>;
}

const ACCOUNT_SENSITIVE_FIELDS = ['sessionEnc', 'telegramApiHash'] as const;
const PROXY_SENSITIVE_FIELDS = ['secret', 'login', 'password'] as const;

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
      const inWindow = isWithinSendingWindowAccount({ sendingWindow: sw } as AccountDoc);
      out.sendingActiveNow = inWindow;
      if (!inWindow) {
        out.sendingQuietUntil = `Outside local window ${sw.start}–${sw.end} (${sw.timezone})`;
      }
    } catch (err) {
      logger.warn({ err, accountId: obj._id }, 'api: sending window check failed; defaulting to unknown');
      out.sendingActiveNow = false;
      out.sendingQuietUntil = 'Could not evaluate quiet hours (check timezone / HH:MM)';
    }
  }
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
  for (const key of PROXY_SENSITIVE_FIELDS) {
    delete out[key];
  }
  return out;
}

export function sanitizeProxies(docs: unknown): Record<string, unknown>[] {
  if (!Array.isArray(docs)) return [];
  return docs.map((d) => sanitizeProxy(d)).filter((x): x is Record<string, unknown> => x !== null);
}
