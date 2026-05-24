import type { AccountDoc } from '../../db/models/Account';

/**
 * Simple health score from rolling counters (scheduler may refresh metrics).
 */
export function recomputeHealthScore(account: AccountDoc): number {
  const m = account.healthMetrics;
  const sent = m?.sent24h ?? 0;
  const failed = m?.failed24h ?? 0;
  const flood = m?.floodWait24h ?? 0;
  const peer = m?.peerFlood24h ?? 0;
  const attempts = sent + failed;
  const successRate = attempts > 0 ? sent / attempts : 1;
  let score = 0.55 * successRate + 0.45;
  score -= 0.08 * Math.min(flood, 20);
  score -= 0.25 * Math.min(peer, 5);
  return Math.max(0, Math.min(1, score));
}
