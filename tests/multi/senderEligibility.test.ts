import { describe, expect, it } from 'vitest';
import type { AccountDoc } from '../../src/db/models/Account';
import {
  describeSenderEligibility,
  formatPoolEligibilityError,
  senderEligibilityFilter,
} from '../../src/modules/multi/senderEligibility';

function acc(partial: Partial<AccountDoc>): AccountDoc {
  return {
    sessionEnc: 'enc',
    role: 'sender',
    status: 'active',
    healthScore: 1,
    floodWaitUntil: null,
    quarantineUntil: null,
    ...partial,
  } as AccountDoc;
}

describe('describeSenderEligibility', () => {
  it('marks idle healthy senders as eligible', () => {
    expect(describeSenderEligibility(acc({})).eligible).toBe(true);
  });

  it('rejects paused and low-health accounts', () => {
    expect(describeSenderEligibility(acc({ status: 'paused' })).reasons).toContain('status');
    expect(describeSenderEligibility(acc({ healthScore: 0.4 })).reasons).toContain('health');
  });

  it('rejects test_recipient role', () => {
    expect(describeSenderEligibility(acc({ role: 'test_recipient' })).reasons).toContain('wrong_role');
  });
});

describe('formatPoolEligibilityError', () => {
  it('lists per-account blockers', () => {
    const msg = formatPoolEligibilityError([
      acc({ phone: '+100', status: 'paused', healthScore: 0.45, _id: 'abc' as never }),
    ]);
    expect(msg).toMatch(/0\/1 eligible/);
    expect(msg).toMatch(/status is not active or warming/);
  });
});

describe('senderEligibilityFilter', () => {
  it('includes health and status constraints', () => {
    const f = senderEligibilityFilter();
    expect(f.healthScore).toEqual({ $gte: 0.5 });
    expect(f.status).toEqual({ $in: ['active', 'warming'] });
  });
});
