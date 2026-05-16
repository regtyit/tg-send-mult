import { ProxyDoc } from '../../db/models/Proxy';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForAccount,
} from '../../telegram/apiCredentials';
import { defaultDeviceProfile } from '../../telegram/deviceProfile';
import { TgDomainError } from '../../telegram/errors';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon } from '../../telegram/pythonBridge';

export interface ProxyTestResult {
  ok: boolean;
  /**
   * Stage we reached:
   * - `connected`: TCP/MTProxy connect succeeded (Telegram answered).
   * - `transport_failed`: proxy refused / closed / timed out.
   * - `bridge_error`: bridge subprocess error (not a transport issue).
   */
  stage: 'connected' | 'transport_failed' | 'bridge_error';
  /** Lower-cased bridge error code, when applicable. */
  code?: string;
  message: string;
  durationMs: number;
}

/**
 * Tests whether a proxy lets us reach Telegram, without needing an authorized
 * session. We send an empty session through the bridge's `get_me` action:
 *  - if transport works, Telethon answers AUTH_KEY_UNREGISTERED — proxy OK.
 *  - if transport is broken (NETWORK / INCOMPLETEREADERROR / BRIDGE_TIMEOUT),
 *    we report it as a transport failure.
 */
export async function testProxy(
  proxy: ProxyDoc,
  options: { timeoutMs?: number } = {},
): Promise<ProxyTestResult> {
  const proxyPayload = proxyDocToTelethonPayload(proxy);
  if (proxyPayload.type === 'none') {
    return {
      ok: false,
      stage: 'transport_failed',
      code: 'INVALID_PROXY',
      message: 'Proxy has no usable transport configuration',
      durationMs: 0,
    };
  }

  let creds: { apiId: number; apiHash: string };
  try {
    creds = telegramApiCredentialsForAccount(null);
  } catch (err) {
    if (err instanceof MissingTelegramApiCredentialsError) {
      return {
        ok: false,
        stage: 'bridge_error',
        code: 'NO_API_CREDENTIALS',
        message:
          'Set TG_API_ID and TG_API_HASH in .env so proxy tests can drive Telethon (any valid Telegram app pair works for connect).',
        durationMs: 0,
      };
    }
    throw err;
  }

  const startedAt = Date.now();
  try {
    const res = await runTelethonBridgeAsync(
      {
        action: 'get_me',
        session: '',
        ...telethonCommon(creds, defaultDeviceProfile(), proxyPayload),
      },
      options.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined,
    );
    const durationMs = Date.now() - startedAt;

    if (res.ok) {
      // Should not happen with empty session, but treat as connected.
      return {
        ok: true,
        stage: 'connected',
        message: 'Proxy reachable',
        durationMs,
      };
    }

    const code = (res.error?.code ?? '').toUpperCase();
    if (code === 'AUTH_KEY_UNREGISTERED') {
      return {
        ok: true,
        stage: 'connected',
        code,
        message: 'Proxy reachable (Telegram answered AUTH_KEY_UNREGISTERED for empty session — expected).',
        durationMs,
      };
    }

    const transportFailureCodes = new Set([
      'NETWORK',
      'INCOMPLETEREADERROR',
      'CONNECTIONERROR',
      'BRIDGE_TIMEOUT',
      'TIMEOUT',
    ]);
    if (transportFailureCodes.has(code)) {
      return {
        ok: false,
        stage: 'transport_failed',
        code,
        message: res.error?.message || code || 'Transport failed',
        durationMs,
      };
    }

    return {
      ok: false,
      stage: 'bridge_error',
      code: code || 'UNKNOWN',
      message: res.error?.message || code || 'Unknown bridge error',
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err instanceof TgDomainError) {
      const code = (err.code || '').toUpperCase();
      const isTransport = err.kind === 'network' || code.includes('NETWORK') || code === 'BRIDGE_TIMEOUT';
      return {
        ok: false,
        stage: isTransport ? 'transport_failed' : 'bridge_error',
        code,
        message: err.message,
        durationMs,
      };
    }
    return {
      ok: false,
      stage: 'bridge_error',
      message: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }
}
