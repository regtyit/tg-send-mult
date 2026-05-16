import { describe, expect, it } from 'vitest';
import type { AccountDoc } from '../../src/db/models/Account';
import { recomputeHealthScore } from '../../src/modules/multi/health';

describe('recomputeHealthScore', () => {
  it('returns value in 0..1', () => {
    const acc = {
      healthMetrics: { sent24h: 10, failed24h: 0, floodWait24h: 0, peerFlood24h: 0 },
    } as AccountDoc;
    const s = recomputeHealthScore(acc);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('penalizes peer flood metrics', () => {
    const clean = { healthMetrics: { sent24h: 100, failed24h: 0, floodWait24h: 0, peerFlood24h: 0 } } as AccountDoc;
    const bad = { healthMetrics: { sent24h: 100, failed24h: 0, floodWait24h: 0, peerFlood24h: 10 } } as AccountDoc;
    expect(recomputeHealthScore(bad)).toBeLessThan(recomputeHealthScore(clean));
  });
});
