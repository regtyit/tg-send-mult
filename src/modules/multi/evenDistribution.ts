import type { Types } from 'mongoose';
import { AccountModel } from '../../db/models';
import { senderEligibilityFilter } from './senderEligibility';

/**
 * Pick the eligible sender with the fewest assignments in the current batch
 * (and fewest historical sticky links when counts tie).
 */
export async function pickAccountForEvenDistribution(
  pool: Types.ObjectId[],
  assignmentCounts: Map<string, number>,
  now = new Date(),
): Promise<Types.ObjectId | null> {
  if (!pool.length) return null;

  const candidates = await AccountModel.find({
    _id: { $in: pool },
    ...senderEligibilityFilter(now),
  })
    .sort({ _id: 1 })
    .lean();

  if (!candidates.length) return null;

  let best: Types.ObjectId | null = null;
  let bestCount = Number.POSITIVE_INFINITY;

  for (const acc of candidates) {
    const key = acc._id.toString();
    const count = assignmentCounts.get(key) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = acc._id;
    }
  }

  return best;
}
