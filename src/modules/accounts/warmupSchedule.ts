import type { AccountDoc } from '../../db/models/Account';
import { config } from '../../config';
import { accountTimezone } from './warming';

/** Operator-tunable warm-up dialog schedule (stored on account). */
export interface WarmupScheduleDoc {
  /** `interval` = every N days from warmingStartedAt; `weekdays` = ISO weekday 1=Mon … 7=Sun */
  mode: 'interval' | 'weekdays';
  /** Days between recommended dialog slots (interval mode). */
  intervalDays: number;
  /** ISO weekdays when a dialog is due (weekdays mode). */
  weekdays: number[];
  /** Max recommended readiness dialogs (guidance only). */
  maxRecommendedDialogs: number;
}

export const DEFAULT_WARMUP_SCHEDULE: WarmupScheduleDoc = {
  mode: 'interval',
  intervalDays: 2,
  weekdays: [1, 3, 5],
  maxRecommendedDialogs: config.WARMUP_READINESS_RECOMMENDED,
};

export function normalizeWarmupSchedule(
  raw: Partial<WarmupScheduleDoc> | null | undefined,
): WarmupScheduleDoc {
  const base = DEFAULT_WARMUP_SCHEDULE;
  if (!raw || typeof raw !== 'object') return { ...base };
  const mode = raw.mode === 'weekdays' ? 'weekdays' : 'interval';
  const intervalDays =
    typeof raw.intervalDays === 'number' && raw.intervalDays >= 1
      ? Math.floor(raw.intervalDays)
      : base.intervalDays;
  const weekdays = Array.isArray(raw.weekdays)
    ? raw.weekdays.filter((d) => typeof d === 'number' && d >= 1 && d <= 7)
    : base.weekdays;
  const maxRecommendedDialogs =
    typeof raw.maxRecommendedDialogs === 'number' && raw.maxRecommendedDialogs >= 1
      ? Math.floor(raw.maxRecommendedDialogs)
      : base.maxRecommendedDialogs;
  return { mode, intervalDays, weekdays, maxRecommendedDialogs };
}

function isoWeekdayInTz(d: Date, timezone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd] ?? 1;
}

function startOfDayInTz(d: Date, timezone: string): Date {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return new Date(`${key}T12:00:00Z`);
}

function daysBetweenUtc(a: Date, b: Date): number {
  const ms = startOfDayInTz(b, 'UTC').getTime() - startOfDayInTz(a, 'UTC').getTime();
  return Math.floor(ms / 86_400_000);
}

/** 0-based slot index for the next recommended dialog (0 .. max-1), or null if readiness met. */
export function warmupSlotIndex(
  account: Pick<
    AccountDoc,
    'warmingStartedAt' | 'warmingScriptDaysCompleted' | 'warmupSchedule' | 'sendingWindow'
  >,
  at: Date = new Date(),
): number | null {
  const schedule = normalizeWarmupSchedule(account.warmupSchedule as WarmupScheduleDoc | undefined);
  const completed = account.warmingScriptDaysCompleted ?? 0;
  if (completed >= schedule.maxRecommendedDialogs) return null;
  return completed;
}

/** Whether a warm-up dialog is recommended now (schedule slot due and readiness not met). */
export function isWarmupDialogDue(
  account: Pick<
    AccountDoc,
    | 'status'
    | 'warmingStartedAt'
    | 'warmingScriptDaysCompleted'
    | 'warmupSchedule'
    | 'sendingWindow'
  >,
  at: Date = new Date(),
): boolean {
  if (account.status !== 'warming') return false;
  const slot = warmupSlotIndex(account, at);
  if (slot === null) return false;
  const next = nextWarmupDialogAt(account, at);
  if (!next) return false;
  return next.getTime() <= at.getTime() + 60_000;
}

/**
 * Next calendar moment when a warm-up dialog is recommended (start of due day, account TZ).
 * Returns null when readiness recommendation is satisfied.
 */
export function nextWarmupDialogAt(
  account: Pick<
    AccountDoc,
    | 'warmingStartedAt'
    | 'warmingScriptDaysCompleted'
    | 'warmupSchedule'
    | 'sendingWindow'
  >,
  at: Date = new Date(),
): Date | null {
  const schedule = normalizeWarmupSchedule(account.warmupSchedule as WarmupScheduleDoc | undefined);
  const completed = account.warmingScriptDaysCompleted ?? 0;
  if (completed >= schedule.maxRecommendedDialogs) return null;

  const started = account.warmingStartedAt;
  if (!started) return null;

  const tz = accountTimezone(account);
  const slot = completed;

  if (schedule.mode === 'interval') {
    const dueDayOffset = slot * schedule.intervalDays;
    const due = new Date(started.getTime() + dueDayOffset * 86_400_000);
    if (due.getTime() > at.getTime()) return due;
    return at;
  }

  const targetWd = schedule.weekdays[slot % schedule.weekdays.length] ?? schedule.weekdays[0] ?? 1;
  let probe = new Date(at);
  for (let i = 0; i < 14; i++) {
    if (isoWeekdayInTz(probe, tz) === targetWd && probe.getTime() >= started.getTime()) {
      if (daysBetweenUtc(started, probe) >= slot || slot === 0) {
        if (probe.getTime() <= at.getTime()) return at;
        return probe;
      }
    }
    probe = new Date(probe.getTime() + 86_400_000);
  }
  return at;
}
