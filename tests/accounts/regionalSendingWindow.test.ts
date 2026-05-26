import { describe, expect, it } from 'vitest';
import {
  getRegionalSendingWindow,
  resolveSendingWindowForNewAccount,
} from '../../src/modules/accounts/regionalSendingWindow';
import { isWithinSendingWindowAccount } from '../../src/modules/antilimit/window';
import type { AccountDoc } from '../../src/db/models/Account';

describe('regionalSendingWindow', () => {
  it('returns Russia window for +7 Moscow-style numbers', () => {
    const sw = resolveSendingWindowForNewAccount('+79001234567');
    expect(sw.timezone).toBe('Europe/Moscow');
    expect(sw.start).toBe('09:00');
    expect(sw.end).toBe('22:00');
    expect(sw.region.countryIso2).toBe('RU');
  });

  it('returns US window for +1 numbers', () => {
    const sw = resolveSendingWindowForNewAccount('+14155552671');
    expect(sw.timezone).toBe('America/New_York');
    expect(sw.region.countryIso2).toBe('US');
  });

  it('honours explicit region override over phone', () => {
    const sw = resolveSendingWindowForNewAccount('+14155552671', 'DE');
    expect(sw.timezone).toBe('Europe/Berlin');
    expect(sw.region.countryIso2).toBe('DE');
  });

  it('falls back to app default for unknown ISO', () => {
    const row = getRegionalSendingWindow('ZZ');
    expect(row.timezone).toBeTruthy();
    expect(row.windowStart).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('isWithinSendingWindowAccount with regional hours', () => {
  it('is quiet outside RU evening window in UTC', () => {
    const account = {
      sendingWindow: {
        start: '09:00',
        end: '22:00',
        timezone: 'Europe/Moscow',
      },
    } as AccountDoc;
    // 2026-05-26 20:00 UTC = 23:00 Moscow
    const late = new Date('2026-05-26T20:00:00.000Z');
    expect(isWithinSendingWindowAccount(account, late)).toBe(false);
    // 2026-05-26 08:00 UTC = 11:00 Moscow
    const mid = new Date('2026-05-26T08:00:00.000Z');
    expect(isWithinSendingWindowAccount(account, mid)).toBe(true);
  });
});
