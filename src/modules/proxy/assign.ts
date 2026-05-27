import { Types } from 'mongoose';
import { AccountModel, ProxyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import type { ProxyDoc } from '../../db/models/Proxy';
import { phoneCountryIso2 } from '../accounts/phoneCountry';
import { TgDomainError } from '../../telegram/errors';
import { assertTelegramProxyPolicy } from './policy';

/**
 * Proxies matching the account phone country, best health first.
 * Multiple accounts may use the same proxy; `preferProxyId` is moved to the front when valid.
 */
export async function listMtProxiesForPhoneCountry(
  phone: string,
  _accountId: Types.ObjectId,
  preferProxyId?: string | null,
): Promise<ProxyDoc[]> {
  const country = phoneCountryIso2(phone);
  if (!country) return [];

  const query = { country };

  const available = await ProxyModel.find(query).sort({ healthScore: -1, createdAt: 1 });
  if (!preferProxyId?.trim()) return available;

  const preferredId = preferProxyId.trim();
  const preferred =
    available.find((p) => String(p._id) === preferredId) ??
    (await ProxyModel.findOne({
      _id: new Types.ObjectId(preferredId),
      country,
    }));
  if (!preferred) return available;

  const rest = available.filter((p) => String(p._id) !== String(preferred._id));
  return [preferred, ...rest];
}

/**
 * Assign a proxy for the account country (any type: mtproto, socks5, http).
 * Multiple accounts may share the same proxy.
 */
export async function claimMtProxyForAccount(
  accountId: Types.ObjectId,
  country: string,
): Promise<string | null> {
  const upper = country.toUpperCase();
  const candidate = await ProxyModel.findOne({ country: upper })
    .sort({ healthScore: -1, createdAt: 1 })
    .select('_id')
    .lean();
  if (!candidate?._id) return null;

  const updated = await AccountModel.findOneAndUpdate(
    { _id: accountId },
    { $set: { proxyId: candidate._id } },
    { new: true },
  );
  if (updated) return String(candidate._id);
  return null;
}

export function isTransportProxyError(err: unknown): boolean {
  if (err instanceof TgDomainError) {
    return err.kind === 'network' || err.kind === 'proxy_invalid';
  }
  if (err instanceof Error) {
    const u = err.message.toUpperCase();
    return (
      u.includes('NETWORK') ||
      u.includes('INCOMPLETEREAD') ||
      u.includes('PROXY') ||
      u.includes('CONNECTION')
    );
  }
  return false;
}

/**
 * Assign a proxy on the account and run `connect` — tries each in-country
 * proxy on transport failures (dead proxy, wrong secret, etc.).
 */
export async function connectAccountViaMtProxies(
  account: AccountDoc,
  connect: (acc: AccountDoc, proxy: ProxyDoc) => Promise<{ userId: string; telegramUsername: string }>,
  preferProxyId?: string,
  options: { maxAttempts?: number } = {},
): Promise<AccountDoc> {
  const country = phoneCountryIso2(account.phone);
  if (!country) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'PHONE_COUNTRY_UNKNOWN',
      message: `Cannot derive phone country from account phone: ${account.phone}`,
      retryable: false,
    });
  }

  const candidates = await listMtProxiesForPhoneCountry(account.phone, account._id, preferProxyId);
  const toTry =
    typeof options.maxAttempts === 'number' && options.maxAttempts > 0
      ? candidates.slice(0, options.maxAttempts)
      : candidates;
  if (!toTry.length) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'NO_PROXY',
      message: `No proxy for country ${country}. Add proxies with country=${country} on the Proxies page.`,
      retryable: false,
    });
  }

  let lastErr: unknown;
  const tried: string[] = [];

  for (const proxy of toTry) {
    try {
      assertTelegramProxyPolicy(account, proxy);
      const updated = await AccountModel.findByIdAndUpdate(
        account._id,
        { $set: { proxyId: proxy._id } },
        { new: true },
      );
      if (!updated) {
        throw new Error(`Account ${account._id} not found while assigning proxy`);
      }
      await connect(updated, proxy);
      return updated;
    } catch (err) {
      lastErr = err;
      tried.push(`${proxy.type} ${proxy.host}:${proxy.port}`);
      if (!isTransportProxyError(err)) throw err;
    }
  }

  const detail =
    lastErr instanceof Error ? lastErr.message : lastErr != null ? String(lastErr) : 'unknown error';
  throw new TgDomainError({
    kind: 'network',
    code: 'NETWORK',
    message:
      `Connection to Telegram failed via ${tried.length} proxy/proxies (${tried.join(', ')}). ` +
      `Last error: ${detail}. Check proxy settings on the Proxies page and run Test.`,
    retryable: true,
  });
}
