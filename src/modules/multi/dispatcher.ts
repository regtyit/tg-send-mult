import type { Types } from 'mongoose';
import { AccountModel } from '../../db/models';
import { getSendQueue } from '../../queue/queues';

export async function pickAccountForSend(
  pool: Types.ObjectId[],
  now = new Date(),
): Promise<Types.ObjectId | null> {
  if (!pool.length) return null;

  const candidates = await AccountModel.find({
    _id: { $in: pool },
    sessionEnc: { $ne: '' },
    status: { $in: ['active', 'warming'] },
    healthScore: { $gte: 0.5 },
    $or: [{ role: { $exists: false } }, { role: 'sender' }],
    $and: [
      { $or: [{ floodWaitUntil: null }, { floodWaitUntil: { $lte: now } }] },
      { $or: [{ quarantineUntil: null }, { quarantineUntil: { $lte: now } }] },
    ],
  }).lean();

  if (!candidates.length) return null;

  let best: Types.ObjectId | null = null;
  let bestLoad = Number.POSITIVE_INFINITY;

  /**
   * Reuse pooled queues instead of opening (and closing) a fresh ioredis
   * connection per candidate. With many accounts each enqueue would otherwise
   * stampede `maxclients` on the Redis side.
   */
  for (const acc of candidates) {
    const q = getSendQueue(acc._id.toString());
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'paused');
    const load = counts.waiting + counts.active + counts.delayed;
    if (load < bestLoad) {
      bestLoad = load;
      best = acc._id;
    }
  }

  return best;
}
