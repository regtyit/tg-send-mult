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
  const setDoc = {
    phoneE164: phoneE164 || existing?.phoneE164 || '',
    username: username || existing?.username || '',
    firstName: existing?.firstName || '',
    lastName: existing?.lastName || '',
    tags,
    importedFrom: existing?.importedFrom || 'account:test_recipient',
    extras: existing?.extras || {},
  };
  if (existing?._id) {
    await ContactModel.findByIdAndUpdate(existing._id, { $set: setDoc });
  } else {
    await ContactModel.create(setDoc);
  }
  return { upserted: true };
}
