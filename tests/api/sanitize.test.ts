import { describe, expect, it } from 'vitest';
import {
  sanitizeAccount,
  sanitizeAccounts,
  sanitizeProxies,
  sanitizeProxy,
} from '../../src/apps/api/sanitize';

describe('sanitizeAccount', () => {
  it('strips sessionEnc and telegramApiHash and exposes presence flags', () => {
    const acc = {
      _id: 'abc',
      phone: '+14155552671',
      sessionEnc: 'super-secret-blob',
      telegramApiHash: 'abcdef0123456789',
      telegramApiId: 12345,
      label: 'main',
    };
    const out = sanitizeAccount(acc);
    expect(out).not.toBeNull();
    expect(out!.sessionEnc).toBeUndefined();
    expect(out!.telegramApiHash).toBeUndefined();
    expect(out!.hasSession).toBe(true);
    expect(out!.hasTelegramApiHash).toBe(true);
    expect(out!.phone).toBe('+14155552671');
    expect(out!.telegramApiId).toBe(12345);
  });

  it('reports false flags when secrets are absent or empty', () => {
    const out = sanitizeAccount({
      phone: '+14155552671',
      sessionEnc: '',
      telegramApiHash: undefined,
    });
    expect(out!.hasSession).toBe(false);
    expect(out!.hasTelegramApiHash).toBe(false);
  });

  it('returns null for null/undefined/non-object inputs', () => {
    expect(sanitizeAccount(null)).toBeNull();
    expect(sanitizeAccount(undefined)).toBeNull();
    expect(sanitizeAccount('string')).toBeNull();
    expect(sanitizeAccount(42)).toBeNull();
  });

  it('handles Mongoose-style documents via toObject()', () => {
    const fakeDoc = {
      toObject: () => ({
        phone: '+1',
        sessionEnc: 'enc',
        telegramApiHash: 'h',
      }),
    };
    const out = sanitizeAccount(fakeDoc);
    expect(out!.sessionEnc).toBeUndefined();
    expect(out!.hasSession).toBe(true);
  });
});

describe('sanitizeAccounts', () => {
  it('sanitizes each item and skips invalid entries', () => {
    const items = [
      { phone: '+1', sessionEnc: 'a', telegramApiHash: 'b' },
      null,
      'not an object',
      { phone: '+2', sessionEnc: '', telegramApiHash: '' },
    ];
    const out = sanitizeAccounts(items);
    expect(out).toHaveLength(2);
    expect(out[0]!.sessionEnc).toBeUndefined();
    expect(out[0]!.hasSession).toBe(true);
    expect(out[1]!.hasSession).toBe(false);
  });

  it('returns [] for non-array', () => {
    expect(sanitizeAccounts(null)).toEqual([]);
    expect(sanitizeAccounts({})).toEqual([]);
  });
});

describe('sanitizeProxy', () => {
  it('keeps secret/login/password and emits presence flags', () => {
    const out = sanitizeProxy({
      _id: 'p1',
      label: 'mtproto-1',
      type: 'mtproto',
      host: 'example.com',
      port: 443,
      secret: 'feedface',
      login: 'user',
      password: 'pass',
    });
    expect(out!.secret).toBe('feedface');
    expect(out!.login).toBe('user');
    expect(out!.password).toBe('pass');
    expect(out!.hasSecret).toBe(true);
    expect(out!.hasLogin).toBe(true);
    expect(out!.hasPassword).toBe(true);
    expect(out!.host).toBe('example.com');
  });

  it('reports false flags when proxy has no credentials', () => {
    const out = sanitizeProxy({ host: 'h', port: 80, type: 'socks5' });
    expect(out!.hasSecret).toBe(false);
    expect(out!.hasLogin).toBe(false);
    expect(out!.hasPassword).toBe(false);
  });
});

describe('sanitizeProxies', () => {
  it('sanitizes each proxy in an array', () => {
    const out = sanitizeProxies([
      { host: 'h', port: 80, secret: 's' },
      { host: 'h2', port: 443 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.secret).toBe('s');
    expect(out[0]!.hasSecret).toBe(true);
    expect(out[1]!.hasSecret).toBe(false);
  });
});
