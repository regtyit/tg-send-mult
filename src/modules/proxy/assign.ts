import { Types } from 'mongoose';
import { AccountModel, ProxyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import type { ProxyDoc } from '../../db/models/Proxy';
import { phoneCountryIso2 } from '../accounts/phoneCountry';
import { TgDomainError } from '../../telegram/errors';
import { assertMtProxyPolicy } from './policy';

export async function ensureProxyNotUsedByAnotherAccount(
  proxyId: string,
  accountId: string,
): Promise<void> {
  const conflict = await AccountModel.findOne({
    _id: { $ne: new Types.ObjectId(accountId) },
    proxyId: new Types.ObjectId(proxyId),
  })
    .select('_id phone')
    .lean();
  if (conflict) {
    throw new Error(`MTProxy already assigned to another account: ${conflict.phone}`);
  }
}

async function usedProxyIdsExcept(accountId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const used = await AccountModel.find({
    _id: { $ne: accountId },
    proxyId: { $ne: null },
  })
    .select('proxyId')
    .lean();
  return used
    .map((x) => (x.proxyId ? new Types.ObjectId(String(x.proxyId)) : null))
    .filter((x): x is Types.ObjectId => x !== null);
}

/**
 * Free MTProxies for the account phone country, best health first.
 * Optionally puts `preferProxyId` first when it is valid for that country.
 */
export async function listMtProxiesForPhoneCountry(
  phone: string,
  accountId: Types.ObjectId,
  preferProxyId?: string | null,
): Promise<ProxyDoc[]> {
  const country = phoneCountryIso2(phone);
  if (!country) return [];

  const usedIds = await usedProxyIdsExcept(accountId);
  const query = {
    type: 'mtproto' as const,
    country,
    ...(usedIds.length ? { _id: { $nin: usedIds } } : {}),
  };

  const available = await ProxyModel.find(query).sort({ healthScore: -1, createdAt: 1 });
  if (!preferProxyId?.trim()) return available;

  const preferredId = preferProxyId.trim();
  const preferred =
    available.find((p) => String(p._id) === preferredId) ??
    (await ProxyModel.findOne({
      _id: new Types.ObjectId(preferredId),
      type: 'mtproto',
      country,
    }));
  if (!preferred) return available;

  const rest = available.filter((p) => String(p._id) !== String(preferred._id));
  return [preferred, ...rest];
}

/**
 * Atomically claim an unused MTProxy (type mtproto) for the account country.
 */
export async function claimMtProxyForAccount(
  accountId: Types.ObjectId,
  country: string,
): Promise<string | null> {
  const upper = country.toUpperCase();
  const MAX_ATTEMPTS = 8;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const usedIds = await usedProxyIdsExcept(accountId);
    const candidate = await ProxyModel.findOne({
      type: 'mtproto',
      country: upper,
      ...(usedIds.length ? { _id: { $nin: usedIds } } : {}),
    })
      .sort({ healthScore: -1, createdAt: 1 })
      .select('_id')
      .lean();
    if (!candidate?._id) return null;

    const stillFree = await AccountModel.exists({
      _id: { $ne: accountId },
      proxyId: candidate._id,
    });
    if (stillFree) continue;

    const updated = await AccountModel.findOneAndUpdate(
      { _id: accountId },
      { $set: { proxyId: candidate._id } },
      { new: true },
    );
    if (updated) return String(candidate._id);
    return null;
  }
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
 * Assign MTProxy on the account and run `connect` — tries each free in-country
 * MTProxy on transport failures (dead proxy, wrong secret, etc.).
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
      code: 'NO_MTPROXY',
      message: `No free MTProxy for country ${country}. Add MTProto proxies with country=${country} on the Proxies page.`,
      retryable: false,
    });
  }

  let lastErr: unknown;
  const tried: string[] = [];

  for (const proxy of toTry) {
    try {
      try {
        await ensureProxyNotUsedByAnotherAccount(String(proxy._id), String(account._id));
      } catch (conflictErr) {
        if (conflictErr instanceof Error && conflictErr.message.includes('already assigned')) {
          continue;
        }
        throw conflictErr;
      }
      assertMtProxyPolicy(account, proxy);
      const updated = await AccountModel.findByIdAndUpdate(
        account._id,
        { $set: { proxyId: proxy._id } },
        { new: true },
      );
      if (!updated) {
        throw new Error(`Account ${account._id} not found while assigning MTProxy`);
      }
      await connect(updated, proxy);
      return updated;
    } catch (err) {
      lastErr = err;
      tried.push(`${proxy.host}:${proxy.port}`);
      if (!isTransportProxyError(err)) throw err;
    }
  }

  const detail =
    lastErr instanceof Error ? lastErr.message : lastErr != null ? String(lastErr) : 'unknown error';
  throw new TgDomainError({
    kind: 'network',
    code: 'NETWORK',
    message:
      `Connection to Telegram failed via ${tried.length} MTProxy(s) (${tried.join(', ')}). ` +
      `Last error: ${detail}. Check proxy host/port/secret on the Proxies page and run Test.`,
    retryable: true,
  });
}
