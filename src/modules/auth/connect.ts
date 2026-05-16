import type { AccountDoc } from '../../db/models/Account';
import type { ProxyDoc } from '../../db/models/Proxy';
import { AccountModel } from '../../db/models';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForAccount,
} from '../../telegram/apiCredentials';
import { deviceProfileFromAccount } from '../../telegram/deviceProfile';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { decryptSessionStringForAccount } from '../../telegram/sessionString';
import { mapTgError, TgDomainError } from '../../telegram/errors';
import { logSessionEvent } from './sessionEvents';
import { assertMtProxyPolicy } from '../proxy/policy';

export async function connectWithSavedSession(
  account: AccountDoc,
  proxy: ProxyDoc | null,
): Promise<{ userId: string; telegramUsername: string }> {
  if (!account.sessionEnc) {
    throw new TgDomainError({
      kind: 'auth_invalid',
      code: 'NO_SESSION',
      message: 'Account has no saved session',
    });
  }

  assertMtProxyPolicy(account, proxy);
  const proxyPayload = proxyDocToTelethonPayload(proxy);
  const device = deviceProfileFromAccount(account);

  try {
    const session = decryptSessionStringForAccount(account);
    const creds = telegramApiCredentialsForAccount(account);
    const res = unwrapTelethonBridge(
      await runTelethonBridgeAsync<{
        userId: string;
        username: string;
        session: string;
      }>({
        action: 'get_me',
        session,
        ...telethonCommon(creds, device, proxyPayload),
      }),
    );
    const un = res.username ?? '';
    await AccountModel.findByIdAndUpdate(account._id, {
      $set: {
        ...(un ? { telegramUsername: un } : {}),
        lastUsedAt: new Date(),
      },
    });
    await logSessionEvent(account._id, 'session_loaded', { userId: res.userId });
    return { userId: res.userId, telegramUsername: un };
  } catch (err) {
    const mapped =
      err instanceof MissingTelegramApiCredentialsError
        ? new TgDomainError({
            kind: 'unknown',
            code: 'NO_API_CREDENTIALS',
            message: err.message,
            retryable: false,
          })
        : err instanceof TgDomainError
          ? err
          : mapTgError(err);
    await logSessionEvent(account._id, 'session_invalidated', {
      code: mapped.code,
      message: mapped.message,
    });
    if (mapped.kind === 'auth_invalid' || mapped.kind === 'phone_banned') {
      await AccountModel.findByIdAndUpdate(account._id, { $set: { status: 'banned' } });
    }
    throw mapped;
  }
}
