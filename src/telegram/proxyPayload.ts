import type { ProxyDoc } from '../db/models/Proxy';
import {
  coerceMtProxyImportFields,
  normalizeMtProxySecret,
  tryParseTelegramProxyLink,
} from './proxyParse';

export type TelethonProxyPayload =
  | { type: 'none' }
  | { type: 'mtproto'; host: string; port: number; secret: string }
  | { type: 'socks5' | 'http'; host: string; port: number; username?: string; password?: string };

export { coerceMtProxyImportFields, normalizeMtProxySecret, tryParseTelegramProxyLink };

export function proxyDocToTelethonPayload(proxy: ProxyDoc | null | undefined): TelethonProxyPayload {
  if (!proxy) return { type: 'none' };
  if (proxy.type === 'socks5' || proxy.type === 'http') {
    return {
      type: proxy.type,
      host: proxy.host,
      port: proxy.port,
      username: proxy.login || undefined,
      password: proxy.password || undefined,
    };
  }
  if (proxy.type === 'mtproto') {
    let host = String(proxy.host ?? '').trim();
    let port = proxy.port;
    let secretField = String(proxy.secret ?? '').trim();

    const fromHost = tryParseTelegramProxyLink(host);
    if (fromHost) {
      host = fromHost.host;
      port = fromHost.port;
      if (!secretField) secretField = fromHost.secret;
    }

    const fromSecret = tryParseTelegramProxyLink(secretField);
    if (fromSecret) {
      host = fromSecret.host;
      port = fromSecret.port;
      secretField = fromSecret.secret;
    }

    const secret = normalizeMtProxySecret(secretField);
    const isClassic = /^[0-9a-f]{32}$/i.test(secret);
    const isDdEe = /^(dd|ee)[0-9a-f]{32,}$/i.test(secret) && secret.length % 2 === 0;
    if (secret && !isClassic && !isDdEe) {
      throw new Error(
        `Invalid MTProxy secret for proxy ${proxy.label}. Expected either 16-byte hex (32 chars) or dd/ee-prefixed hex payload.`,
      );
    }
    return {
      type: 'mtproto',
      host,
      port,
      secret,
    };
  }
  return { type: 'none' };
}
