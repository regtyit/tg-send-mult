import {
  isValidPhoneNumber,
  parsePhoneNumber,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Normalize to E.164. Returns null if invalid.
 */
export function toE164(input: string, defaultCountry?: string): string | null {
  const raw = input.trim().replace(/[\s()-]/g, '');
  if (!raw) return null;
  try {
    const parsed = defaultCountry
      ? parsePhoneNumber(raw, defaultCountry.toUpperCase() as CountryCode)
      : parsePhoneNumber(raw);
    if (!parsed || !isValidPhoneNumber(parsed.number)) return null;
    return parsed.format('E.164');
  } catch {
    return null;
  }
}
