import { describe, expect, it } from 'vitest';
import { buildGramJsStringSessionV1, GRAMJS_DEFAULT_DC_IPV4 } from '../../src/modules/auth/gramJsStringSession';

/** Decode v1 `1`+base64 StringSession wire format (Telethon/gramJS compatible). */
function parseV1Session(str: string): { dcId: number; host: string; port: number; authKey: Buffer } {
  expect(str[0]).toBe('1');
  const raw = Buffer.from(str.slice(1), 'base64');
  const dcId = raw[0];
  const addrLen = raw.readUInt16BE(1);
  const host = raw.subarray(3, 3 + addrLen).toString('utf8');
  const port = raw.readUInt16BE(3 + addrLen);
  const authKey = raw.subarray(3 + addrLen + 2);
  return { dcId, host, port, authKey };
}

describe('buildGramJsStringSessionV1', () => {
  it('encodes dc, host, port, key in v1 StringSession format', () => {
    const authKey = Buffer.alloc(256, 0xab);
    const dcId = 4;
    const str = buildGramJsStringSessionV1({ dcId, authKeyHex: authKey.toString('hex') });
    const parsed = parseV1Session(str);
    expect(parsed.dcId).toBe(dcId);
    expect(parsed.host).toBe(GRAMJS_DEFAULT_DC_IPV4[dcId].host);
    expect(parsed.port).toBe(443);
    expect(parsed.authKey.equals(authKey)).toBe(true);
  });

  it('accepts hex with spaces and 0x prefix', () => {
    const key = Buffer.alloc(256, 1);
    const spaced = key.toString('hex').replace(/(.{32})/g, '$1 ').trim();
    const str = buildGramJsStringSessionV1({ dcId: 2, authKeyHex: `0x${spaced}` });
    const parsed = parseV1Session(str);
    expect(parsed.dcId).toBe(2);
    expect(parsed.authKey.equals(key)).toBe(true);
  });

  it('uses custom host when provided', () => {
    const authKey = Buffer.alloc(256, 3);
    const str = buildGramJsStringSessionV1({
      dcId: 4,
      authKeyHex: authKey.toString('hex'),
      serverAddress: '203.0.113.10',
      port: 443,
    });
    const parsed = parseV1Session(str);
    expect(parsed.host).toBe('203.0.113.10');
    expect(parsed.authKey.equals(authKey)).toBe(true);
  });

  it('rejects wrong auth key length', () => {
    expect(() =>
      buildGramJsStringSessionV1({ dcId: 1, authKeyHex: '00'.repeat(100) }),
    ).toThrow(/256 bytes/);
  });
});
