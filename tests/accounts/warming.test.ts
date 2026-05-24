import { describe, expect, it } from 'vitest';
import {
  calendarDayKey,
  computeWarmingFinishesAt,
  isWarmingScriptQuotaMet,
  warmingCanStartScriptToday,
  warmingMsgsPerDayCap,
} from '../../src/modules/accounts/warming';

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

  it('allows one warm-up script per calendar day', () => {
    const at = new Date('2026-05-24T10:00:00Z');
    const day = calendarDayKey(at, 'UTC');
    const warming = {
      status: 'warming' as const,
      warmingLastScriptDay: '',
      warmingScriptDaysCompleted: 0,
      sendingWindow: { timezone: 'UTC' },
    };
    expect(warmingCanStartScriptToday(warming, at).allowed).toBe(true);

    warming.warmingLastScriptDay = day;
    expect(warmingCanStartScriptToday(warming, at).allowed).toBe(false);
    expect(warmingCanStartScriptToday(warming, at).code).toBe('warming_daily_script_limit');
  });

  it('blocks new scripts after quota days completed', () => {
    const warming = {
      status: 'warming' as const,
      warmingLastScriptDay: '',
      warmingScriptDaysCompleted: 3,
      sendingWindow: { timezone: 'UTC' },
    };
    expect(isWarmingScriptQuotaMet(warming)).toBe(true);
    expect(warmingCanStartScriptToday(warming).allowed).toBe(false);
    expect(warmingCanStartScriptToday(warming).code).toBe('warming_scripts_complete');
  });
});
