import { describe, expect, it } from 'vitest';
import { computeTextHash, normalizeText } from '../../src/modules/dedup/hash';

describe('dedup hash', () => {
  it('normalize collapses case and whitespace', () => {
    expect(normalizeText('  Hello   WORLD  ')).toBe('hello world');
  });

  it('same semantic text yields same hash', () => {
    const a = computeTextHash('Hello   world');
    const b = computeTextHash('hello world');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('different text yields different hash', () => {
    expect(computeTextHash('a')).not.toBe(computeTextHash('b'));
  });
});
