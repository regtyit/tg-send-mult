import { describe, expect, it, vi } from 'vitest';
import type { AccountDoc } from '../../src/db/models/Account';
import type { CampaignDoc } from '../../src/db/models/Campaign';
import { isWithinCampaignWindow, isWithinSendingWindowAccount } from '../../src/modules/antilimit/window';

describe('sending windows', () => {
  it('account window: inside during midday UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
    const account = {
      sendingWindow: { start: '09:00', end: '22:00', timezone: 'UTC' },
    } as AccountDoc;
    expect(isWithinSendingWindowAccount(account)).toBe(true);
    vi.useRealTimers();
  });

  it('account window: outside late night UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T03:00:00.000Z'));
    const account = {
      sendingWindow: { start: '09:00', end: '22:00', timezone: 'UTC' },
    } as AccountDoc;
    expect(isWithinSendingWindowAccount(account)).toBe(false);
    vi.useRealTimers();
  });

  it('campaign window uses schedule fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T14:00:00.000Z'));
    const campaign = {
      schedule: {
        windowStart: '10:00',
        windowEnd: '18:00',
        timezone: 'UTC',
      },
    } as CampaignDoc;
    expect(isWithinCampaignWindow(campaign)).toBe(true);
    vi.useRealTimers();
  });
});
