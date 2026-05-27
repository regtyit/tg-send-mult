import { AccountModel } from '../../db/models';
import { defaultHealthMetrics, recomputeHealthScore } from '../multi/health';

/** Reset rolling health counters and recompute score (e.g. after MTProxy outages). */
export async function restoreAccountHealthById(accountId: string) {
  const acc = await AccountModel.findById(accountId);
  if (!acc) return null;
  acc.healthMetrics = defaultHealthMetrics();
  acc.healthScore = recomputeHealthScore(acc);
  await acc.save();
  return acc;
}
