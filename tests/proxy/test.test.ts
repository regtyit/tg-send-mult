import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProxyDoc } from '../../src/db/models/Proxy';

vi.mock('../../src/telegram/pythonBridge', () => ({
  runTelethonBridgeAsync: vi.fn(),
  telethonCommon: vi.fn(() => ({})),
}));

vi.mock('../../src/telegram/sessionString', () => ({
  decryptSessionStringForAccount: vi.fn(() => 'session'),
}));

vi.mock('../../src/telegram/apiCredentials', () => ({
  telegramApiCredentialsForAccount: vi.fn(() => ({ apiId: 1, apiHash: 'hash' })),
  MissingTelegramApiCredentialsError: class extends Error {},
}));

import { runTelethonBridgeAsync } from '../../src/telegram/pythonBridge';
import { testProxy } from '../../src/modules/proxy/test';

function proxyDoc(type: ProxyDoc['type']): ProxyDoc {
  return {
    _id: { toString: () => '1' } as ProxyDoc['_id'],
    label: 'p1',
    type,
    host: '1.2.3.4',
    port: 443,
    country: 'RU',
    secret: type === 'mtproto' ? 'ee' + 'a'.repeat(32) : '',
    login: 'u',
    password: 'p',
  } as ProxyDoc;
}

describe('testProxy', () => {
  beforeEach(() => {
    vi.mocked(runTelethonBridgeAsync).mockReset();
  });

  it('accepts AUTH_KEY_UNREGISTERED for empty session on mtproto', async () => {
    vi.mocked(runTelethonBridgeAsync).mockResolvedValue({
      ok: false,
      error: { code: 'AUTH_KEY_UNREGISTERED', message: 'no session' },
    });
    const r = await testProxy(proxyDoc('mtproto'));
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('connected');
  });

  it('accepts transport check for socks5', async () => {
    vi.mocked(runTelethonBridgeAsync).mockResolvedValue({
      ok: false,
      error: { code: 'AUTH_KEY_UNREGISTERED', message: 'no session' },
    });
    const r = await testProxy(proxyDoc('socks5'));
    expect(r.ok).toBe(true);
  });

  it('accepts transport check for http', async () => {
    vi.mocked(runTelethonBridgeAsync).mockResolvedValue({
      ok: false,
      error: { code: 'AUTH_KEY_UNREGISTERED', message: 'no session' },
    });
    const r = await testProxy(proxyDoc('http'));
    expect(r.ok).toBe(true);
  });

  it('reports transport failure on NETWORK', async () => {
    vi.mocked(runTelethonBridgeAsync).mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK', message: 'timeout' },
    });
    const r = await testProxy(proxyDoc('mtproto'));
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('transport_failed');
  });
});
