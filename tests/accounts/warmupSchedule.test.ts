import { describe, expect, it } from 'vitest';
import { nextWarmupDialogAt, warmupSlotIndex } from '../../src/modules/accounts/warmupSchedule';

describe('warmupSchedule', () => {
  it('returns slot index until readiness met', () => {
    const account = {
      warmingStartedAt: new Date('2026-05-01T10:00:00Z'),
      warmingScriptDaysCompleted: 1,
      warmupSchedule: { mode: 'interval' as const, intervalDays: 2, weekdays: [1, 3, 5], maxRecommendedDialogs: 3 },
      sendingWindow: { timezone: 'UTC', start: '09:00', end: '22:00' },
    };
    expect(warmupSlotIndex(account)).toBe(1);
    account.warmingScriptDaysCompleted = 3;
    expect(warmupSlotIndex(account)).toBeNull();
  });

  it('computes next due time in interval mode', () => {
    const account = {
      warmingStartedAt: new Date('2026-05-01T10:00:00Z'),
      warmingScriptDaysCompleted: 0,
      warmupSchedule: { mode: 'interval' as const, intervalDays: 2, weekdays: [1, 3, 5], maxRecommendedDialogs: 3 },
      sendingWindow: { timezone: 'UTC', start: '09:00', end: '22:00' },
    };
    const at = new Date('2026-05-01T12:00:00Z');
    const next = nextWarmupDialogAt(account, at);
    expect(next).not.toBeNull();
  });
});
