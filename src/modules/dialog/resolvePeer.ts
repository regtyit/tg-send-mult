import type { AccountDoc } from '../../db/models/Account';
import type { ContactDoc } from '../../db/models/Contact';
import { normalizePhoneDigits, normalizePhoneE164 } from './normalizePhone';

export function peerImportFirstName(
  account: Pick<AccountDoc, 'label' | 'phone' | 'telegramUsername'> | null | undefined,
): string {
  if (!account) return 'Contact';
  const label = String(account.label || '').trim();
  if (label) return label.slice(0, 64);
  const user = String(account.telegramUsername || '').trim().replace(/^@+/, '');
  if (user) return user.slice(0, 64);
  const digits = normalizePhoneDigits(String(account.phone || ''));
  return digits ? `+${digits}`.slice(0, 64) : 'Contact';
}

export function peerImportFirstNameFromContact(
  contact: Pick<ContactDoc, 'firstName' | 'lastName' | 'username' | 'phoneE164'> | null | undefined,
): string {
  if (!contact) return 'Contact';
  const first = String(contact.firstName || '').trim();
  const last = String(contact.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full.slice(0, 64);
  const user = String(contact.username || '').trim().replace(/^@+/, '');
  if (user) return user.slice(0, 64);
  const phone = normalizePhoneE164(String(contact.phoneE164 || ''));
  return phone ? phone.slice(0, 64) : 'Contact';
}

/**
 * Telethon peer string for send_message / set_typing / list_incoming filters.
 */
export function peerStringFromAccount(account: AccountDoc): string {
  const user = String(account.telegramUsername || '').trim();
  if (user) return user.startsWith('@') ? user : `@${user}`;
  const phone = normalizePhoneE164(String(account.phone || ''));
  if (phone) return phone;
  return '';
}

export function peerStringFromContact(contact: ContactDoc): string {
  const user = String(contact.username || '').trim();
  if (user) return user.startsWith('@') ? user : `@${user}`;
  const phone = normalizePhoneE164(String(contact.phoneE164 || ''));
  if (phone) return phone;
  const uid = String(contact.userId || '').trim();
  if (uid) return uid;
  return '';
}

export function peerFilterFromAccount(account: AccountDoc): {
  peerUserId?: string;
  peerUsername?: string;
  peerPhone?: string;
} {
  const user = String(account.telegramUsername || '').trim().replace(/^@+/, '');
  const phone = normalizePhoneDigits(String(account.phone || ''));
  return {
    peerUsername: user || undefined,
    peerPhone: phone || undefined,
  };
}

export function peerFilterFromContact(contact: ContactDoc): {
  peerUserId?: string;
  peerUsername?: string;
  peerPhone?: string;
} {
  const uid = String(contact.userId || '').trim();
  const user = String(contact.username || '').trim().replace(/^@+/, '');
  const phone = normalizePhoneDigits(String(contact.phoneE164 || ''));
  return {
    peerUserId: uid || undefined,
    peerUsername: user || undefined,
    peerPhone: phone || undefined,
  };
}
