/**
 * Pure MTProxy link/secret parsing (no DB or Telethon deps).
 * Used by the API and the Nuxt dashboard (`@repo/telegram/proxyParse`).
 */

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

  const cleaned = trimmed.toLowerCase().replace(/[^0-9a-f]/g, '');
  const isClassic = /^[0-9a-f]{32}$/i.test(cleaned);
  if (isClassic) return cleaned;
  const isDdEe = /^(dd|ee)[0-9a-f]{32,}$/i.test(cleaned) && cleaned.length % 2 === 0;
  if (isDdEe) {
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
