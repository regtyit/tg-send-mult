import { AccountModel, ProxyModel } from '../../db/models';
import { logger } from '../../logger';
import { assertMtProxyPolicy } from '../../modules/proxy/policy';
import { syncInboundRepliesForAccount } from '../../modules/messaging/syncInboundReplies';
import { MissingTelegramApiCredentialsError } from '../../telegram/apiCredentials';
import { TgDomainError } from '../../telegram/errors';
import {
  inboundSyncBatchPerTick,
  inboundSyncIntervalSec,
  inboundSyncStaggerMs,
  sleep,
} from '../../modules/sync/timing';

/**
 * Sync sender inboxes on a staggered schedule: each account only polled after
 * INBOUND_SYNC_INTERVAL_SEC, with delays between accounts in one tick.
 */
export async function inboundRepliesTick(): Promise<void> {
  const intervalSec = inboundSyncIntervalSec();
  const staggerMs = inboundSyncStaggerMs();
  const batchLimit = inboundSyncBatchPerTick();
  const dueBefore = new Date(Date.now() - intervalSec * 1000);

  const accounts = await AccountModel.find({
    status: { $in: ['active', 'warming'] },
    sessionEnc: { $ne: '' },
    $or: [{ lastInboundSyncAt: null }, { lastInboundSyncAt: { $lte: dueBefore } }],
  })
    .sort({ lastInboundSyncAt: 1 })
    .limit(batchLimit)
    .lean();

  let synced = 0;
  let skipped = 0;

  for (const acc of accounts) {
    if (staggerMs > 0 && synced + skipped > 0) {
      await sleep(staggerMs);
    }
    try {
      const proxy = acc.proxyId ? await ProxyModel.findById(acc.proxyId) : null;
      assertMtProxyPolicy(acc, proxy);
      const result = await syncInboundRepliesForAccount(acc, proxy);
      if ('skipped' in result && result.skipped) {
        skipped += 1;
        continue;
      }
      synced += 1;
      if (result.saved > 0) {
        logger.info({ accountId: acc._id, saved: result.saved }, 'scheduler: inbound replies saved');
      }
    } catch (err) {
      if (err instanceof MissingTelegramApiCredentialsError) {
        continue;
      }
      if (err instanceof TgDomainError && (err.kind === 'auth_invalid' || err.kind === 'phone_banned')) {
        await AccountModel.findByIdAndUpdate(acc._id, {
          $set: {
            status: 'banned',
            lastErrorCode: err.code,
            lastErrorMessage: err.message,
          },
        });
        continue;
      }
      if (err instanceof TgDomainError && err.code === 'BRIDGE_TIMEOUT') {
        await AccountModel.updateOne({ _id: acc._id }, { $set: { lastInboundSyncAt: new Date() } });
      }
      logger.warn({ err, accountId: acc._id }, 'scheduler: inbound replies sync failed');
    }
  }

  if (synced > 0 || skipped > 0) {
    logger.debug({ candidates: accounts.length, synced, skipped }, 'scheduler: inbound tick done');
  }
}
