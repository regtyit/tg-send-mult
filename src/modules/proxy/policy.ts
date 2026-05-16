import { parsePhoneNumber } from 'libphonenumber-js';
import type { ProxyDoc } from '../../db/models/Proxy';
import { TgDomainError } from '../../telegram/errors';

function phoneCountryIso2(phone: string): string | null {
  try {
    const parsed = parsePhoneNumber(phone.trim());
    const country = parsed?.country?.toUpperCase();
    return country || null;
  } catch {
    return null;
  }
}

/**
 * Enforces Telegram access policy:
 * - Every Telegram task must use MTProxy
 * - MTProxy exit country must match account phone country
 */
export function assertMtProxyPolicy(account: { phone: string }, proxy: ProxyDoc | null): void {
  if (!proxy) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'MTPROXY_REQUIRED',
      message: 'Telegram task requires MTProxy, but account has no proxy assigned',
    });
  }

  if (proxy.type !== 'mtproto') {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'MTPROXY_REQUIRED',
      message: `Telegram task requires MTProxy, got ${proxy.type}`,
    });
  }

  const phoneCountry = phoneCountryIso2(account.phone);
  if (!phoneCountry) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'PHONE_COUNTRY_UNKNOWN',
      message: `Cannot derive phone country from account phone: ${account.phone}`,
    });
  }

  const proxyCountry = String(proxy.country ?? '').trim().toUpperCase();
  if (!proxyCountry) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'PROXY_COUNTRY_MISSING',
      message: `Proxy ${proxy.label} is missing country`,
    });
  }

  if (proxyCountry !== phoneCountry) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'PROXY_COUNTRY_MISMATCH',
      message: `Proxy country ${proxyCountry} does not match phone country ${phoneCountry}`,
    });
  }
}
