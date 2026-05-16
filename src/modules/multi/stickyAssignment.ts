import { Types } from 'mongoose';
import { ContactModel } from '../../db/models';
import type { ContactDoc } from '../../db/models/Contact';
import { pickAccountForSend } from './dispatcher';

/**
 * Sticky sender assignment.
 *
 * Goal: a single receiver (Contact) must never receive messages from two
 * different sender accounts. Once a contact is delivered through a sender
 * account, that pairing is persisted on the Contact and reused for all
 * future campaigns.
 *
 * Behavior:
 * - If contact already has `assignedSenderId` and it is in the current pool,
 *   reuse it. (Eligibility — flood, quarantine, banned — is checked at
 *   send-time by the queue processor; we deliberately do NOT fall back to
 *   another sender here, because that would defeat the "single sender per
 *   receiver" rule. The job will be queued and will retry under the same
 *   sender as soon as it becomes eligible.)
 * - If no sticky assignment yet, pick the least-loaded eligible sender from
 *   the pool and persist it on the contact.
 */
export async function pickStickyAccountForContact(
  contact: ContactDoc,
  pool: Types.ObjectId[],
): Promise<Types.ObjectId | null> {
  if (!pool.length) return null;
  const poolStr = new Set(pool.map((id) => id.toString()));

  const existing = contact.assignedSenderId
    ? new Types.ObjectId(String(contact.assignedSenderId))
    : null;
  if (existing && poolStr.has(existing.toString())) {
    return existing;
  }

  const picked = await pickAccountForSend(pool);
  if (!picked) return null;

  await ContactModel.updateOne(
    { _id: contact._id },
    { $set: { assignedSenderId: picked, assignedSenderAt: new Date() } },
  );
  return picked;
}
