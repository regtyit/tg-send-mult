import { describe, expect, it } from 'vitest';
import { nextPeerCheckAt, peerCheckDelaySec } from '../../src/modules/sync/timing';

describe('peerCheckDelaySec', () => {
  it('uses progressive delays 5 → 30 → 60 → 180', () => {
    expect(peerCheckDelaySec(0)).toBe(5);
    expect(peerCheckDelaySec(1)).toBe(30);
    expect(peerCheckDelaySec(2)).toBe(60);
    expect(peerCheckDelaySec(3)).toBe(180);
    expect(peerCheckDelaySec(99)).toBe(180);
  });

  it('schedules next check from attempt index', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    expect(nextPeerCheckAt(0, t0).getTime()).toBe(t0 + 5_000);
    expect(nextPeerCheckAt(2, t0).getTime()).toBe(t0 + 60_000);
  });
});
