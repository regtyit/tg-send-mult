import { describe, expect, it, vi } from 'vitest';
import type { AccountDoc } from '../../src/db/models/Account';
import {
  isWithinSendingWindowAccount,
  parseHHMM,
} from '../../src/modules/antilimit/window';
import { lognormalDelayMs } from '../../src/modules/antilimit/jitter';

describe('parseHHMM edge cases', () => {
  it('rejects empty / undefined / null', () => {
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });

  it('rejects malformed strings', () => {
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('12:60')).toBeNull();
    expect(parseHHMM('1230')).toBeNull();
    expect(parseHHMM('99:99')).toBeNull();
    expect(parseHHMM('not a time')).toBeNull();
    expect(parseHHMM('10:5a')).toBeNull();
  });

  it('accepts valid HH:MM', () => {
    expect(parseHHMM('00:00')).toEqual({ h: 0, m: 0 });
    expect(parseHHMM('09:30')).toEqual({ h: 9, m: 30 });
    expect(parseHHMM('23:59')).toEqual({ h: 23, m: 59 });
    expect(parseHHMM('  09:30  ')).toEqual({ h: 9, m: 30 });
  });
});

describe('overnight sending windows', () => {
  it('treats window 22:00 -> 06:00 as overnight (inside at 02:00 UTC)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T02:00:00.000Z'));
    const account = {
      sendingWindow: { start: '22:00', end: '06:00', timezone: 'UTC' },
    } as AccountDoc;
    expect(isWithinSendingWindowAccount(account)).toBe(true);
    vi.useRealTimers();
  });

  it('overnight window: outside at 12:00 UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
    const account = {
      sendingWindow: { start: '22:00', end: '06:00', timezone: 'UTC' },
    } as AccountDoc;
    expect(isWithinSendingWindowAccount(account)).toBe(false);
    vi.useRealTimers();
  });

  it('overnight window: inside at 23:30 UTC (right after start)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T23:30:00.000Z'));
    const account = {
      sendingWindow: { start: '22:00', end: '06:00', timezone: 'UTC' },
    } as AccountDoc;
    expect(isWithinSendingWindowAccount(account)).toBe(true);
    vi.useRealTimers();
  });

  it('falls back to 00:00..23:59 (i.e. always-on) on garbage values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T03:00:00.000Z'));
    const account = {
      sendingWindow: { start: 'lol', end: 'wat', timezone: 'UTC' },
    } as AccountDoc;
    expect(isWithinSendingWindowAccount(account)).toBe(true);
    vi.useRealTimers();
  });
});

describe('lognormalDelayMs robustness', () => {
  it('never returns NaN even when Math.random returns 0', () => {
    const seq = [0, 0, 0.5, 0.5];
    let i = 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length] ?? 0.5);
    try {
      for (let n = 0; n < 100; n++) {
        const ms = lognormalDelayMs(8, 0.5);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThan(0);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('returns MIN_DELAY_MS for non-positive meanSec', () => {
    expect(lognormalDelayMs(0, 0.5)).toBe(500);
    expect(lognormalDelayMs(-5, 0.5)).toBe(500);
    expect(lognormalDelayMs(NaN, 0.5)).toBe(500);
    expect(lognormalDelayMs(Infinity, 0.5)).toBe(500);
  });

  it('returns deterministic value when sigma=0', () => {
    expect(lognormalDelayMs(2, 0)).toBe(2000);
    expect(lognormalDelayMs(10, 0)).toBe(10_000);
  });

  it('clamps to MAX_DELAY_MS for huge inputs', () => {
    const ms = lognormalDelayMs(1e6, 0);
    expect(ms).toBeLessThanOrEqual(120_000);
  });
});
