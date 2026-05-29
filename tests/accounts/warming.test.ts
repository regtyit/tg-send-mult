import { describe, expect, it } from 'vitest';
import {
  calendarDayKey,
  computeWarmingFinishesAt,
  isWarmingReadinessMet,
  readinessDialogsRecommended,
  warmingCanStartScriptToday,
  warmingMsgsPerDayCap,
  warmingStartHints,
} from '../../src/modules/accounts/warming';
import { isWarmupDialogDue, nextWarmupDialogAt } from '../../src/modules/accounts/warmupSchedule';

describe('warming policy', () => {
  it('caps campaign msgs per day during warming', () => {
    expect(warmingMsgsPerDayCap(80)).toBe(1);
    expect(warmingMsgsPerDayCap(1)).toBe(1);
  });

  it('finishes after WARMUP_DAYS calendar days from start', () => {
    const start = new Date('2026-01-01T12:00:00Z');
    const finish = computeWarmingFinishesAt(start);
    expect(finish.getDate()).toBe(4);
    expect(finish.getMonth()).toBe(0);
  });

  it('allows warm-up scripts with soft hints only', () => {
    const at = new Date('2026-05-24T10:00:00Z');
    const day = calendarDayKey(at, 'UTC');
    const warming = {
      status: 'warming' as const,
      warmingLastScriptDay: day,
      warmingScriptDaysCompleted: 0,
      warmingStartedAt: new Date('2026-05-20T10:00:00Z'),
      sendingWindow: { timezone: 'UTC', start: '09:00', end: '22:00' },
      warmupSchedule: { mode: 'interval' as const, intervalDays: 2, weekdays: [1, 3, 5], maxRecommendedDialogs: 3 },
    };
    expect(warmingCanStartScriptToday(warming, at).allowed).toBe(true);
    const hints = warmingStartHints(warming, at);
    expect(hints.some((h) => h.code === 'warming_daily_script_hint')).toBe(true);
  });

  it('readiness met after recommended count', () => {
    const warming = {
      status: 'warming' as const,
      warmingScriptDaysCompleted: readinessDialogsRecommended(),
      sendingWindow: { timezone: 'UTC' },
    };
    expect(isWarmingReadinessMet(warming)).toBe(true);
    expect(warmingCanStartScriptToday(warming).allowed).toBe(true);
  });

  it('computes next warm-up slot in interval mode', () => {
    const started = new Date('2026-05-01T10:00:00Z');
    const account = {
      warmingStartedAt: started,
      warmingScriptDaysCompleted: 1,
      sendingWindow: { timezone: 'UTC', start: '09:00', end: '22:00' },
      warmupSchedule: { mode: 'interval' as const, intervalDays: 2, weekdays: [1, 3, 5], maxRecommendedDialogs: 3 },
    };
    const at = new Date('2026-05-03T10:00:00Z');
    const next = nextWarmupDialogAt(account, at);
    expect(next).not.toBeNull();
    expect(isWarmupDialogDue({ status: 'warming', ...account }, at)).toBe(true);
  });
});
