import { parsePhoneNumber } from 'libphonenumber-js';

/** ISO 3166-1 alpha-2 from E.164 phone, or null if unknown. */
export function phoneCountryIso2(phone: string): string | null {
  try {
    const parsed = parsePhoneNumber(phone.trim());
    const country = parsed?.country?.toUpperCase();
    return country || null;
  } catch {
    return null;
  }
}
