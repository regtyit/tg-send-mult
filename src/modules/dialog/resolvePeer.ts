import type { AccountDoc } from '../../db/models/Account';
import type { ContactDoc } from '../../db/models/Contact';
import { normalizePhoneDigits, normalizePhoneE164 } from './normalizePhone';

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
