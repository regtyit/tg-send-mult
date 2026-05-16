import { describe, expect, it } from 'vitest';
import { decryptSession, encryptSession } from '../../src/crypto/sessionCipher';

describe('sessionCipher', () => {
  it('round-trips non-empty session string', () => {
    const plain = '1AAABuiltinSessionDataExample';
    const enc = encryptSession(plain);
    expect(enc).not.toContain(plain);
    expect(decryptSession(enc)).toBe(plain);
  });

  it('encrypt empty string yields empty (no session yet)', () => {
    expect(encryptSession('')).toBe('');
    expect(decryptSession('')).toBe('');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSession('secret');
    const buf = Buffer.from(enc, 'base64');
    if (buf.length > 20) buf[20] ^= 0xff;
    expect(() => decryptSession(buf.toString('base64'))).toThrow();
  });
});
