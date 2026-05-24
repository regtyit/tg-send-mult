import type { AccountDoc } from '../../db/models/Account';
import type { ContactDoc } from '../../db/models/Contact';

/**
 * Telethon peer string for send_message / set_typing / list_incoming filters.
 */
export function peerStringFromAccount(account: AccountDoc): string {
  const user = String(account.telegramUsername || '').trim();
  if (user) return user.startsWith('@') ? user : `@${user}`;
  const phone = String(account.phone || '').trim();
  if (phone) return phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;
  return '';
}

export function peerStringFromContact(contact: ContactDoc): string {
  const user = String(contact.username || '').trim();
  if (user) return user.startsWith('@') ? user : `@${user}`;
  const phone = String(contact.phoneE164 || '').trim();
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
  const phone = String(account.phone || '').trim();
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
  const phone = String(contact.phoneE164 || '').trim();
  return {
    peerUserId: uid || undefined,
    peerUsername: user || undefined,
    peerPhone: phone || undefined,
  };
}
