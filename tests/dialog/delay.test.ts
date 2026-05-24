import { describe, expect, it } from 'vitest';
import { delayRangeFromPause, pickDelayMs } from '../../src/modules/dialog/delay';

describe('delayRangeFromPause', () => {
  it('spreads a single pause into min/max', () => {
    const { min, max } = delayRangeFromPause(60);
    expect(min).toBeLessThan(60);
    expect(max).toBeGreaterThan(60);
  });

  it('returns zero range for zero pause', () => {
    expect(delayRangeFromPause(0)).toEqual({ min: 0, max: 0 });
  });
});

describe('pickDelayMs', () => {
  it('returns ms within range', () => {
    for (let i = 0; i < 20; i++) {
      const ms = pickDelayMs(10, 20);
      expect(ms).toBeGreaterThanOrEqual(10_000);
      expect(ms).toBeLessThanOrEqual(20_000);
    }
  });
});
