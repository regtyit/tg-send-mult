/**
 * gramJS stores MTProto sessions as a versioned string (see `telegram/sessions/StringSession.js`):
 * `"1" + base64( dcId(1) | addrLen(2 BE) | addr(utf8) | port(2 BE) | authKey )`
 *
 * Tools that export only phone / DC id / auth key (hex) / user id need this encoding before
 * `import-session` or {@link importSessionString} can persist them.
 */

/** Production IPv4 endpoints (TCP 443). Override with `serverAddress` / `port` if your export lists a host. */
export const GRAMJS_DEFAULT_DC_IPV4: Readonly<Record<number, { host: string; port: number }>> = {
  1: { host: '149.154.175.53', port: 443 },
  2: { host: '149.154.167.50', port: 443 },
  3: { host: '149.154.175.100', port: 443 },
  4: { host: '149.154.167.91', port: 443 },
  5: { host: '91.108.56.130', port: 443 },
};

const STRING_SESSION_VERSION = '1';

export interface BuildGramJsStringSessionOptions {
  dcId: number;
  /** 256-byte key as hex (optional spaces / `0x` prefix stripped). */
  authKeyHex: string;
  /** If omitted, {@link GRAMJS_DEFAULT_DC_IPV4}[dcId] is used (must exist unless you pass host/port). */
  serverAddress?: string;
  port?: number;
}

function normalizeAuthKeyHex(hex: string): Buffer {
  const cleaned = hex.replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new Error('auth key: expected an even-length hex string');
  }
  const buf = Buffer.from(cleaned, 'hex');
  if (buf.length !== 256) {
    throw new Error(`auth key: expected 256 bytes (512 hex chars), got ${buf.length} bytes`);
  }
  return buf;
}

function resolveEndpoint(dcId: number, serverAddress?: string, port?: number): { host: string; port: number } {
  if (serverAddress !== undefined && serverAddress !== '') {
    return { host: serverAddress.trim(), port: port ?? 443 };
  }
  const fallback = GRAMJS_DEFAULT_DC_IPV4[dcId];
  if (!fallback) {
    throw new Error(
      `DC ${dcId}: no default host in GRAMJS_DEFAULT_DC_IPV4; pass serverAddress (and port if not 443)`,
    );
  }
  return { ...fallback, port: port ?? fallback.port };
}

/**
 * Builds a gramJS `StringSession` value (including the leading `1`) from raw MTProto pieces.
 * `userId` is not part of the session wire format; use `getMe()` after connect if you need to verify it.
 */
export function buildGramJsStringSessionV1(opts: BuildGramJsStringSessionOptions): string {
  const dcId = opts.dcId | 0;
  if (dcId < 1 || dcId > 255) {
    throw new Error(`dcId must be 1–255, got ${opts.dcId}`);
  }

  const authKey = normalizeAuthKeyHex(opts.authKeyHex);
  const { host, port } = resolveEndpoint(dcId, opts.serverAddress, opts.port);

  const dcBuffer = Buffer.from([dcId]);
  const addressBuffer = Buffer.from(host, 'utf8');
  const addressLengthBuffer = Buffer.alloc(2);
  addressLengthBuffer.writeInt16BE(addressBuffer.length, 0);
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeInt16BE(port, 0);

  const payload = Buffer.concat([dcBuffer, addressLengthBuffer, addressBuffer, portBuffer, authKey]);
  return STRING_SESSION_VERSION + payload.toString('base64');
}
