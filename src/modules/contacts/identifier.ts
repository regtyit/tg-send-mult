import { toE164 } from './normalize';

/** Telegram @username: 5–32 chars, letter first, then letters, digits, underscore. */
const TELEGRAM_USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

export function normalizeUsername(v: string): string {
  const u = v.trim().replace(/^@+/, '');
  if (!TELEGRAM_USERNAME_RE.test(u)) return '';
  return u.toLowerCase();
}

export interface ParsedContactIdentifier {
  phoneE164: string | null;
  username: string;
}

/**
 * Parse a single recipient token from CSV "phone" cells, manual add, or alias columns.
 * Accepts E.164 / national numbers, @username, bare username, and t.me links.
 */
export function parseContactIdentifier(
  raw: string,
  opts: { defaultCountry?: string } = {},
): ParsedContactIdentifier {
  const trimmed = raw.trim();
  if (!trimmed) return { phoneE164: null, username: '' };

  const tgLink = trimmed.match(
    /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/+@?([a-zA-Z][a-zA-Z0-9_]{4,31})\/?$/i,
  );
  if (tgLink) {
    return { phoneE164: null, username: tgLink[1]!.toLowerCase() };
  }

  if (trimmed.startsWith('@')) {
    const username = normalizeUsername(trimmed);
    return { phoneE164: null, username };
  }

  const e164 = toE164(trimmed, opts.defaultCountry);
  if (e164) return { phoneE164: e164, username: '' };

  const username = normalizeUsername(trimmed);
  if (username) return { phoneE164: null, username };

  return { phoneE164: null, username: '' };
}
