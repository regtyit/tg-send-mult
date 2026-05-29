import { config } from '../../config';
import { AccountModel, DialogScriptModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import type { DialogSessionDoc } from '../../db/models/DialogSession';
import {
  DEFAULT_WARMUP_SCHEDULE,
  isWarmupDialogDue,
  nextWarmupDialogAt,
  normalizeWarmupSchedule,
  type WarmupScheduleDoc,
} from './warmupSchedule';

export { DEFAULT_WARMUP_SCHEDULE, normalizeWarmupSchedule, isWarmupDialogDue, nextWarmupDialogAt };
export type { WarmupScheduleDoc };

export class WarmingPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WarmingPolicyError';
  }
}

/** Recommended completed warm-up dialogs for readiness (guidance only). */
export function readinessDialogsRecommended(): number {
  return config.WARMUP_READINESS_RECOMMENDED;
}

/** Calendar day `YYYY-MM-DD` in the account sending-window timezone. */
export function calendarDayKey(d: Date, timezone: string): string {
  const tz = timezone?.trim() || config.DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function accountTimezone(account: Pick<AccountDoc, 'sendingWindow'>): string {
  return account.sendingWindow?.timezone?.trim() || config.DEFAULT_TIMEZONE;
}

export function computeWarmingFinishesAt(startedAt: Date): Date {
  const finish = new Date(startedAt);
  finish.setDate(finish.getDate() + config.WARMUP_DAYS);
  return finish;
}

/** Set or refresh warm-up schedule when a session is first authorized. */
export function applyWarmingSchedule(account: AccountDoc, at: Date = new Date()): void {
  account.status = account.status === 'banned' ? 'new' : 'warming';
  if (!account.warmingStartedAt) {
    account.warmingStartedAt = at;
    account.warmingFinishesAt = computeWarmingFinishesAt(at);
    account.warmingScriptDaysCompleted = 0;
    account.warmingLastScriptDay = '';
    if (!account.warmupSchedule) {
      account.warmupSchedule = { ...DEFAULT_WARMUP_SCHEDULE };
    }
    if (!account.warmingUsedPresetSlugs?.length) {
      account.warmingUsedPresetSlugs = [];
    }
  }
}

export function warmingMsgsPerDayCap(baseLimit: number): number {
  return Math.min(baseLimit, config.WARMUP_MSGS_PER_DAY);
}

/** Readiness recommendation met (3+ completed warm-up dialogs by default). */
export function isWarmingReadinessMet(
  account: Pick<AccountDoc, 'status' | 'warmingScriptDaysCompleted'>,
): boolean {
  if (account.status !== 'warming') return true;
  return (account.warmingScriptDaysCompleted ?? 0) >= readinessDialogsRecommended();
}

/** @deprecated Use isWarmingReadinessMet — kept for callers; no longer blocks promotion. */
export function isWarmingScriptQuotaMet(
  account: Pick<AccountDoc, 'status' | 'warmingScriptDaysCompleted'>,
): boolean {
  return isWarmingReadinessMet(account);
}

export interface WarmingStartHint {
  code: string;
  message: string;
  severity: 'info' | 'warning';
}

/** Soft hints when starting a warm-up dialog (does not block). */
export function warmingStartHints(
  account: Pick<
    AccountDoc,
    | 'status'
    | 'warmingLastScriptDay'
    | 'warmingScriptDaysCompleted'
    | 'warmingStartedAt'
    | 'warmupSchedule'
    | 'sendingWindow'
  >,
  at: Date = new Date(),
): WarmingStartHint[] {
  if (account.status !== 'warming') return [];

  const hints: WarmingStartHint[] = [];
  const recommended = readinessDialogsRecommended();
  const completed = account.warmingScriptDaysCompleted ?? 0;

  if (isWarmingReadinessMet(account)) {
    hints.push({
      code: 'warming_readiness_met',
      severity: 'info',
      message: `${completed}/${recommended} recommended warm-up dialogs completed. Account is ready for heavier use; promotion is time-based.`,
    });
  } else {
    hints.push({
      code: 'warming_readiness_progress',
      severity: 'info',
      message: `${completed}/${recommended} recommended warm-up dialogs completed.`,
    });
  }

  const dayKey = calendarDayKey(at, accountTimezone(account));
  if (account.warmingLastScriptDay === dayKey) {
    hints.push({
      code: 'warming_daily_script_hint',
      severity: 'warning',
      message: `A warm-up dialog already completed today (${dayKey}). Additional dialogs today are allowed but not required.`,
    });
  }

  if (!isWarmupDialogDue(account, at)) {
    const next = nextWarmupDialogAt(account, at);
    if (next && !isWarmingReadinessMet(account)) {
      hints.push({
        code: 'warming_schedule_not_due',
        severity: 'info',
        message: `Next recommended warm-up dialog per your schedule: ${next.toISOString()}`,
      });
    }
  }

  return hints;
}

export function warmingCanStartScriptToday(
  account: Pick<
    AccountDoc,
    | 'status'
    | 'warmingLastScriptDay'
    | 'warmingScriptDaysCompleted'
    | 'warmingStartedAt'
    | 'warmupSchedule'
    | 'sendingWindow'
  >,
  at: Date = new Date(),
): { allowed: boolean; code?: string; message?: string; hints?: WarmingStartHint[] } {
  if (account.status !== 'warming') return { allowed: true };
  const hints = warmingStartHints(account, at);
  return { allowed: true, hints };
}

export interface WarmingStatusView {
  readinessDialogsCompleted: number;
  readinessDialogsRecommended: number;
  readinessMet: boolean;
  warmingCanStartToday: boolean;
  warmupDialogDue: boolean;
  nextRecommendedDialogAt: string | null;
  warmingPromotesAt: string | null;
  warmingStartedAt: string | null;
  hints: WarmingStartHint[];
  warmupSchedule: WarmupScheduleDoc;
}

export function describeWarmingStatus(
  account: Pick<
    AccountDoc,
    | 'status'
    | 'warmingStartedAt'
    | 'warmingFinishesAt'
    | 'warmingScriptDaysCompleted'
    | 'warmingLastScriptDay'
    | 'warmupSchedule'
    | 'sendingWindow'
  >,
  at: Date = new Date(),
): WarmingStatusView | null {
  if (account.status !== 'warming') return null;

  const hints = warmingStartHints(account, at);
  const next = nextWarmupDialogAt(account, at);

  return {
    readinessDialogsCompleted: account.warmingScriptDaysCompleted ?? 0,
    readinessDialogsRecommended: readinessDialogsRecommended(),
    readinessMet: isWarmingReadinessMet(account),
    warmingCanStartToday: true,
    warmupDialogDue: isWarmupDialogDue(account, at),
    nextRecommendedDialogAt: next ? next.toISOString() : null,
    warmingPromotesAt: account.warmingFinishesAt
      ? new Date(account.warmingFinishesAt).toISOString()
      : null,
    warmingStartedAt: account.warmingStartedAt
      ? new Date(account.warmingStartedAt).toISOString()
      : null,
    hints,
    warmupSchedule: normalizeWarmupSchedule(account.warmupSchedule as WarmupScheduleDoc | undefined),
  };
}

/** No-op: warm-up start is not hard-blocked; use warmingStartHints in API/UI. */
export async function assertWarmingCanStartScriptForSession(_session: DialogSessionDoc): Promise<void> {
  return;
}

export function extractPresetSlugFromScriptNotes(notes: string | undefined | null): string | null {
  if (!notes) return null;
  const m = /__presetSlug:([a-z0-9-]+)__/i.exec(notes);
  return m?.[1] ?? null;
}

/** Count one completed warm-up dialog toward readiness for each warming participant. */
export async function recordWarmingScriptDayForSession(session: DialogSessionDoc): Promise<void> {
  const script = await DialogScriptModel.findById(session.scriptId).select('notes').lean();
  const presetSlug = extractPresetSlugFromScriptNotes(script?.notes);

  const ids: string[] = [String(session.accountAId)];
  if (session.peerType === 'account' && session.peerAccountId) {
    ids.push(String(session.peerAccountId));
  }

  const now = new Date();
  for (const accountId of ids) {
    const acc = await AccountModel.findById(accountId);
    if (!acc || acc.status !== 'warming') continue;

    const dayKey = calendarDayKey(now, accountTimezone(acc));
    const update: Record<string, unknown> = {
      $set: { warmingLastScriptDay: dayKey },
      $inc: { warmingScriptDaysCompleted: 1 },
    };
    if (presetSlug) {
      (update as { $addToSet?: Record<string, unknown> }).$addToSet = {
        warmingUsedPresetSlugs: presetSlug,
      };
    }

    await AccountModel.updateOne({ _id: accountId, status: 'warming' }, update);
  }
}

export async function promoteWarmedAccounts(): Promise<number> {
  const now = new Date();
  const result = await AccountModel.updateMany(
    {
      status: 'warming',
      warmingFinishesAt: { $lte: now },
    },
    { $set: { status: 'active' } },
  );
  return result.modifiedCount;
}

export async function getWarmingStartHintsForSession(
  session: DialogSessionDoc,
): Promise<WarmingStartHint[]> {
  const accountA = await AccountModel.findById(session.accountAId);
  if (!accountA) return [];

  const hints = [...warmingStartHints(accountA)];
  if (session.peerType === 'account' && session.peerAccountId) {
    const peer = await AccountModel.findById(session.peerAccountId);
    if (peer) hints.push(...warmingStartHints(peer));
  }
  return hints;
}
