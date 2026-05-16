import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audience precedence rule: an explicit `contactIds` array takes precedence
 * over `tags`. We don't AND/OR them — `contactIds` short-circuits everything
 * else. This test asserts exactly that contract via the underlying Mongo
 * query that `resolveAudienceContacts` builds.
 */

let lastFilter: Record<string, unknown> | null = null;
let resultDocs: Array<{ _id: Types.ObjectId }> = [];

vi.mock('../../src/db/models', () => ({
  ContactModel: {
    find: (filter: Record<string, unknown>) => {
      lastFilter = filter;
      return { exec: () => Promise.resolve(resultDocs) };
    },
  },
}));

import { resolveAudienceContacts } from '../../src/modules/contacts/importRows';

beforeEach(() => {
  lastFilter = null;
  resultDocs = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('audience precedence (resolveAudienceContacts)', () => {
  it('returns [] when nothing is configured', async () => {
    const out = await resolveAudienceContacts({});
    expect(out).toEqual([]);
    expect(lastFilter).toBeNull();
  });

  it('uses contactIds and ignores tags when contactIds is non-empty', async () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    resultDocs = [{ _id: a }, { _id: b }];
    const out = await resolveAudienceContacts({
      contactIds: [a, b],
      tags: ['us', 'vip'],
    });
    expect(out).toHaveLength(2);
    expect(lastFilter).toEqual({ _id: { $in: [a, b] } });
  });

  it('falls back to tags when contactIds is empty', async () => {
    resultDocs = [{ _id: new Types.ObjectId() }];
    await resolveAudienceContacts({ contactIds: [], tags: ['vip'] });
    expect(lastFilter).toEqual({ tags: { $in: ['vip'] } });
  });

  it('returns [] when both contactIds and tags are empty', async () => {
    const out = await resolveAudienceContacts({ contactIds: [], tags: [] });
    expect(out).toEqual([]);
    expect(lastFilter).toBeNull();
  });
});
