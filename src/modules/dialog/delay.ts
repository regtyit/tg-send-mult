/** Turn a single pause (sec) into a min/max range with slight random spread. */
export function delayRangeFromPause(
  pauseSec: number,
  jitterFraction = 0.15,
): { min: number; max: number } {
  const base = Math.max(0, Math.floor(pauseSec));
  if (base === 0) return { min: 0, max: 0 };
  const spread = Math.max(3, Math.round(base * jitterFraction));
  return {
    min: Math.max(0, base - spread),
    max: base + spread,
  };
}

/** Random delay in ms between min and max seconds (inclusive). */
export function pickDelayMs(min: number, max: number): number {
  const lo = Math.max(0, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  if (hi <= lo) return lo * 1000;
  const sec = lo + Math.floor(Math.random() * (hi - lo + 1));
  return sec * 1000;
}
