import type { Types } from 'mongoose';
import { config } from '../../config';
import { AccountModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import type { DialogSessionDoc } from '../../db/models/DialogSession';

export class WarmingPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WarmingPolicyError';
  }
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
  }
}

export function warmingMsgsPerDayCap(baseLimit: number): number {
  return Math.min(baseLimit, config.WARMUP_MSGS_PER_DAY);
}

export function isWarmingScriptQuotaMet(account: Pick<AccountDoc, 'status' | 'warmingScriptDaysCompleted'>): boolean {
  return (
    account.status === 'warming' &&
    (account.warmingScriptDaysCompleted ?? 0) >= config.WARMUP_DAYS
  );
}

export function warmingCanStartScriptToday(
  account: Pick<
    AccountDoc,
    'status' | 'warmingLastScriptDay' | 'warmingScriptDaysCompleted' | 'sendingWindow'
  >,
  at: Date = new Date(),
): { allowed: boolean; code?: string; message?: string } {
  if (account.status !== 'warming') return { allowed: true };
  if (isWarmingScriptQuotaMet(account)) {
    return {
      allowed: false,
      code: 'warming_scripts_complete',
      message: `Warm-up requires ${config.WARMUP_DAYS} dialog scripts on separate days; wait for promotion to active.`,
    };
  }
  const dayKey = calendarDayKey(at, accountTimezone(account));
  if (account.warmingLastScriptDay === dayKey) {
    return {
      allowed: false,
      code: 'warming_daily_script_limit',
      message: `Warm-up allows ${config.WARMUP_SCRIPTS_PER_DAY} dialog script per calendar day (today: ${dayKey}).`,
    };
  }
  return { allowed: true };
}

export async function assertWarmingCanStartScriptForSession(session: DialogSessionDoc): Promise<void> {
  const accountA = await AccountModel.findById(session.accountAId);
  if (!accountA) return;

  const checks = [warmingCanStartScriptToday(accountA)];
  if (session.peerType === 'account' && session.peerAccountId) {
    const peer = await AccountModel.findById(session.peerAccountId);
    if (peer) checks.push(warmingCanStartScriptToday(peer));
  }

  for (const c of checks) {
    if (!c.allowed) {
      throw new WarmingPolicyError(c.code ?? 'warming_blocked', c.message ?? 'Warm-up policy blocked');
    }
  }
}

/** Count one completed warm-up script day for each warming participant. */
export async function recordWarmingScriptDayForSession(session: DialogSessionDoc): Promise<void> {
  const ids: Types.ObjectId[] = [session.accountAId];
  if (session.peerType === 'account' && session.peerAccountId) {
    ids.push(session.peerAccountId);
  }

  const now = new Date();
  for (const accountId of ids) {
    const acc = await AccountModel.findById(accountId);
    if (!acc || acc.status !== 'warming') continue;

    const dayKey = calendarDayKey(now, accountTimezone(acc));
    if (acc.warmingLastScriptDay === dayKey) continue;

    await AccountModel.updateOne(
      {
        _id: accountId,
        status: 'warming',
        warmingLastScriptDay: { $ne: dayKey },
      },
      {
        $set: { warmingLastScriptDay: dayKey },
        $inc: { warmingScriptDaysCompleted: 1 },
      },
    );
  }
}

export async function promoteWarmedAccounts(): Promise<number> {
  const now = new Date();
  const result = await AccountModel.updateMany(
    {
      status: 'warming',
      warmingFinishesAt: { $lte: now },
      warmingScriptDaysCompleted: { $gte: config.WARMUP_DAYS },
    },
    { $set: { status: 'active' } },
  );
  return result.modifiedCount;
}
