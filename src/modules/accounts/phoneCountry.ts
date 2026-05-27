import { parsePhoneNumber } from 'libphonenumber-js';

/**
 * Best-effort E.164 for DB keys and MTProxy country matching.
 * JSON exports often omit `+`; libphonenumber needs a leading `+` for reliable parsing.
 */
export function normalizePhoneE164(phone: string): string {
  const raw = phone.trim();
  if (!raw) return raw;
  const tryParse = (candidate: string): string | null => {
    try {
      const p = parsePhoneNumber(candidate);
      if (p?.isValid()) return p.format('E.164');
    } catch {
      /* ignore */
    }
    return null;
  };
  if (raw.startsWith('+')) {
    return tryParse(raw) ?? raw;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 15) {
    const withPlus = `+${digits}`;
    return tryParse(withPlus) ?? withPlus;
  }
  return raw;
}

/** ISO 3166-1 alpha-2 from E.164 phone, or null if unknown. */
export function phoneCountryIso2(phone: string): string | null {
  try {
    const normalized = normalizePhoneE164(phone);
    const parsed = parsePhoneNumber(normalized);
    const country = parsed?.country?.toUpperCase();
    return country || null;
  } catch {
    return null;
  }
}
