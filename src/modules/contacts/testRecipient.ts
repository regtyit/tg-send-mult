import type { AccountDoc } from '../../db/models/Account';
import { ContactModel } from '../../db/models';
import { toE164 } from './normalize';

function normalizeUsername(raw: string): string {
  const u = raw.trim().replace(/^@+/, '');
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(u)) return '';
  return u.toLowerCase();
}

export async function ensureContactForTestRecipient(account: Pick<AccountDoc, 'phone' | 'telegramUsername'>): Promise<{
  upserted: boolean;
  reason?: string;
}> {
  const phoneE164 = toE164(String(account.phone ?? ''));
  const username = normalizeUsername(String(account.telegramUsername ?? ''));
  if (!phoneE164 && !username) {
    return { upserted: false, reason: 'account has neither valid phone nor username for contact upsert' };
  }

  const existing = phoneE164
    ? await ContactModel.findOne({ phoneE164 }).lean()
    : await ContactModel.findOne({
        username: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      }).lean();

  const tags = [...new Set([...(existing?.tags ?? []), 'test_recipient'])];
  const phone = phoneE164 || existing?.phoneE164 || '';
  const setDoc = {
    username: username || existing?.username || '',
    firstName: existing?.firstName || '',
    lastName: existing?.lastName || '',
    tags,
    importedFrom: existing?.importedFrom || 'account:test_recipient',
    extras: existing?.extras || {},
    ...(phone ? { phoneE164: phone } : {}),
  };
  if (existing?._id) {
    const update: { $set: typeof setDoc; $unset?: { phoneE164: 1 } } = { $set: setDoc };
    if (!phone) update.$unset = { phoneE164: 1 };
    await ContactModel.findByIdAndUpdate(existing._id, update);
  } else {
    await ContactModel.create(setDoc);
  }
  return { upserted: true };
}
