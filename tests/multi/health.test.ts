import { describe, expect, it } from 'vitest';
import type { AccountDoc } from '../../src/db/models/Account';
import {
  deliveryFailureAffectsSenderHealth,
  recomputeHealthScore,
} from '../../src/modules/multi/health';

describe('recomputeHealthScore', () => {
  it('returns value in 0..1', () => {
    const acc = {
      healthMetrics: { sent24h: 10, failed24h: 0, floodWait24h: 0, peerFlood24h: 0 },
    } as AccountDoc;
    const s = recomputeHealthScore(acc);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('gives full score when there is no send activity yet', () => {
    const idle = {
      healthMetrics: { sent24h: 0, failed24h: 0, floodWait24h: 0, peerFlood24h: 0 },
    } as AccountDoc;
    expect(recomputeHealthScore(idle)).toBe(1);
  });

  it('does not drop below eligibility on the first failed send with no successes yet', () => {
    const cold = {
      healthMetrics: { sent24h: 0, failed24h: 1, floodWait24h: 0, peerFlood24h: 0 },
    } as AccountDoc;
    expect(recomputeHealthScore(cold)).toBeGreaterThanOrEqual(0.5);
  });

  it('penalizes peer flood metrics', () => {
    const clean = { healthMetrics: { sent24h: 100, failed24h: 0, floodWait24h: 0, peerFlood24h: 0 } } as AccountDoc;
    const bad = { healthMetrics: { sent24h: 100, failed24h: 0, floodWait24h: 0, peerFlood24h: 10 } } as AccountDoc;
    expect(recomputeHealthScore(bad)).toBeLessThan(recomputeHealthScore(clean));
  });
});

describe('deliveryFailureAffectsSenderHealth', () => {
  it('ignores network and proxy policy failures', () => {
    expect(deliveryFailureAffectsSenderHealth('network')).toBe(false);
    expect(deliveryFailureAffectsSenderHealth('proxy_invalid')).toBe(false);
    expect(deliveryFailureAffectsSenderHealth('unknown')).toBe(true);
  });
});
