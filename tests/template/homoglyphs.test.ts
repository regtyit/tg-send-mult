import { describe, expect, it } from 'vitest';
import { applyHomoglyphMix } from '../../src/modules/template/homoglyphs';

describe('applyHomoglyphMix', () => {
  it('leaves text unchanged when probability is 0', () => {
    expect(applyHomoglyphMix('cool', { probability: 0 })).toBe('cool');
  });

  it('replaces all eligible letters when probability is 1 and random always returns 0', () => {
    const out = applyHomoglyphMix('cool', { probability: 1, random: () => 0 });
    // c,o,o → Cyrillic; Latin "l" has no mapped lookalike here
    expect(out).toBe('\u0441\u043e\u043el');
  });

  it('never replaces when random always returns 1', () => {
    expect(applyHomoglyphMix('cool', { probability: 1, random: () => 1 })).toBe('cool');
  });

  it('does not alter existing Cyrillic', () => {
    const cyr = '\u043f\u0440\u0438\u0432\u0435\u0442';
    expect(applyHomoglyphMix(cyr, { probability: 1, random: () => 0 })).toBe(cyr);
  });

  it('clamps probability above 1', () => {
    const out = applyHomoglyphMix('a', { probability: 2, random: () => 0 });
    expect(out).toBe('\u0430');
  });
});
