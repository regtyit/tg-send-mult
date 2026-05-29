import type { AccountDoc } from '../../db/models/Account';
import type { ProxyDoc } from '../../db/models/Proxy';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForAccount,
} from '../../telegram/apiCredentials';
import { deviceProfileFromAccount } from '../../telegram/deviceProfile';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { decryptSessionStringForAccount } from '../../telegram/sessionString';
import { mapTgError, TgDomainError } from '../../telegram/errors';
import { assertMtProxyPolicy } from '../proxy/policy';
import { isWithinTelegramMessageLength, TELEGRAM_MESSAGE_MAX_CHARS } from './telegramLimits';

/**
 * Send plain text via Telethon bridge. `to` is a Telegram peer string (username, +E164, etc.).
 */
export async function sendText(
  account: AccountDoc,
  proxy: ProxyDoc | null,
  to: string,
  text: string,
  opts: { importContactFirstName?: string } = {},
): Promise<{ randomId: string }> {
  if (!isWithinTelegramMessageLength(text)) {
    throw new TgDomainError({
      kind: 'message_too_long',
      code: 'MESSAGE_TOO_LONG',
      message: `Message exceeds ${TELEGRAM_MESSAGE_MAX_CHARS} characters (Telegram limit)`,
      retryable: false,
    });
  }
  /**
   * Enforce the proxy/country policy at send-time too. Without this an
   * account whose proxy was un-assigned (or whose phone country no longer
   * matches its assigned proxy) would still try to dispatch over a wrong-
   * country exit, which is exactly what triggers Telegram's anti-abuse
   * heuristics. Auth-time checks are not enough because account state can
   * drift between auth and the next campaign send.
   */
  assertMtProxyPolicy(account, proxy);
  const proxyPayload = proxyDocToTelethonPayload(proxy);
  const device = deviceProfileFromAccount(account);
  try {
    /**
     * decryptSessionStringForAccount throws SessionDecryptError (a TgDomainError
     * with kind: 'auth_invalid') if the session blob cannot be decrypted. Keep
     * the call inside the try so callers in the queue processor can treat it
     * uniformly with other Telegram errors.
     */
    const session = decryptSessionStringForAccount(account);
    const creds = telegramApiCredentialsForAccount(account);
    const res = unwrapTelethonBridge(
      await runTelethonBridgeAsync<{ randomId: string }>({
        action: 'send_message',
        session,
        peer: to.trim(),
        text,
        ...(opts.importContactFirstName?.trim()
          ? { importContactFirstName: opts.importContactFirstName.trim().slice(0, 64) }
          : {}),
        ...telethonCommon(creds, device, proxyPayload),
      }),
    );
    return { randomId: res.randomId ?? '' };
  } catch (err) {
    if (err instanceof MissingTelegramApiCredentialsError) {
      throw new TgDomainError({
        kind: 'unknown',
        code: 'NO_API_CREDENTIALS',
        message: err.message,
        retryable: false,
      });
    }
    throw err instanceof TgDomainError ? err : mapTgError(err);
  }
}
