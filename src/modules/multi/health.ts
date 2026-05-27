import type { TgErrorKind } from '../../telegram/errors';
import type { AccountDoc } from '../../db/models/Account';

/**
 * Rolling 24h-ish counters cleared by the scheduler; used to recompute {@link AccountDoc.healthScore}.
 */
export function defaultHealthMetrics(): NonNullable<AccountDoc['healthMetrics']> {
  return { sent24h: 0, failed24h: 0, floodWait24h: 0, peerFlood24h: 0 };
}

/**
 * Transport (MTProxy down) and assignment-policy errors are not treated as
 * "sender reputation" failures for health scoring.
 */
export function deliveryFailureAffectsSenderHealth(kind: TgErrorKind): boolean {
  return kind !== 'network' && kind !== 'proxy_invalid';
}

/**
 * Simple health score from rolling counters (scheduler may refresh metrics).
 * Uses a small Beta-style prior so the first real delivery failure does not
 * immediately drop the score below the sender eligibility threshold when
 * `sent24h` is still zero (common right after starting a campaign).
 */
export function recomputeHealthScore(account: AccountDoc): number {
  const m = account.healthMetrics;
  const sent = m?.sent24h ?? 0;
  const failed = m?.failed24h ?? 0;
  const flood = m?.floodWait24h ?? 0;
  const peer = m?.peerFlood24h ?? 0;
  const attempts = sent + failed;
  const successRate = attempts > 0 ? (sent + 0.5) / (attempts + 1) : 1;
  let score = 0.55 * successRate + 0.45;
  score -= 0.08 * Math.min(flood, 20);
  score -= 0.25 * Math.min(peer, 5);
  return Math.max(0, Math.min(1, score));
}
