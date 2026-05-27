import { describe, expect, it } from 'vitest';
import { describeSendingWindowAccount } from '../../src/modules/antilimit/window';

describe('describeSendingWindowAccount', () => {
  it('reports resume time when outside same-day window', () => {
    const account = {
      sendingWindow: { start: '09:00', end: '22:00', timezone: 'UTC' },
    };
    const status = describeSendingWindowAccount(account, new Date('2026-05-27T23:30:00.000Z'));
    expect(status.inWindow).toBe(false);
    expect(status.quietUntil).toMatch(/Quiet until 09:00/);
    expect(status.resumesAtLocal).toBeTruthy();
  });

  it('is active inside window', () => {
    const account = {
      sendingWindow: { start: '09:00', end: '22:00', timezone: 'UTC' },
    };
    const status = describeSendingWindowAccount(account, new Date('2026-05-27T12:00:00.000Z'));
    expect(status.inWindow).toBe(true);
    expect(status.quietUntil).toBeUndefined();
  });
});
