/** Digits only (for matching filters to Telegram entity.phone). */
export function normalizePhoneDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

/** Telethon peer string: prefer +E.164 when we only have digits. */
export function normalizePhoneE164(raw: string): string {
  const digits = normalizePhoneDigits(raw);
  if (!digits) return '';
  return `+${digits}`;
}
