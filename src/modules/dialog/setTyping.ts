import type { AccountDoc } from '../../db/models/Account';
import type { ProxyDoc } from '../../db/models/Proxy';
import { telegramApiCredentialsForAccount } from '../../telegram/apiCredentials';
import { deviceProfileFromAccount } from '../../telegram/deviceProfile';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { decryptSessionStringForAccount } from '../../telegram/sessionString';
import { assertMtProxyPolicy } from '../proxy/policy';

export async function setTypingForPeer(
  account: AccountDoc,
  proxy: ProxyDoc | null,
  peer: string,
  seconds: number,
  opts: { importContactFirstName?: string } = {},
): Promise<void> {
  assertMtProxyPolicy(account, proxy);
  const creds = telegramApiCredentialsForAccount(account);
  const proxyPayload = proxyDocToTelethonPayload(proxy);
  unwrapTelethonBridge(
    await runTelethonBridgeAsync({
      action: 'set_typing',
      session: decryptSessionStringForAccount(account),
      peer: peer.trim(),
      seconds: Math.min(30, Math.max(1, Math.floor(seconds))),
      ...(opts.importContactFirstName?.trim()
        ? { importContactFirstName: opts.importContactFirstName.trim().slice(0, 64) }
        : {}),
      ...telethonCommon(creds, deviceProfileFromAccount(account), proxyPayload),
    }),
  );
}
