import { describe, expect, it } from 'vitest';
import { looksLikeStringSession } from '../../src/modules/auth/sessionImport';

describe('looksLikeStringSession', () => {
  it('accepts gramJS-style v1 (1+base64) strings', () => {
    const gramJs =
      '1' + Buffer.from('a'.repeat(64)).toString('base64');
    expect(looksLikeStringSession(gramJs)).toBe(true);
  });

  it('accepts Telethon native base64 strings', () => {
    const telethon = Buffer.from('a'.repeat(80)).toString('base64');
    expect(looksLikeStringSession(telethon)).toBe(true);
  });

  it('accepts URL-safe base64', () => {
    const urlSafe = 'AbCdEfGhIjKlMnOpQrStUv-_xYz0123456789';
    expect(looksLikeStringSession(urlSafe)).toBe(true);
  });

  it('rejects empty / too short / whitespace-only', () => {
    expect(looksLikeStringSession('')).toBe(false);
    expect(looksLikeStringSession('   ')).toBe(false);
    expect(looksLikeStringSession('1abc')).toBe(false);
    expect(looksLikeStringSession('aaaaa')).toBe(false);
  });

  it('rejects strings with illegal characters', () => {
    expect(looksLikeStringSession('this has spaces and stuff inside it!')).toBe(false);
    expect(looksLikeStringSession('valid_chars_but_with$dollar_sign$xxx')).toBe(false);
  });
});
