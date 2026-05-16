import { describe, expect, it } from 'vitest';
import { toE164 } from '../../src/modules/contacts/normalize';

describe('toE164', () => {
  it('normalizes US number with country hint', () => {
    expect(toE164('2025550123', 'US')).toBe('+12025550123');
  });

  it('accepts already E.164', () => {
    expect(toE164('+79991234567')).toBe('+79991234567');
  });

  it('returns null for garbage', () => {
    expect(toE164('not-a-phone')).toBeNull();
  });
});
