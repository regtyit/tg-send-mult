import { describe, expect, it } from 'vitest';
import { computeTextHash } from '../../src/modules/dedup/hash';

/**
 * Campaign-level dedup contract: two messages with the same rendered text
 * (after normalization) MUST produce the same `textHash`, so the
 * `(campaignId, contactId, textHash)` unique index in `Message` collapses
 * accidental re-enqueues into one row. Re-rendering the same template for
 * the same contact must therefore be idempotent — even across whitespace
 * and case differences.
 */
describe('campaign textHash idempotency', () => {
  it('same rendered text yields the same hash', () => {
    const a = computeTextHash('Hello Alex, welcome aboard!');
    const b = computeTextHash('Hello Alex, welcome aboard!');
    expect(a).toBe(b);
  });

  it('whitespace and case differences do not affect the hash', () => {
    const base = computeTextHash('Hello Alex');
    expect(computeTextHash('  HELLO  alex  ')).toBe(base);
    expect(computeTextHash('hello\talex')).toBe(base);
    expect(computeTextHash('hello\nalex')).toBe(base);
  });

  it('changing a single character produces a different hash', () => {
    const a = computeTextHash('Hello Alex');
    const b = computeTextHash('Hello Alec');
    expect(a).not.toBe(b);
  });

  it('hashes are 64-character hex (sha256)', () => {
    const h = computeTextHash('payload');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
