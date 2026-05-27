import type { ProxyDoc } from '../db/models/Proxy';

export type TelethonProxyPayload =
  | { type: 'none' }
  | { type: 'mtproto'; host: string; port: number; secret: string }
  | { type: 'socks5' | 'http'; host: string; port: number; username?: string; password?: string };

/**
 * Parse Telegram MTProxy share links: `https://t.me/proxy?...`, schemeless `t.me/proxy?...`,
 * or `tg://proxy?...`. Schemeless `t.me/...` must not be passed to `new URL` without a scheme
 * (it throws); callers that catch and strip non-hex from the whole string corrupt the secret.
 */
export function tryParseTelegramProxyLink(
  raw: string,
): { host: string; port: number; secret: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const l = s.toLowerCase();
  const looksLike =
    l.includes('t.me/proxy?') ||
    l.includes('telegram.me/proxy?') ||
    (l.startsWith('tg://') && l.includes('proxy?'));
  if (!looksLike) return null;

  let urlString = s;
  if (!/^https?:\/\//i.test(urlString) && !/^tg:\/\//i.test(urlString)) {
    urlString = `https://${s.replace(/^\/\//, '')}`;
  }

  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return null;
  }

  const host = (u.searchParams.get('server') ?? '').trim();
  const portRaw = (u.searchParams.get('port') ?? '').trim();
  const secretRaw = (u.searchParams.get('secret') ?? '').trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : 443;

  if (!host || !secretRaw || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  return { host, port, secret: secretRaw };
}

export function normalizeMtProxySecret(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const fromLink = tryParseTelegramProxyLink(trimmed);
  if (fromLink) {
    return normalizeMtProxySecret(fromLink.secret);
  }

  // Keep the full hex secret payload. Telegram MTProxy links can carry:
  // - classic 16-byte hex: 32 chars
  // - dd/ee-prefixed variants with extra payload (e.g. fake-TLS domain bytes)
  // Truncating to 32 chars breaks many valid links.
  const cleaned = trimmed.toLowerCase().replace(/[^0-9a-f]/g, '');
  const isClassic = /^[0-9a-f]{32}$/i.test(cleaned);
  if (isClassic) return cleaned;
  const isDdEe = /^(dd|ee)[0-9a-f]{32,}$/i.test(cleaned) && cleaned.length % 2 === 0;
  if (isDdEe) {
    // Recovery for old broken values produced from schemeless t.me links:
    // "ee" + <server/port digits> + "ee" + <real secret>.
    // Only rewrite when the injected middle chunk is strictly decimal digits.
    const nextMarker = cleaned.slice(2).search(/(?:dd|ee)/);
    if (nextMarker >= 0) {
      const idx = nextMarker + 2;
      const middle = cleaned.slice(2, idx);
      const tail = cleaned.slice(idx);
      const tailLooksValid = /^(dd|ee)[0-9a-f]{32,}$/i.test(tail) && tail.length % 2 === 0;
      if (/^[0-9]{7,16}$/.test(middle) && tailLooksValid) {
        return tail;
      }
    }
    return cleaned;
  }

  // Recovery path for corrupted values: scan every possible dd/ee start and
  // choose the last valid even-length suffix.
  for (let i = cleaned.length - 34; i >= 0; i -= 1) {
    const p = cleaned.slice(i, i + 2);
    if (p !== 'dd' && p !== 'ee') continue;
    const c = cleaned.slice(i);
    if (/^(dd|ee)[0-9a-f]{32,}$/i.test(c) && c.length % 2 === 0) {
      return c;
    }
  }
  return cleaned;
}

/**
 * Normalize host/port/secret when importing from CSV, API, or CLI (share links,
 * stray whitespace, `host:port` in the host column).
 */
export function coerceMtProxyImportFields(opts: {
  host: string;
  port: number;
  secret: string;
}): { host: string; port: number; secret: string } {
  let host = opts.host.trim();
  let port = opts.port;
  let secret = opts.secret.trim();

  const fromLink = tryParseTelegramProxyLink(host) ?? tryParseTelegramProxyLink(secret);
  if (fromLink) {
    return {
      host: fromLink.host,
      port: fromLink.port,
      secret: normalizeMtProxySecret(fromLink.secret),
    };
  }

  // `host:port` in one field (no URL scheme) — common CSV mistake.
  if (!host.includes('://') && !host.includes('/') && !host.includes('?')) {
    const lastColon = host.lastIndexOf(':');
    if (lastColon > 0) {
      const tail = host.slice(lastColon + 1);
      const p = Number.parseInt(tail, 10);
      if (/^\d+$/.test(tail) && Number.isInteger(p) && p > 0 && p <= 65535) {
        host = host.slice(0, lastColon).trim();
        port = p;
      }
    }
  }

  return { host, port, secret: normalizeMtProxySecret(secret) };
}

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
