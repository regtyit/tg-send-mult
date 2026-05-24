import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { UnrecoverableError } from 'bullmq';
import {
  AccountModel,
  CampaignModel,
  ContactModel,
  DeliveryEventModel,
  MessageModel,
  ProxyModel,
} from '../../db/models';
import { warmingMsgsPerDayCap } from '../../modules/accounts/warming';
import { lognormalDelayMs } from '../../modules/antilimit/jitter';
import { isWithinCampaignWindow, isWithinSendingWindowAccount } from '../../modules/antilimit/window';
import { sendText } from '../../modules/messaging/send';
import { recomputeHealthScore } from '../../modules/multi/health';
import { persistSenderLink } from '../../modules/multi/stickyAssignment';
import type { SendMessageJobData } from '../queues';
import { mapTgError, TgDomainError } from '../../telegram/errors';
import { config } from '../../config';

/**
 * Compute the total wait time (in seconds) before retrying after a Telegram
 * FLOOD_WAIT_X error, given a base buffer from config and the wait Telegram
 * reported. Exported separately so it can be unit-tested without spinning
 * up the full processor.
 *
 * Rule: the buffer is `max(configBufferSec, ceil(0.05 * waitSeconds))`. The
 * 5% floor protects against very long waits (e.g. 24h) where a fixed 5s
 * buffer is uselessly small.
 */
export function computeFloodWaitTotal(
  waitSeconds: number,
  configBufferSec: number = config.FLOOD_WAIT_BUFFER_SEC,
): { bufferSec: number; totalSec: number } {
  const wait = Number.isFinite(waitSeconds) ? Math.max(0, Math.floor(waitSeconds)) : 0;
  const baseBufferSec = Number.isFinite(configBufferSec)
    ? Math.max(0, Math.floor(configBufferSec))
    : 0;
  const bufferSec = Math.max(baseBufferSec, Math.ceil(0.05 * wait));
  return { bufferSec, totalSec: wait + bufferSec };
}

export async function processSendMessageJob(
  job: Job<SendMessageJobData>,
  token?: string,
): Promise<void> {
  const messageId = job.data.messageId;
  const msg = await MessageModel.findById(new Types.ObjectId(messageId));
  if (!msg) {
    throw new UnrecoverableError(`Message ${messageId} not found`);
  }

  const account = await AccountModel.findById(msg.accountId);
  if (!account || !account.sessionEnc) {
    await MessageModel.updateOne(
      { _id: msg._id },
      { $set: { status: 'failed', error: { code: 'NO_ACCOUNT', message: 'Missing account' } } },
    );
    throw new UnrecoverableError('No account');
  }

  const now = new Date();
  if (account.floodWaitUntil && account.floodWaitUntil > now) {
    await MessageModel.updateOne({ _id: msg._id }, { $set: { status: 'queued' } });
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'delayed',
      {
      reason: 'flood_wait_active',
      until: account.floodWaitUntil.toISOString(),
      },
    );
    await job.moveToDelayed(account.floodWaitUntil.getTime(), token ?? '');
    return;
  }

  if (['paused', 'quarantined', 'banned'].includes(account.status)) {
    await MessageModel.updateOne(
      { _id: msg._id },
      {
        $set: {
          status: 'skipped_quota',
          error: { code: 'ACCOUNT_INACTIVE', message: `Account status ${account.status}` },
        },
      },
    );
    if (msg.campaignId) {
      await CampaignModel.updateOne({ _id: msg.campaignId }, { $inc: { 'stats.skippedQuota': 1 } });
    }
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'skipped_quota',
      { reason: 'account_inactive', status: account.status },
    );
    return;
  }

  const contact = await ContactModel.findById(msg.contactId);
  if (!contact) {
    await MessageModel.updateOne(
      { _id: msg._id },
      { $set: { status: 'failed', error: { code: 'NO_CONTACT', message: 'Contact missing' } } },
    );
    throw new UnrecoverableError('No contact');
  }

  const campaign = msg.campaignId ? await CampaignModel.findById(msg.campaignId) : null;

  if (campaign && !isWithinCampaignWindow(campaign)) {
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'delayed',
      { reason: 'outside_campaign_window' },
    );
    await job.moveToDelayed(Date.now() + 60_000, token ?? '');
    return;
  }

  if (!isWithinSendingWindowAccount(account)) {
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'delayed',
      { reason: 'outside_account_window' },
    );
    await job.moveToDelayed(Date.now() + 60_000, token ?? '');
    return;
  }

  const baseLimit = account.dailyLimits?.msgsToNew ?? 80;
  const limit =
    account.status === 'warming' ? warmingMsgsPerDayCap(baseLimit) : baseLimit;
  const used = account.dailyCounters?.msgsToNew ?? 0;
  if (used >= limit) {
    await MessageModel.updateOne(
      { _id: msg._id },
      {
        $set: {
          status: 'skipped_quota',
          error: { code: 'DAILY_LIMIT', message: 'Daily msgs limit reached' },
        },
      },
    );
    if (msg.campaignId) {
      await CampaignModel.updateOne({ _id: msg.campaignId }, { $inc: { 'stats.skippedQuota': 1 } });
    }
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'skipped_quota',
      { reason: 'daily_limit' },
    );
    return;
  }

  const meanSec = campaign?.schedule?.jitter?.meanSec ?? 8;
  const sigma = campaign?.schedule?.jitter?.sigma ?? 0.5;
  await sleep(lognormalDelayMs(meanSec, sigma));

  const proxy = account.proxyId ? await ProxyModel.findById(account.proxyId) : null;

  const peer =
    (contact.userId ? String(contact.userId).trim() : '') ||
    (contact.username ? `@${contact.username}` : '') ||
    contact.phoneE164;
  if (!peer) {
    await MessageModel.updateOne(
      { _id: msg._id },
      {
        $set: {
          status: 'failed',
          error: { code: 'NO_PEER', message: 'Contact has neither phone nor username' },
        },
      },
    );
    throw new UnrecoverableError('Contact has no peer');
  }
  const text = msg.renderedText || '';

  try {
    msg.status = 'sending';
    msg.attempts = (msg.attempts ?? 0) + 1;
    msg.lastAttemptAt = new Date();
    await msg.save();
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'sending',
    );

    const { randomId } = await sendText(account, proxy, peer, text);
    msg.status = 'sent';
    msg.sentAt = new Date();
    msg.randomId = randomId;
    msg.error = { code: '', message: '' };
    await msg.save();
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'sent',
      { randomId },
    );

    account.lastUsedAt = new Date();
    account.dailyCounters = account.dailyCounters ?? {};
    account.dailyCounters.msgsToNew = (account.dailyCounters.msgsToNew ?? 0) + 1;
    account.dailyCounters.sentTotal = (account.dailyCounters.sentTotal ?? 0) + 1;
    account.healthMetrics = account.healthMetrics ?? {};
    account.healthMetrics.sent24h = (account.healthMetrics.sent24h ?? 0) + 1;
    account.healthScore = recomputeHealthScore(account);
    account.lastErrorCode = '';
    account.lastErrorMessage = '';
    await account.save();

    await persistSenderLink(contact._id, account._id);

    if (msg.campaignId) {
      await CampaignModel.updateOne({ _id: msg.campaignId }, { $inc: { 'stats.sent': 1 } });
    }

  } catch (err) {

    const mapped = err instanceof TgDomainError ? err : mapTgError(err);
    if (mapped.kind === 'flood_wait' && mapped.waitSeconds) {
      /**
       * Add a small safety buffer on top of Telegram's reported FLOOD_WAIT
       * before we re-attempt. Without this we tend to land back on the same
       * limiter a few hundred ms after the wait expires, which counts as a
       * fresh failure. The buffer is min 5s (config.FLOOD_WAIT_BUFFER_SEC)
       * and 5% of the wait, whichever is larger.
       */
      const { bufferSec, totalSec: totalWaitSec } = computeFloodWaitTotal(mapped.waitSeconds);
      account.floodWaitUntil = new Date(Date.now() + totalWaitSec * 1000);
      account.healthMetrics = account.healthMetrics ?? {};
      account.healthMetrics.floodWait24h = (account.healthMetrics.floodWait24h ?? 0) + 1;
      account.healthScore = recomputeHealthScore(account);
      await account.save();
      await MessageModel.updateOne({ _id: msg._id }, { $set: { status: 'queued' } });
      await writeDeliveryEvent(
        {
          messageId: msg._id,
          campaignId: msg.campaignId ?? null,
          accountId: msg.accountId ?? null,
          contactId: msg.contactId,
        },
        'delayed',
        {
          reason: 'flood_wait',
          waitSeconds: mapped.waitSeconds,
          bufferSeconds: bufferSec,
          totalWaitSeconds: totalWaitSec,
        },
      );
      await job.moveToDelayed(Date.now() + totalWaitSec * 1000, token ?? '');
      return;
    }

    if (mapped.kind === 'peer_flood') {
      const until = new Date(Date.now() + 72 * 3600 * 1000);
      account.status = 'quarantined';
      account.quarantineUntil = until;
      account.healthMetrics = account.healthMetrics ?? {};
      account.healthMetrics.peerFlood24h = (account.healthMetrics.peerFlood24h ?? 0) + 1;
      account.healthScore = recomputeHealthScore(account);
      await account.save();
    }

    if (mapped.kind === 'peer_blocked' || mapped.kind === 'peer_invalid') {
      contact.status = mapped.kind === 'peer_invalid' ? 'unresolvable' : 'blocked';
      contact.blockedReason = mapped.code;
      await contact.save();
      await MessageModel.updateOne(
        { _id: msg._id },
        {
          $set: {
            status: 'skipped_blocked',
            error: { code: mapped.code, message: mapped.message },
          },
        },
      );
      if (msg.campaignId) {
        await CampaignModel.updateOne({ _id: msg.campaignId }, { $inc: { 'stats.skippedBlocked': 1 } });
      }
      await writeDeliveryEvent(
        {
          messageId: msg._id,
          campaignId: msg.campaignId ?? null,
          accountId: msg.accountId ?? null,
          contactId: msg.contactId,
        },
        'skipped_blocked',
        {
        code: mapped.code,
        message: mapped.message,
        },
      );
      throw new UnrecoverableError(mapped.message);
    }

    if (mapped.kind === 'auth_invalid' || mapped.kind === 'phone_banned') {
      account.status = 'banned';
      account.lastErrorCode = mapped.code;
      account.lastErrorMessage = mapped.message;
      await account.save();
    }

    account.dailyCounters = account.dailyCounters ?? {};
    account.dailyCounters.failedTotal = (account.dailyCounters.failedTotal ?? 0) + 1;
    account.healthMetrics = account.healthMetrics ?? {};
    account.healthMetrics.failed24h = (account.healthMetrics.failed24h ?? 0) + 1;
    account.healthScore = recomputeHealthScore(account);
    account.lastErrorCode = mapped.code ?? 'ERROR';
    account.lastErrorMessage = mapped.message ?? String(err);
    await account.save();

    await MessageModel.updateOne(
      { _id: msg._id },
      {
        $set: {
          status: 'failed',
          error: { code: mapped.code ?? 'ERROR', message: mapped.message ?? String(err) },
        },
      },
    );
    if (msg.campaignId) {
      await CampaignModel.updateOne({ _id: msg.campaignId }, { $inc: { 'stats.failed': 1 } });
    }
    await writeDeliveryEvent(
      {
        messageId: msg._id,
        campaignId: msg.campaignId ?? null,
        accountId: msg.accountId ?? null,
        contactId: msg.contactId,
      },
      'failed',
      {
        code: mapped.code ?? 'ERROR',
        message: mapped.message ?? String(err),
        retryable: mapped.retryable,
      },
    );

    if (mapped.retryable) {
      throw err;
    }
    throw new UnrecoverableError(mapped.message ?? String(err));
  }
}

async function writeDeliveryEvent(
  refs: {
    messageId: unknown;
    campaignId?: unknown;
    accountId?: unknown;
    contactId: unknown;
  },
  type: 'sending' | 'sent' | 'failed' | 'skipped_quota' | 'skipped_blocked' | 'delayed',
  payload: Record<string, unknown> = {},
): Promise<void> {
  await DeliveryEventModel.create({
    messageId: toObjectId(refs.messageId),
    campaignId: toObjectId(refs.campaignId),
    accountId: toObjectId(refs.accountId),
    contactId: toObjectId(refs.contactId),
    type,
    payload,
  });
}

function toObjectId(value: unknown): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  const str = String(value);
  return Types.ObjectId.isValid(str) ? new Types.ObjectId(str) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
