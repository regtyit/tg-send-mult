/**
 * Optional Latin → Cyrillic lookalike substitution (homoglyphs / confusables).
 * Pairs follow common Unicode confusable sets (see UTS #39 confusables data).
 * Only ASCII letters listed here are touched; existing Cyrillic and other scripts are unchanged.
 */
const LATIN_TO_CYRILLIC_LOOKALIKE: Record<string, string> = {
  A: '\u0410',
  B: '\u0412',
  C: '\u0421',
  E: '\u0415',
  H: '\u041d',
  K: '\u041a',
  M: '\u041c',
  O: '\u041e',
  P: '\u0420',
  T: '\u0422',
  X: '\u0425',
  c: '\u0441',
  e: '\u0435',
  o: '\u043e',
  p: '\u0440',
  x: '\u0445',
  y: '\u0443',
};

export type HomoglyphMixOptions = {
  /** Probability (0–1) that each eligible Latin letter is replaced. */
  probability: number;
  /** Inject for tests (default `Math.random`). */
  random?: () => number;
};

/**
 * Randomly replaces some Latin letters with visually identical Cyrillic letters.
 * `probability` is clamped to [0, 1].
 */
export function applyHomoglyphMix(text: string, options: HomoglyphMixOptions): string {
  const p = Math.min(1, Math.max(0, options.probability));
  if (p <= 0 || !text) return text;
  const rnd = options.random ?? Math.random;
  let out = '';
  for (const ch of text) {
    const sub = LATIN_TO_CYRILLIC_LOOKALIKE[ch];
    if (sub !== undefined && rnd() < p) {
      out += sub;
    } else {
      out += ch;
    }
  }
  return out;
}
