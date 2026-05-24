import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactDoc } from '../../src/db/models/Contact';

const A = new Types.ObjectId();
const B = new Types.ObjectId();
const contactId = new Types.ObjectId();

let lastSentAccountId: Types.ObjectId | null = null;
let updateOneCalls: Array<Record<string, unknown>> = [];
let evenPick: Types.ObjectId | null = A;

vi.mock('../../src/db/models', () => ({
  ContactModel: {
    updateOne: (_q: unknown, patch: Record<string, unknown>) => {
      updateOneCalls.push(patch);
      return Promise.resolve({ acknowledged: true });
    },
  },
  MessageModel: {
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: () =>
            Promise.resolve(
              lastSentAccountId ? { accountId: lastSentAccountId } : null,
            ),
        }),
      }),
    }),
  },
}));

vi.mock('../../src/modules/multi/evenDistribution', () => ({
  pickAccountForEvenDistribution: vi.fn(() => Promise.resolve(evenPick)),
}));

import { pickStickyAccountForContact } from '../../src/modules/multi/stickyAssignment';
import { pickAccountForEvenDistribution } from '../../src/modules/multi/evenDistribution';

function contact(partial: Partial<ContactDoc> = {}): ContactDoc {
  return {
    _id: contactId,
    assignedSenderId: null,
    ...partial,
  } as ContactDoc;
}

beforeEach(() => {
  lastSentAccountId = null;
  updateOneCalls = [];
  evenPick = A;
  vi.mocked(pickAccountForEvenDistribution).mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pickStickyAccountForContact', () => {
  it('reuses assignedSenderId when in pool', async () => {
    const counts = new Map<string, number>();
    const picked = await pickStickyAccountForContact(
      contact({ assignedSenderId: B }),
      [A, B],
      { assignmentCounts: counts },
    );
    expect(String(picked)).toBe(B.toString());
    expect(counts.get(B.toString())).toBe(1);
    expect(pickAccountForEvenDistribution).not.toHaveBeenCalled();
  });

  it('reuses sender from last successful message in pool', async () => {
    lastSentAccountId = B;
    const picked = await pickStickyAccountForContact(contact(), [A, B]);
    expect(String(picked)).toBe(B.toString());
    expect(pickAccountForEvenDistribution).not.toHaveBeenCalled();
  });

  it('assigns via even distribution for new contacts', async () => {
    evenPick = A;
    const counts = new Map<string, number>([[B.toString(), 1]]);
    const picked = await pickStickyAccountForContact(contact(), [A, B], { assignmentCounts: counts });
    expect(String(picked)).toBe(A.toString());
    expect(pickAccountForEvenDistribution).toHaveBeenCalled();
    expect(counts.get(A.toString())).toBe(1);
  });
});
