import { describe, expect, it } from 'vitest';
import { isMongoDuplicateKey } from '../../src/util/mongoError';

describe('isMongoDuplicateKey', () => {
  it('detects code 11000', () => {
    expect(isMongoDuplicateKey({ code: 11000 })).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isMongoDuplicateKey(new Error('nope'))).toBe(false);
    expect(isMongoDuplicateKey(null)).toBe(false);
  });
});
