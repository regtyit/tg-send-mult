/** Display label for account pickers and tables (phone, @username, label, status). */
export interface AccountLabelInput {
  phone?: string;
  label?: string;
  telegramUsername?: string;
  status?: string;
}

export function accountPickerLabel(a: AccountLabelInput): string {
  const user = String(a.telegramUsername ?? '')
    .trim()
    .replace(/^@+/, '');
  return [
    a.phone?.trim() || null,
    user ? `@${user}` : null,
    a.label?.trim() ? `(${a.label.trim()})` : null,
    a.status?.trim() ? `[${a.status.trim()}]` : null,
  ]
    .filter(Boolean)
    .join(' ');
}
