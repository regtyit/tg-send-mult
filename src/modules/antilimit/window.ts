import type { AccountDoc } from '../../db/models/Account';
import type { CampaignDoc } from '../../db/models/Campaign';
import { logger } from '../../logger';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class InvalidTimeWindowError extends Error {
  constructor(value: string) {
    super(`Invalid HH:MM time string: "${value}"`);
    this.name = 'InvalidTimeWindowError';
  }
}

/**
 * Strict HH:MM parser. Returns null on invalid input so the caller can decide
 * whether to throw, log, or fall back. The previous implementation silently
 * returned 00:00 on garbage input, which made misconfigured `.env` look like
 * "midnight only" sending windows.
 */
export function parseHHMM(s: string | undefined | null): { h: number; m: number } | null {
  if (typeof s !== 'string') return null;
  const m = HHMM.exec(s.trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function parseHHMMOrThrow(value: string | undefined | null, label: string): { h: number; m: number } {
  const parsed = parseHHMM(value ?? '');
  if (!parsed) throw new InvalidTimeWindowError(`${label}=${String(value)}`);
  return parsed;
}

function safeParseWithFallback(
  value: string | undefined | null,
  fallback: { h: number; m: number },
  label: string,
): { h: number; m: number } {
  const parsed = parseHHMM(value ?? '');
  if (parsed) return parsed;
  if (value) {
    logger.warn({ label, value }, 'antilimit: invalid HH:MM, falling back');
  }
  return fallback;
}

function minutesInTz(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

export function isWithinSendingWindowAccount(account: AccountDoc, now = new Date()): boolean {
  const tz = account.sendingWindow?.timezone ?? 'UTC';
  const start = safeParseWithFallback(
    account.sendingWindow?.start,
    { h: 0, m: 0 },
    'account.sendingWindow.start',
  );
  const end = safeParseWithFallback(
    account.sendingWindow?.end,
    { h: 23, m: 59 },
    'account.sendingWindow.end',
  );
  return inWindow(now, tz, start, end);
}

export function isWithinCampaignWindow(campaign: CampaignDoc, now = new Date()): boolean {
  const tz = campaign.schedule?.timezone ?? 'UTC';
  const start = safeParseWithFallback(
    campaign.schedule?.windowStart,
    { h: 0, m: 0 },
    'campaign.schedule.windowStart',
  );
  const end = safeParseWithFallback(
    campaign.schedule?.windowEnd,
    { h: 23, m: 59 },
    'campaign.schedule.windowEnd',
  );
  return inWindow(now, tz, start, end);
}

function inWindow(
  now: Date,
  tz: string,
  start: { h: number; m: number },
  end: { h: number; m: number },
): boolean {
  const cur = minutesInTz(now, tz);
  const a = start.h * 60 + start.m;
  const b = end.h * 60 + end.m;
  if (a <= b) return cur >= a && cur <= b;
  return cur >= a || cur <= b;
}

/** Strict variant for config-time validation; throws on invalid input. */
export { parseHHMMOrThrow };
