import { describe, expect, it } from 'vitest';
import { normalizePhoneE164, phoneCountryIso2 } from '../../src/modules/accounts/phoneCountry';

describe('normalizePhoneE164', () => {
  it('adds leading + for digit-only international numbers', () => {
    expect(normalizePhoneE164('79001234567')).toMatch(/^\+79/);
  });

  it('keeps valid E.164', () => {
    expect(normalizePhoneE164('+14155552671')).toBe('+14155552671');
  });
});

describe('phoneCountryIso2', () => {
  it('derives country from digit-only RU-style export', () => {
    expect(phoneCountryIso2('79001234567')).toBe('RU');
  });
});
