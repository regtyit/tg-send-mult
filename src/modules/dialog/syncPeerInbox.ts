import { Types } from 'mongoose';
import type { AccountDoc } from '../../db/models/Account';
import type { DialogSessionDoc } from '../../db/models/DialogSession';
import type { ProxyDoc } from '../../db/models/Proxy';
import { DialogSessionModel, InboundReplyModel } from '../../db/models';
import { sessionDueForPeerSync } from '../sync/timing';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForAccount,
} from '../../telegram/apiCredentials';
import { deviceProfileFromAccount } from '../../telegram/deviceProfile';
import { TgDomainError } from '../../telegram/errors';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { decryptSessionStringForAccount } from '../../telegram/sessionString';
import { markInboundRepliesReadInDb } from '../messaging/markInboundReadInDb';
import { normalizePhoneDigits } from './normalizePhone';
import { sinceEpochForInboundSync } from '../sync/timing';

interface BridgeIncomingItem {
  messageId: number;
  dateEpochSec: number;
  text: string;
  peerUserId: string;
  peerUsername: string;
  peerPhone: string;
  senderUserId: string;
  direction?: 'incoming' | 'outgoing';
}

interface BridgeIncomingResult {
  items: BridgeIncomingItem[];
  dialogsScanned?: number;
  dialogsMarkedRead?: number;
  peersMarkedRead?: string[];
}

export interface SyncPeerInboxOptions {
  peerUserId?: string;
  peerUsername?: string;
  peerPhone?: string;
  markRead?: boolean;
  dialogSessionId?: Types.ObjectId | null;
  sinceEpochSec?: number;
  lookbackSec?: number;
  /** When false and session has lastPeerSyncAt, skip Telegram poll (interval throttle). */
  force?: boolean;
}

export interface SyncPeerInboxSkipResult {
  skipped: true;
  reason: 'interval';
}

export type SyncPeerInboxResult =
  | { saved: number; markedRead: number; items: BridgeIncomingItem[]; skipped?: false }
  | SyncPeerInboxSkipResult;

export async function syncPeerInboxForAccount(
  account: AccountDoc,
  proxy: ProxyDoc | null,
  options: SyncPeerInboxOptions,
  session?: DialogSessionDoc | null,
): Promise<SyncPeerInboxResult> {
  if (session && !sessionDueForPeerSync(session, { force: options.force })) {
    return { skipped: true, reason: 'interval' };
  }

  const creds = telegramApiCredentialsForAccount(account);
  const proxyPayload = proxyDocToTelethonPayload(proxy);
  const sinceEpochSec = sinceEpochForInboundSync(account, {
    sinceEpochSec: options.sinceEpochSec,
    lookbackSec: options.lookbackSec,
  });

  const result = unwrapTelethonBridge<BridgeIncomingResult>(
    await runTelethonBridgeAsync({
      action: 'list_incoming',
      session: decryptSessionStringForAccount(account),
      sinceEpochSec,
      limit: 50,
      perDialogLimit: 30,
      dialogLimit: 200,
      includeOutgoing: true,
      markRead: options.markRead === true,
      peerUserId: options.peerUserId || undefined,
      peerUsername: options.peerUsername || undefined,
      peerPhone: options.peerPhone || undefined,
      ...telethonCommon(creds, deviceProfileFromAccount(account), proxyPayload),
    }),
  );

  const { items } = result;
  const markedRead = result.dialogsMarkedRead ?? 0;
  const readAt = options.markRead ? new Date() : null;
  const sessionId = options.dialogSessionId ?? null;
  const peersMarkedRead = result.peersMarkedRead ?? [];

  let saved = 0;
  for (const x of items) {
    if (x.messageId <= 0) continue;
    const peerUserId =
      String(x.peerUserId || '').trim() ||
      (normalizePhoneDigits(x.peerPhone) ? `phone:${normalizePhoneDigits(x.peerPhone)}` : '');
    if (!peerUserId) continue;
    if (!String(x.text || '').trim() && x.direction === 'outgoing') continue;
    const direction = x.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const doc = {
      accountId: account._id,
      peerUserId,
      telegramMessageId: x.messageId,
      peerUsername: x.peerUsername || '',
      peerPhone: x.peerPhone || '',
      senderUserId: x.senderUserId || '',
      direction,
      telegramDate: x.dateEpochSec > 0 ? new Date(x.dateEpochSec * 1000) : null,
      text: String(x.text || '').trim(),
      dialogSessionId: sessionId,
      ...(readAt && direction === 'incoming' ? { readAt } : {}),
    };
    const filter = {
      accountId: doc.accountId,
      peerUserId: doc.peerUserId,
      telegramMessageId: doc.telegramMessageId,
    };
    const res = await InboundReplyModel.updateOne(filter, { $setOnInsert: doc }, { upsert: true });
    if ((res.upsertedCount ?? 0) > 0) saved += 1;
    if (readAt && direction === 'incoming') {
      await InboundReplyModel.updateOne(filter, {
        $set: { readAt, dialogSessionId: sessionId },
      });
    }
  }

  if (readAt && peersMarkedRead.length) {
    await markInboundRepliesReadInDb(account._id, peersMarkedRead, { dialogSessionId: sessionId });
  }

  if (sessionId) {
    await DialogSessionModel.updateOne({ _id: sessionId }, { $set: { lastPeerSyncAt: new Date() } });
  }

  return { saved, markedRead, items };
}

export function isPeerSyncFatal(err: unknown): boolean {
  if (err instanceof MissingTelegramApiCredentialsError) return false;
  if (err instanceof TgDomainError && (err.kind === 'auth_invalid' || err.kind === 'phone_banned')) {
    return true;
  }
  return false;
}
