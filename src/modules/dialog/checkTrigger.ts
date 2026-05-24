import { Types } from 'mongoose';
import { InboundReplyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import type { ContactDoc } from '../../db/models/Contact';
import type { DialogSessionDoc } from '../../db/models/DialogSession';
import { peerFilterFromAccount, peerFilterFromContact } from './resolvePeer';

export function normalizeTriggerText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '');
}

export function messageMatchesTrigger(messageText: string, trigger: string): boolean {
  const tr = normalizeTriggerText(trigger);
  if (!tr) return true;
  const msg = normalizeTriggerText(messageText);
  if (msg === tr) return true;
  if (tr.length >= 4 && msg.includes(tr)) return true;
  return false;
}

function peerClauses(
  session: DialogSessionDoc,
  peerAccount: AccountDoc | null,
  peerContact: ContactDoc | null,
): Record<string, unknown>[] {
  const peer =
    session.peerType === 'contact' && peerContact
      ? peerFilterFromContact(peerContact)
      : session.peerType === 'account' && peerAccount
        ? peerFilterFromAccount(peerAccount)
        : {};
  const clauses: Record<string, unknown>[] = [];
  if (peer.peerUserId) clauses.push({ peerUserId: peer.peerUserId });
  if (peer.peerUsername) clauses.push({ peerUsername: peer.peerUsername });
  if (peer.peerPhone) clauses.push({ peerPhone: peer.peerPhone });
  return clauses;
}

export interface PeerTriggerMatch {
  matched: boolean;
  messageAt: Date | null;
}

/**
 * Find the newest incoming peer message matching `trigger` after `since`.
 */
export async function findPeerTriggerInbound(
  session: DialogSessionDoc,
  accountAId: Types.ObjectId,
  peerAccount: AccountDoc | null,
  peerContact: ContactDoc | null,
  trigger: string,
  since?: Date | null,
): Promise<PeerTriggerMatch> {
  const tr = normalizeTriggerText(trigger);
  if (!tr) return { matched: true, messageAt: null };

  const filter: Record<string, unknown> = {
    accountId: accountAId,
    direction: 'incoming',
  };

  const peerOr = peerClauses(session, peerAccount, peerContact);
  if (peerOr.length === 1) {
    Object.assign(filter, peerOr[0]);
  } else if (peerOr.length > 1) {
    filter.$or = peerOr;
  }

  if (since) {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      {
        $or: [
          { telegramDate: { $gte: since } },
          { telegramDate: null, createdAt: { $gte: since } },
        ],
      },
    ];
  }

  const rows = await InboundReplyModel.find(filter)
    .sort({ telegramDate: -1, createdAt: -1 })
    .limit(50)
    .lean();

  for (const r of rows) {
    if (messageMatchesTrigger(String(r.text || ''), trigger)) {
      const messageAt =
        (r.telegramDate as Date | null) ?? (r.createdAt as Date | null) ?? new Date();
      return { matched: true, messageAt };
    }
  }
  return { matched: false, messageAt: null };
}

export async function peerTriggerSatisfied(
  session: DialogSessionDoc,
  accountAId: Types.ObjectId,
  peerAccount: AccountDoc | null,
  peerContact: ContactDoc | null,
  trigger: string,
  since?: Date | null,
): Promise<boolean> {
  const { matched } = await findPeerTriggerInbound(
    session,
    accountAId,
    peerAccount,
    peerContact,
    trigger,
    since,
  );
  return matched;
}
