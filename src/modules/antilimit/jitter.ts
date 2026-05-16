/**
 * Lognormal delay in ms: exp(normal(meanSec, sigma)) * 1000.
 *
 * Edge cases that callers care about:
 * - `Math.random()` can return exactly 0. `Math.log(0)` is `-Infinity`, and if
 *   `Math.cos(2π·u2)` is also 0 you get `0 * Infinity = NaN`. Without a guard
 *   that NaN propagates through `Math.min/max/round` and is then handed to
 *   `setTimeout`, where it behaves like 0 — i.e. no jitter at all. Resample
 *   when `u1` is too close to 0.
 * - `meanSec`/`sigma` may legitimately be 0 (no jitter requested).
 */
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 120_000;

export function lognormalDelayMs(meanSec: number, sigma: number): number {
  if (!Number.isFinite(meanSec) || meanSec <= 0) return MIN_DELAY_MS;
  if (!Number.isFinite(sigma) || sigma < 0) sigma = 0;
  if (sigma === 0) {
    return clampDelay(Math.round(meanSec * 1000));
  }
  let u1 = Math.random();
  while (u1 < Number.EPSILON) u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const ms = Math.exp(Math.log(meanSec) + sigma * z0) * 1000;
  if (!Number.isFinite(ms)) return MIN_DELAY_MS;
  return clampDelay(Math.round(ms));
}

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_DELAY_MS;
  return Math.min(Math.max(ms, MIN_DELAY_MS), MAX_DELAY_MS);
}
