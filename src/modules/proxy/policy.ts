import type { ProxyDoc } from '../../db/models/Proxy';
import { TgDomainError } from '../../telegram/errors';
import { phoneCountryIso2 } from '../accounts/phoneCountry';

const TELEGRAM_PROXY_TYPES = ['mtproto', 'socks5', 'http'] as const;

/**
 * Enforces Telegram access policy:
 * - Every Telegram task must use a proxy (MTProto, SOCKS5, or HTTP)
 * - Proxy exit country must match account phone country when set on the proxy
 */
export function assertTelegramProxyPolicy(account: { phone: string }, proxy: ProxyDoc | null): void {
  if (!proxy) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'PROXY_REQUIRED',
      message: 'Telegram task requires a proxy, but account has none assigned',
    });
  }

  if (!TELEGRAM_PROXY_TYPES.includes(proxy.type as (typeof TELEGRAM_PROXY_TYPES)[number])) {
    throw new TgDomainError({
      kind: 'proxy_invalid',
      code: 'PROXY_TYPE_INVALID',
      message: `Unsupported proxy type: ${proxy.type}`,
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

/** @deprecated Use {@link assertTelegramProxyPolicy} */
export const assertMtProxyPolicy = assertTelegramProxyPolicy;
