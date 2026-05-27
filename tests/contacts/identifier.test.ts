import { describe, expect, it } from 'vitest';
import { normalizeUsername, parseContactIdentifier } from '../../src/modules/contacts/identifier';

describe('normalizeUsername', () => {
  it('accepts @username and bare form', () => {
    expect(normalizeUsername('@Meow1502')).toBe('meow1502');
    expect(normalizeUsername('meow1502')).toBe('meow1502');
  });

  it('rejects too short handles', () => {
    expect(normalizeUsername('abcd')).toBe('');
  });
});

describe('parseContactIdentifier', () => {
  it('parses E.164 phone', () => {
    expect(parseContactIdentifier('+79991234567')).toEqual({
      phoneE164: '+79991234567',
      username: '',
    });
  });

  it('parses bare username in phone column', () => {
    expect(parseContactIdentifier('meow1502')).toEqual({
      phoneE164: null,
      username: 'meow1502',
    });
  });

  it('parses t.me link', () => {
    expect(parseContactIdentifier('https://t.me/Meow1502')).toEqual({
      phoneE164: null,
      username: 'meow1502',
    });
  });

  it('uses default country for national numbers', () => {
    expect(parseContactIdentifier('2025550123', { defaultCountry: 'US' })).toEqual({
      phoneE164: '+12025550123',
      username: '',
    });
  });
});
