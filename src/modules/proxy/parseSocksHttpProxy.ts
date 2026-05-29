/**
 * Parse SOCKS5/HTTP proxy lines like `host:port` or `host:port:login:password`.
 * IPv4 host only for the 4-part form (hostname or dotted quad).
 */
export interface ParsedSocksHttpProxy {
  host: string;
  port: number;
  login: string;
  password: string;
}

export function parseSocksHttpProxyLine(raw: string): ParsedSocksHttpProxy | null {
  const s = raw.trim();
  if (!s || s.includes('://') || s.includes('/') || s.includes('?')) {
    return null;
  }

  const parts = s.split(':');
  if (parts.length >= 4) {
    const password = parts[parts.length - 1]!.trim();
    const login = parts[parts.length - 2]!.trim();
    const portStr = parts[parts.length - 3]!.trim();
    const port = Number.parseInt(portStr, 10);
    if (!/^\d+$/.test(portStr) || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    const host = parts
      .slice(0, -3)
      .join(':')
      .trim();
    if (!host || !login) return null;
    return { host, port, login, password };
  }

  if (parts.length === 2) {
    const host = parts[0]!.trim();
    const portStr = parts[1]!.trim();
    const port = Number.parseInt(portStr, 10);
    if (!host || !/^\d+$/.test(portStr) || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host, port, login: '', password: '' };
  }

  return null;
}

/** Apply parsed host:port[:login:password] to import/create fields. */
export function coerceSocksHttpImportFields(input: {
  host: string;
  port: number;
  login?: string;
  password?: string;
}): { host: string; port: number; login: string; password: string } {
  const parsed = parseSocksHttpProxyLine(input.host);
  if (parsed) {
    return {
      host: parsed.host,
      port: parsed.port,
      login: parsed.login || input.login?.trim() || '',
      password: parsed.password || input.password?.trim() || '',
    };
  }
  return {
    host: input.host.trim(),
    port: input.port,
    login: input.login?.trim() ?? '',
    password: input.password?.trim() ?? '',
  };
}
