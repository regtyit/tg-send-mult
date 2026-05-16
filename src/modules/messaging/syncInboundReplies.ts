import { Types } from 'mongoose';
import { AccountDoc, AccountModel, ContactModel, InboundReplyModel, ProxyDoc } from '../../db/models';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForAccount,
} from '../../telegram/apiCredentials';
import { deviceProfileFromAccount } from '../../telegram/deviceProfile';
import { TgDomainError } from '../../telegram/errors';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { decryptSessionStringForAccount } from '../../telegram/sessionString';

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
}

export interface SyncInboundOptions {
  /**
   * If true, the sender Telegram session marks all visible incoming
   * messages as read (so the receiver sees blue checks). Use this for
   * force-sync triggered explicitly by the user.
   */
  markRead?: boolean;
}

function normalizePhone(raw: string): string {
  return String(raw || '').replace(/[^\d+]/g, '');
}

function normalizeUsername(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

async function loadContactMaps(): Promise<{
  byUserId: Map<string, Types.ObjectId>;
  byUsername: Map<string, Types.ObjectId>;
  byPhone: Map<string, Types.ObjectId>;
}> {
  const contacts = await ContactModel.find({}).select('_id userId username phoneE164').lean();
  const byUserId = new Map<string, Types.ObjectId>();
  const byUsername = new Map<string, Types.ObjectId>();
  const byPhone = new Map<string, Types.ObjectId>();
  for (const c of contacts) {
    const uid = String(c.userId || '').trim();
    if (uid) byUserId.set(uid, new Types.ObjectId(String(c._id)));
    const u = normalizeUsername(c.username || '');
    if (u) byUsername.set(u, new Types.ObjectId(String(c._id)));
    const p = normalizePhone(c.phoneE164 || '');
    if (p) byPhone.set(p, new Types.ObjectId(String(c._id)));
  }
  return { byUserId, byUsername, byPhone };
}

function resolveContactId(
  item: BridgeIncomingItem,
  maps: {
    byUserId: Map<string, Types.ObjectId>;
    byUsername: Map<string, Types.ObjectId>;
    byPhone: Map<string, Types.ObjectId>;
  },
): Types.ObjectId | null {
  const byUserId = maps.byUserId.get(String(item.peerUserId || '').trim());
  if (byUserId) return byUserId;
  const byUsername = maps.byUsername.get(normalizeUsername(item.peerUsername));
  if (byUsername) return byUsername;
  const byPhone = maps.byPhone.get(normalizePhone(item.peerPhone));
  return byPhone ?? null;
}

export async function syncInboundRepliesForAccount(
  account: AccountDoc,
  proxy: ProxyDoc | null,
  options: SyncInboundOptions = {},
): Promise<{ saved: number; scanned: number; markedRead: number }> {
  const creds = telegramApiCredentialsForAccount(account);
  const proxyPayload = proxyDocToTelethonPayload(proxy);
  const sinceEpochSec = account.lastInboundSyncAt
    ? Math.max(0, Math.floor(account.lastInboundSyncAt.getTime() / 1000) - 120)
    : 0;

  const result = unwrapTelethonBridge<BridgeIncomingResult>(
    await runTelethonBridgeAsync({
      action: 'list_incoming',
      session: decryptSessionStringForAccount(account),
      sinceEpochSec,
      limit: 200,
      perDialogLimit: 20,
      dialogLimit: 200,
      includeOutgoing: true,
      markRead: options.markRead === true,
      ...telethonCommon(creds, deviceProfileFromAccount(account), proxyPayload),
    }),
  );
  const { items } = result;
  const scanned = result.dialogsScanned ?? 0;
  const markedRead = result.dialogsMarkedRead ?? 0;

  if (!items.length) {
    return { saved: 0, scanned, markedRead };
  }

  const maps = await loadContactMaps();
  const docs = items
    .filter((x) => x.messageId > 0 && String(x.peerUserId || '').trim() && String(x.text || '').trim())
    .map((x) => {
      const contactId = resolveContactId(x, maps);
      return {
        accountId: account._id,
        peerUserId: x.peerUserId,
        telegramMessageId: x.messageId,
        contactId,
        peerUsername: x.peerUsername || '',
        peerPhone: x.peerPhone || '',
        senderUserId: x.senderUserId || '',
        direction: x.direction === 'outgoing' ? 'outgoing' : 'incoming',
        telegramDate: x.dateEpochSec > 0 ? new Date(x.dateEpochSec * 1000) : null,
        text: x.text,
      };
    });

  let saved = 0;
  let maxEpochSec = sinceEpochSec;
  for (const doc of docs) {
    const epochSec = Math.floor((doc.telegramDate?.getTime() ?? 0) / 1000);
    if (epochSec > maxEpochSec) maxEpochSec = epochSec;
    const res = await InboundReplyModel.updateOne(
      {
        accountId: doc.accountId,
        peerUserId: doc.peerUserId,
        telegramMessageId: doc.telegramMessageId,
      },
      { $setOnInsert: doc },
      { upsert: true },
    );
    if ((res.upsertedCount ?? 0) > 0) saved += 1;
  }

  await AccountModel.updateOne(
    { _id: account._id },
    { $set: { lastInboundSyncAt: maxEpochSec > 0 ? new Date(maxEpochSec * 1000) : new Date() } },
  );
  return { saved, scanned, markedRead };
}

export function isInboundSyncFatal(err: unknown): boolean {
  if (err instanceof MissingTelegramApiCredentialsError) return false;
  if (err instanceof TgDomainError && (err.kind === 'auth_invalid' || err.kind === 'phone_banned')) return true;
  return false;
}
