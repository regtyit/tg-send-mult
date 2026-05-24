import { Types } from 'mongoose';
import { ContactModel, MessageModel } from '../../db/models';
import type { ContactDoc } from '../../db/models/Contact';
import { pickAccountForEvenDistribution } from './evenDistribution';

export type StickyAssignmentContext = {
  /** Running counts for this enqueue pass — drives even spread for new links. */
  assignmentCounts: Map<string, number>;
};

/**
 * Sticky sender assignment.
 *
 * - If this contact already has a sender link (`assignedSenderId` or a prior
 *   successful send from a pool account), reuse that sender when they are in
 *   the campaign pool.
 * - Otherwise assign the eligible sender with the fewest assignments in this
 *   batch so load is spread evenly across the pool.
 */
export async function pickStickyAccountForContact(
  contact: ContactDoc,
  pool: Types.ObjectId[],
  ctx?: StickyAssignmentContext,
): Promise<Types.ObjectId | null> {
  if (!pool.length) return null;
  const poolStr = new Set(pool.map((id) => id.toString()));

  const linked = await resolveLinkedSenderId(contact, pool, poolStr);
  if (linked && poolStr.has(linked.toString())) {
    bumpAssignmentCount(ctx, linked);
    return linked;
  }

  if (linked && !poolStr.has(linked.toString())) {
    await ContactModel.updateOne(
      { _id: contact._id },
      { $unset: { assignedSenderId: 1, assignedSenderAt: 1 } },
    );
  }

  const counts = ctx?.assignmentCounts ?? new Map<string, number>();
  const picked = await pickAccountForEvenDistribution(pool, counts);
  if (!picked) return null;

  await ContactModel.updateOne(
    { _id: contact._id },
    { $set: { assignedSenderId: picked, assignedSenderAt: new Date() } },
  );
  bumpAssignmentCount(ctx, picked);
  return picked;
}

async function resolveLinkedSenderId(
  contact: ContactDoc,
  pool: Types.ObjectId[],
  poolStr: Set<string>,
): Promise<Types.ObjectId | null> {
  const fromField = contact.assignedSenderId
    ? new Types.ObjectId(String(contact.assignedSenderId))
    : null;
  if (fromField && poolStr.has(fromField.toString())) {
    return fromField;
  }

  const lastSent = await MessageModel.findOne({
    contactId: contact._id,
    accountId: { $in: pool },
    status: 'sent',
  })
    .sort({ sentAt: -1 })
    .select('accountId')
    .lean();

  if (lastSent?.accountId) {
    const id = new Types.ObjectId(String(lastSent.accountId));
    if (poolStr.has(id.toString())) {
      if (!fromField || fromField.toString() !== id.toString()) {
        await ContactModel.updateOne(
          { _id: contact._id },
          { $set: { assignedSenderId: id, assignedSenderAt: new Date() } },
        );
      }
      return id;
    }
  }

  return fromField;
}

function bumpAssignmentCount(ctx: StickyAssignmentContext | undefined, accountId: Types.ObjectId): void {
  if (!ctx) return;
  const key = accountId.toString();
  ctx.assignmentCounts.set(key, (ctx.assignmentCounts.get(key) ?? 0) + 1);
}

/** Persist sender link after a successful delivery. */
export async function persistSenderLink(
  contactId: Types.ObjectId,
  accountId: Types.ObjectId,
): Promise<void> {
  await ContactModel.updateOne(
    { _id: contactId },
    { $set: { assignedSenderId: accountId, assignedSenderAt: new Date() } },
  );
}
