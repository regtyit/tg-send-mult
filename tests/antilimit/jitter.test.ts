import { describe, expect, it } from 'vitest';
import { lognormalDelayMs } from '../../src/modules/antilimit/jitter';

describe('lognormalDelayMs', () => {
  it('returns bounded delay in milliseconds', () => {
    for (let i = 0; i < 50; i++) {
      const ms = lognormalDelayMs(8, 0.5);
      expect(ms).toBeGreaterThanOrEqual(500);
      expect(ms).toBeLessThanOrEqual(120_000);
    }
  });
});
