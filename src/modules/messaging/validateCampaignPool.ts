import { Types } from 'mongoose';
import { AccountModel } from '../../db/models';
import { describeSenderEligibility, formatPoolEligibilityError } from '../multi/senderEligibility';

export async function assertCampaignPoolHasEligibleSenders(
  pool: Types.ObjectId[],
): Promise<void> {
  if (!pool.length) {
    throw new Error('Campaign has empty sender pool. Pick at least one sender account.');
  }
  const accounts = await AccountModel.find({ _id: { $in: pool } }).lean();
  if (accounts.some((a) => describeSenderEligibility(a).eligible)) return;
  const missing = pool.length - accounts.length;
  const base = formatPoolEligibilityError(accounts);
  throw new Error(
    missing > 0
      ? `${base} ${missing} account id(s) in the pool no longer exist — edit the campaign and pick current senders.`
      : base,
  );
}
