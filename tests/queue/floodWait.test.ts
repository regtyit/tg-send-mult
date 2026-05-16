import { describe, expect, it } from 'vitest';
import { computeFloodWaitTotal } from '../../src/queue/processors/sendMessage';

describe('computeFloodWaitTotal', () => {
  it('uses the config buffer when the 5% floor is smaller', () => {
    const out = computeFloodWaitTotal(30, 5);
    expect(out.bufferSec).toBe(5);
    expect(out.totalSec).toBe(35);
  });

  it('uses the 5% floor when the config buffer is smaller than 5% of waitSeconds', () => {
    const out = computeFloodWaitTotal(1000, 5);
    expect(out.bufferSec).toBe(50);
    expect(out.totalSec).toBe(1050);
  });

  it('rounds the 5% floor up (ceil)', () => {
    const out = computeFloodWaitTotal(11, 0);
    expect(out.bufferSec).toBe(1);
    expect(out.totalSec).toBe(12);
  });

  it('treats negative or NaN waitSeconds as 0', () => {
    expect(computeFloodWaitTotal(-10, 5).totalSec).toBe(5);
    expect(computeFloodWaitTotal(NaN, 5).totalSec).toBe(5);
  });

  it('treats negative configBufferSec as 0', () => {
    const out = computeFloodWaitTotal(40, -5);
    expect(out.bufferSec).toBe(2);
    expect(out.totalSec).toBe(42);
  });

  it('handles 24h waits with a sensible buffer (~5%)', () => {
    const out = computeFloodWaitTotal(24 * 3600, 5);
    expect(out.bufferSec).toBeGreaterThanOrEqual(4320);
    expect(out.bufferSec).toBeLessThanOrEqual(4321);
    expect(out.totalSec).toBe(24 * 3600 + out.bufferSec);
  });
});
