export type TgErrorKind =
  | 'message_too_long'
  | 'flood_wait'
  | 'peer_flood'
  | 'peer_blocked'
  | 'peer_invalid'
  | 'proxy_invalid'
  | 'account_frozen'
  | 'auth_invalid'
  | 'phone_banned'
  | 'phone_invalid'
  | 'phone_code_invalid'
  | 'phone_password_invalid'
  | 'network'
  | 'unknown';

export interface TelethonBridgeErr {
  code: string;
  message: string;
  waitSeconds?: number;
}

export function bridgeErrorToDomain(b: TelethonBridgeErr): TgDomainError {
  const flood = /^FLOOD_WAIT_(\d+)$/i.exec(b.code);
  if (flood) {
    const sec = Number(flood[1]);
    return new TgDomainError({
      kind: 'flood_wait',
      code: 'FLOOD_WAIT',
      message: `FLOOD_WAIT_${sec}`,
      waitSeconds: sec,
      retryable: true,
    });
  }
  if (b.waitSeconds != null) {
    return new TgDomainError({
      kind: 'flood_wait',
      code: 'FLOOD_WAIT',
      message: `FLOOD_WAIT_${b.waitSeconds}`,
      waitSeconds: b.waitSeconds,
      retryable: true,
    });
  }

  // Classify by Telegram `code` first (e.g. "AUTH_KEY_UNREGISTERED", "PEER_FLOOD"),
  // because `mapTgError` does exact-string matching and a "CODE: description" combo
  // would otherwise miss every classification.
  const msg = (b.message ?? '').trim();
  const code = (b.code ?? '').trim();
  const richMessage = msg && msg.toUpperCase() !== code.toUpperCase() && code ? `${code}: ${msg}` : msg || code;

  if (code) {
    const byCode = mapTgError({ errorMessage: code });
    if (byCode.kind !== 'unknown') {
      return new TgDomainError({
        kind: byCode.kind,
        code: byCode.code,
        message: richMessage || byCode.message,
        waitSeconds: byCode.waitSeconds,
        retryable: byCode.retryable,
      });
    }
  }

  if (msg) {
    const byMsg = mapTgError({ errorMessage: msg });
    if (byMsg.kind !== 'unknown') {
      return new TgDomainError({
        kind: byMsg.kind,
        code: byMsg.code,
        message: richMessage || byMsg.message,
        waitSeconds: byMsg.waitSeconds,
        retryable: byMsg.retryable,
      });
    }
  }

  return new TgDomainError({
    kind: 'unknown',
    code: code ? code.toUpperCase() : 'UNKNOWN',
    message: richMessage || 'UNKNOWN',
    retryable: false,
  });
}

export class TgDomainError extends Error {
  readonly kind: TgErrorKind;
  readonly code: string;
  readonly waitSeconds?: number;
  readonly retryable: boolean;

  constructor(opts: {
    kind: TgErrorKind;
    code: string;
    message: string;
    waitSeconds?: number;
    retryable?: boolean;
  }) {
    super(opts.message);
    this.kind = opts.kind;
    this.code = opts.code;
    this.waitSeconds = opts.waitSeconds;
    this.retryable = opts.retryable ?? false;
    this.name = 'TgDomainError';
  }
}

interface RpcErrorLike {
  errorMessage?: string;
  message?: string;
  code?: number;
  seconds?: number;
}

/**
 * Maps RPC-style errors (Telethon bridge, legacy shapes with .errorMessage, etc.) into a TgDomainError.
 * Typical Telegram codes look like "FLOOD_WAIT_30",
 * "PEER_FLOOD", "USER_PRIVACY_RESTRICTED" etc.
 */
export function mapTgError(err: unknown): TgDomainError {
  if (err instanceof TgDomainError) return err;
  const e = (err ?? {}) as RpcErrorLike;
  const raw =
    (typeof e.errorMessage === 'string' && e.errorMessage) ||
    (typeof e.message === 'string' && e.message) ||
    'UNKNOWN';

  const upper = raw.toUpperCase();

  // FLOOD_WAIT_X — temporary, has wait duration in seconds
  const floodMatch = /^FLOOD_WAIT_(\d+)$/i.exec(upper);
  if (floodMatch) {
    const sec = Number(floodMatch[1]);
    return new TgDomainError({
      kind: 'flood_wait',
      code: 'FLOOD_WAIT',
      message: `FLOOD_WAIT_${sec}`,
      waitSeconds: sec,
      retryable: true,
    });
  }

  if (upper === 'PEER_FLOOD') {
    return new TgDomainError({
      kind: 'peer_flood',
      code: 'PEER_FLOOD',
      message: 'PEER_FLOOD: account shadow-banned for outreach',
      retryable: false,
    });
  }

  if (
    upper.startsWith('USER_PRIVACY_RESTRICTED') ||
    upper === 'USER_IS_BLOCKED' ||
    upper === 'INPUT_USER_DEACTIVATED' ||
    upper === 'YOU_BLOCKED_USER' ||
    upper === 'PEER_ID_INVALID' ||
    /CANNOT FIND ANY ENTITY CORRESPONDING TO/.test(upper)
  ) {
    return new TgDomainError({
      kind: upper === 'PEER_ID_INVALID' || /CANNOT FIND ANY ENTITY CORRESPONDING TO/.test(upper)
        ? 'peer_invalid'
        : 'peer_blocked',
      code: upper,
      message: raw,
      retryable: false,
    });
  }

  if (
    upper === 'AUTH_KEY_UNREGISTERED' ||
    upper === 'AUTH_KEY_INVALID' ||
    upper === 'SESSION_REVOKED' ||
    upper === 'SESSION_EXPIRED' ||
    upper === 'USER_DEACTIVATED'
  ) {
    return new TgDomainError({
      kind: 'auth_invalid',
      code: upper,
      message: raw,
      retryable: false,
    });
  }

  if (upper === 'PHONE_NUMBER_BANNED') {
    return new TgDomainError({
      kind: 'phone_banned',
      code: upper,
      message: raw,
      retryable: false,
    });
  }

  if (upper === 'PHONE_NUMBER_INVALID' || upper === 'PHONE_NUMBER_UNOCCUPIED') {
    return new TgDomainError({
      kind: 'phone_invalid',
      code: upper,
      message: raw,
      retryable: false,
    });
  }

  if (
    upper === 'PHONE_CODE_INVALID' ||
    upper === 'PHONE_CODE_EXPIRED' ||
    upper === 'PHONE_CODE_EMPTY'
  ) {
    return new TgDomainError({
      kind: 'phone_code_invalid',
      code: upper,
      message: raw,
      retryable: false,
    });
  }

  if (upper === 'PASSWORD_HASH_INVALID') {
    return new TgDomainError({
      kind: 'phone_password_invalid',
      code: upper,
      message: raw,
      retryable: false,
    });
  }

  if (upper === 'FROZEN_METHOD_INVALID') {
    return new TgDomainError({
      kind: 'account_frozen',
      code: 'FROZEN_METHOD_INVALID',
      message:
        'Telegram returned FROZEN_METHOD_INVALID: this session is temporarily restricted from some API methods. Open the official Telegram app with this account, complete any login or security prompts, and wait if you recently changed 2FA or profile. Then retry; for usernames you can also use a numeric user id or an existing chat.',
      retryable: false,
    });
  }

  // Heuristic: network errors
  if (
    /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/i.test(raw) ||
    /INCOMPLETEREADERROR|INCOMPLETEREAD|SERVER CLOSED THE CONNECTION|PROXY CLOSED THE CONNECTION/i.test(upper) ||
    /BYTES READ ON A TOTAL OF \d+/i.test(upper) ||
    /FAKETLS SERVER HELLO VERIFICATION FAILED|INVALID SERVER DIGEST/i.test(upper) ||
    upper.includes('TIMEOUT') ||
    upper.includes('CONNECTION')
  ) {
    return new TgDomainError({
      kind: 'network',
      code: 'NETWORK',
      message:
        /INCOMPLETEREADERROR|INCOMPLETEREAD|SERVER CLOSED THE CONNECTION|PROXY CLOSED THE CONNECTION|FAKETLS SERVER HELLO VERIFICATION FAILED|INVALID SERVER DIGEST|BYTES READ ON A TOTAL OF/i.test(
          upper,
        )
          ? `Network/proxy transport failure: ${raw}. Check MTProxy host/port/secret, and for ee FakeTLS secrets verify the domain payload matches the proxy endpoint.`
          : raw,
      retryable: true,
    });
  }

  return new TgDomainError({
    kind: 'unknown',
    code: upper,
    message: raw,
    retryable: false,
  });
}

/** RPC 406 / limited-session guard used by username and phone resolution fallbacks. */
export function isFrozenMethodError(err: unknown): boolean {
  const e = (err ?? {}) as RpcErrorLike;
  const raw =
    (typeof e.errorMessage === 'string' && e.errorMessage) ||
    (typeof e.message === 'string' && e.message) ||
    '';
  return raw.toUpperCase() === 'FROZEN_METHOD_INVALID';
}
