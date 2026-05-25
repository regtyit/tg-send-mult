import { describe, expect, it } from 'vitest';
import { normalizePhoneDigits, normalizePhoneE164 } from '../../src/modules/dialog/normalizePhone';
import { peerStringFromContact } from '../../src/modules/dialog/resolvePeer';

describe('dialog phone peers', () => {
  it('normalizes E.164 for Telethon', () => {
    expect(normalizePhoneE164('79001234567')).toBe('+79001234567');
    expect(normalizePhoneE164('+7 900 123-45-67')).toBe('+79001234567');
  });

  it('normalizes digits for inbox filters', () => {
    expect(normalizePhoneDigits('+79001234567')).toBe('79001234567');
  });

  it('peerStringFromContact prefers username then phone', () => {
    expect(
      peerStringFromContact({
        phoneE164: '89001112233',
        username: '',
        userId: '',
      } as never),
    ).toBe('+89001112233');
  });
});
