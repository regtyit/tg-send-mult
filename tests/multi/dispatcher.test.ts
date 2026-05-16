import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock dependencies before importing the SUT. The dispatcher only touches
 * `AccountModel.find(...).lean()` and `getSendQueue(id).getJobCounts(...)`,
 * so we stub both with controllable in-memory fakes.
 */
let candidatesFn: () => Array<{ _id: Types.ObjectId }> = () => [];
const jobCountsByQueue = new Map<string, { waiting: number; active: number; delayed: number; paused: number }>();
let lastFilter: Record<string, unknown> | null = null;

vi.mock('../../src/db/models', () => ({
  AccountModel: {
    find: (filter: Record<string, unknown>) => {
      lastFilter = filter;
      return {
        lean: () => Promise.resolve(candidatesFn()),
      };
    },
  },
}));

vi.mock('../../src/queue/queues', () => ({
  getSendQueue: (accountId: string) => ({
    getJobCounts: async () =>
      jobCountsByQueue.get(accountId) ?? {
        waiting: 0,
        active: 0,
        delayed: 0,
        paused: 0,
      },
  }),
}));

import { pickAccountForSend } from '../../src/modules/multi/dispatcher';

const A = new Types.ObjectId();
const B = new Types.ObjectId();
const C = new Types.ObjectId();

beforeEach(() => {
  candidatesFn = () => [];
  jobCountsByQueue.clear();
  lastFilter = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pickAccountForSend', () => {
  it('returns null on empty pool without hitting Mongo', async () => {
    const res = await pickAccountForSend([]);
    expect(res).toBeNull();
    expect(lastFilter).toBeNull();
  });

  it('returns null when no candidates match', async () => {
    candidatesFn = () => [];
    const res = await pickAccountForSend([A, B]);
    expect(res).toBeNull();
  });

  it('picks the account with the smallest in-flight load', async () => {
    candidatesFn = () => [{ _id: A }, { _id: B }, { _id: C }];
    jobCountsByQueue.set(A.toString(), { waiting: 5, active: 1, delayed: 2, paused: 0 });
    jobCountsByQueue.set(B.toString(), { waiting: 0, active: 0, delayed: 1, paused: 0 });
    jobCountsByQueue.set(C.toString(), { waiting: 3, active: 0, delayed: 0, paused: 0 });
    const picked = await pickAccountForSend([A, B, C]);
    expect(String(picked)).toBe(B.toString());
  });

  it('breaks ties in favor of the first candidate (deterministic)', async () => {
    candidatesFn = () => [{ _id: A }, { _id: B }];
    jobCountsByQueue.set(A.toString(), { waiting: 0, active: 0, delayed: 0, paused: 0 });
    jobCountsByQueue.set(B.toString(), { waiting: 0, active: 0, delayed: 0, paused: 0 });
    const picked = await pickAccountForSend([A, B]);
    expect(String(picked)).toBe(A.toString());
  });

  it('builds an eligibility filter that excludes empty sessions, non-active states, low health, and active flood/quarantine windows', async () => {
    candidatesFn = () => [{ _id: A }];
    jobCountsByQueue.set(A.toString(), { waiting: 0, active: 0, delayed: 0, paused: 0 });
    const now = new Date('2026-05-07T12:00:00.000Z');
    await pickAccountForSend([A], now);
    expect(lastFilter).toBeTruthy();
    expect(lastFilter!.sessionEnc).toEqual({ $ne: '' });
    expect(lastFilter!.status).toEqual({ $in: ['active', 'warming'] });
    expect(lastFilter!.healthScore).toEqual({ $gte: 0.5 });
    expect(Array.isArray(lastFilter!.$and)).toBe(true);
    const ands = lastFilter!.$and as Array<Record<string, unknown>>;
    const orFlood = (ands[0]!.$or as Array<Record<string, unknown>>) ?? [];
    expect(orFlood.some((c) => 'floodWaitUntil' in c && c.floodWaitUntil === null)).toBe(true);
    expect(
      orFlood.some(
        (c) =>
          typeof c.floodWaitUntil === 'object' &&
          c.floodWaitUntil !== null &&
          (c.floodWaitUntil as Record<string, unknown>).$lte === now,
      ),
    ).toBe(true);
  });
});
