import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const A = new Types.ObjectId();
const B = new Types.ObjectId();
let candidates: Array<{ _id: Types.ObjectId }> = [];

vi.mock('../../src/db/models', () => ({
  AccountModel: {
    find: () => ({
      sort: () => ({
        lean: () => Promise.resolve(candidates),
      }),
    }),
  },
}));

import { pickAccountForEvenDistribution } from '../../src/modules/multi/evenDistribution';

beforeEach(() => {
  candidates = [{ _id: A }, { _id: B }];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pickAccountForEvenDistribution', () => {
  it('picks sender with fewest batch assignments', async () => {
    const counts = new Map<string, number>([
      [A.toString(), 2],
      [B.toString(), 0],
    ]);
    const picked = await pickAccountForEvenDistribution([A, B], counts);
    expect(String(picked)).toBe(B.toString());
  });

  it('returns an eligible sender when all assignment counts are zero', async () => {
    const picked = await pickAccountForEvenDistribution([A, B], new Map());
    expect(picked).not.toBeNull();
  });
});
