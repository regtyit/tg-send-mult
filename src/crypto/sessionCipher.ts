import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  return Buffer.from(config.SESSION_KEY, 'hex');
}

/**
 * Encrypts an MTProto session string. Output format (base64):
 *   IV(12) || TAG(16) || CIPHERTEXT
 * Empty input returns empty string (signals "not authorized yet").
 */
export function encryptSession(plain: string): string {
  if (!plain) return '';
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypts a session string previously produced by encryptSession().
 * Throws on integrity failure (wrong key, tampered ciphertext, truncation).
 */
export function decryptSession(payload: string): string {
  if (!payload) return '';
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decryptSession: payload too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}
