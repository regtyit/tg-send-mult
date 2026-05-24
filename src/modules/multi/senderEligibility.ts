import type { AccountDoc } from '../../db/models/Account';

export const MIN_SENDER_HEALTH_SCORE = 0.5;
export const SENDABLE_STATUSES = ['active', 'warming'] as const;

export type SenderEligibilityReason =
  | 'no_session'
  | 'wrong_role'
  | 'status'
  | 'health'
  | 'flood_wait'
  | 'quarantine';

export type SenderEligibilityInput = {
  sessionEnc?: string | null;
  role?: AccountDoc['role'] | string | null;
  status?: AccountDoc['status'] | string | null;
  healthScore?: number | null;
  floodWaitUntil?: Date | null;
  quarantineUntil?: Date | null;
};

export function describeSenderEligibility(
  account: SenderEligibilityInput,
  now = new Date(),
): { eligible: boolean; reasons: SenderEligibilityReason[] } {
  const reasons: SenderEligibilityReason[] = [];
  if (!account.sessionEnc?.trim()) reasons.push('no_session');
  if (account.role && account.role !== 'sender') reasons.push('wrong_role');
  if (!SENDABLE_STATUSES.includes(account.status as (typeof SENDABLE_STATUSES)[number])) {
    reasons.push('status');
  }
  if ((account.healthScore ?? 0) < MIN_SENDER_HEALTH_SCORE) reasons.push('health');
  if (account.floodWaitUntil && account.floodWaitUntil > now) reasons.push('flood_wait');
  if (account.quarantineUntil && account.quarantineUntil > now) reasons.push('quarantine');
  return { eligible: reasons.length === 0, reasons };
}

/** Mongo filter matching {@link pickAccountForSend} eligibility rules. */
export function senderEligibilityFilter(now = new Date()): Record<string, unknown> {
  return {
    sessionEnc: { $ne: '' },
    status: { $in: [...SENDABLE_STATUSES] },
    healthScore: { $gte: MIN_SENDER_HEALTH_SCORE },
    $or: [{ role: { $exists: false } }, { role: 'sender' }],
    $and: [
      { $or: [{ floodWaitUntil: null }, { floodWaitUntil: { $lte: now } }] },
      { $or: [{ quarantineUntil: null }, { quarantineUntil: { $lte: now } }] },
    ],
  };
}

export function formatEligibilityReasons(reasons: SenderEligibilityReason[]): string {
  const labels: Record<SenderEligibilityReason, string> = {
    no_session: 'no saved session',
    wrong_role: 'not a sender (test_recipient)',
    status: 'status is not active or warming',
    health: `health score below ${MIN_SENDER_HEALTH_SCORE}`,
    flood_wait: 'flood-wait active',
    quarantine: 'quarantine active',
  };
  return reasons.map((r) => labels[r]).join('; ');
}

export function formatPoolEligibilityError(
  accounts: Array<
    Pick<AccountDoc, '_id' | 'phone' | 'label' | 'telegramUsername'> & SenderEligibilityInput
  >,
  now = new Date(),
): string {
  if (!accounts.length) return 'Campaign sender pool is empty.';
  const lines = accounts.map((a) => {
    const { reasons } = describeSenderEligibility(a, now);
    const label = [a.phone, a.telegramUsername ? `@${a.telegramUsername}` : null, a.label || null]
      .filter(Boolean)
      .join(' ');
    return reasons.length
      ? `${label || a._id}: ${formatEligibilityReasons(reasons)}`
      : `${label || a._id}: eligible`;
  });
  const eligible = accounts.filter((a) => describeSenderEligibility(a, now).eligible).length;
  return (
    `No eligible sending account in the campaign pool (${eligible}/${accounts.length} eligible). ` +
    `Set sender status to active or warming on the Senders page and ensure each has a session. Details: ${lines.join(' | ')}`
  );
}
