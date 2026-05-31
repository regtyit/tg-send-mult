import cron from 'node-cron';
import { connectMongo } from '../../db';
import { AccountModel, ProxyModel } from '../../db/models';
import { logger } from '../../logger';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForAccount,
} from '../../telegram/apiCredentials';
import { deviceProfileFromAccount } from '../../telegram/deviceProfile';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridgeAsync, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { decryptSessionStringForAccount } from '../../telegram/sessionString';
import { recomputeHealthScore } from '../../modules/multi/health';
import { assertMtProxyPolicy } from '../../modules/proxy/policy';
import { TgDomainError } from '../../telegram/errors';
import { installShutdownHandlers, onShutdown } from '../../util/shutdown';
import { promoteWarmedAccounts } from '../../modules/accounts/warming';
import { runDialogSessionsBatch } from '../../modules/dialog/batchTick';
import { runWarmupOrchestrator } from '../../modules/dialog/warmupOrchestrator';
import { inboundRepliesTick } from './inboundSyncTick';

function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

let resetInFlight = false;

/**
 * Resets daily counters for accounts whose `resetAt` is older than today in
 * their configured timezone. Previous implementation iterated `find()` results
 * and saved each doc — N round-trips and a save validation per account. This
 * version groups by timezone and issues a single `updateMany` per group using
 * `$dateToString` with the per-account timezone so the comparison happens
 * server-side.
 *
 * `resetInFlight` prevents an overlap if a previous tick is still running
 * (e.g. due to a slow Mongo or a long pause).
 */
async function resetDailyCounters(): Promise<void> {
  if (resetInFlight) return;
  resetInFlight = true;
  const startedAt = Date.now();
  const now = new Date();
  try {
    const timezones: (string | null)[] = await AccountModel.distinct('sendingWindow.timezone');
    let totalReset = 0;
    for (const rawTz of timezones) {
      const tz = (typeof rawTz === 'string' && rawTz.trim()) || 'UTC';
      const today = ymdInTz(now, tz);
      const result = await AccountModel.updateMany(
        {
          'sendingWindow.timezone': rawTz,
          $expr: {
            $or: [
              { $eq: [{ $ifNull: ['$dailyCounters.resetAt', null] }, null] },
              {
                $ne: [
                  {
                    $dateToString: {
                      date: '$dailyCounters.resetAt',
                      timezone: tz,
                      format: '%Y-%m-%d',
                    },
                  },
                  today,
                ],
              },
            ],
          },
        },
        {
          $set: {
            'dailyCounters.msgsToNew': 0,
            'dailyCounters.contactsAdded': 0,
            'dailyCounters.resetAt': now,
            'healthMetrics.sent24h': 0,
            'healthMetrics.failed24h': 0,
            'healthMetrics.floodWait24h': 0,
            'healthMetrics.peerFlood24h': 0,
          },
        },
      );
      totalReset += result.modifiedCount ?? 0;
      /**
       * Recompute healthScore for the rows we just touched. Doing it in JS
       * is fine because reset typically affects a small fraction of accounts
       * once per day in any given timezone.
       */
      if ((result.modifiedCount ?? 0) > 0) {
        const touched = await AccountModel.find({
          'sendingWindow.timezone': rawTz,
          'dailyCounters.resetAt': now,
        });
        for (const acc of touched) {
          acc.healthScore = recomputeHealthScore(acc);
          await acc.save();
        }
      }
    }
    if (totalReset > 0) {
      logger.info(
        { resetCount: totalReset, durationMs: Date.now() - startedAt },
        'scheduler: daily counters reset',
      );
    }
  } finally {
    resetInFlight = false;
  }
}

async function warmUpTick(): Promise<void> {
  const accounts = await AccountModel.find({
    status: 'warming',
    sessionEnc: { $ne: '' },
  }).limit(5);

  for (const acc of accounts) {
    try {
      const proxy = acc.proxyId ? await ProxyModel.findById(acc.proxyId) : null;
      assertMtProxyPolicy(acc, proxy);
      const proxyPayload = proxyDocToTelethonPayload(proxy);
      const creds = telegramApiCredentialsForAccount(acc);
      unwrapTelethonBridge(
        await runTelethonBridgeAsync({
          action: 'get_state',
          session: decryptSessionStringForAccount(acc),
          ...telethonCommon(creds, deviceProfileFromAccount(acc), proxyPayload),
        }),
      );
      logger.debug({ accountId: acc._id }, 'scheduler: warm-up GetState ok');
    } catch (err) {
      if (err instanceof MissingTelegramApiCredentialsError) {
        logger.warn(
          { accountId: acc._id },
          'scheduler: warm-up skipped (set telegramApiId/apiHash on account or TG_API_* in .env)',
        );
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
        logger.warn({ accountId: acc._id, code: err.code }, 'scheduler: warm-up flagged auth_invalid');
        continue;
      }
      logger.warn({ err, accountId: acc._id }, 'scheduler: warm-up failed');
    }
  }
}

async function promoteWarmedAccountsTick(): Promise<void> {
  const n = await promoteWarmedAccounts();
  if (n > 0) {
    logger.info({ count: n }, 'scheduler: promoted warmed accounts to active');
  }
}

async function dialogSessionsTick(): Promise<void> {
  const r = await runDialogSessionsBatch();
  if (r.processed > 0 || r.errors > 0) {
    logger.info(
      { scanned: r.scanned, claimed: r.claimed, processed: r.processed, errors: r.errors },
      'scheduler: dialog batch tick',
    );
  }
}

async function warmupDialogsTick(): Promise<void> {
  const r = await runWarmupOrchestrator({
    limit: 10,
    autoStart: true,
    requireInWindow: false,
  });
  if (r.created > 0 || r.started > 0) {
    logger.info(
      { created: r.created, started: r.started, skipped: r.skipped },
      'scheduler: warm-up dialog orchestrator',
    );
  }
}

async function main(): Promise<void> {
  installShutdownHandlers();
  await connectMongo();
  logger.info('scheduler: started');

  const tasks = [
    cron.schedule('* * * * *', () => {
      resetDailyCounters().catch((err) => logger.error({ err }, 'scheduler: reset failed'));
    }),
    cron.schedule('*/15 * * * *', () => {
      warmUpTick().catch((err) => logger.error({ err }, 'scheduler: warm-up failed'));
    }),
    cron.schedule('*/5 * * * *', () => {
      promoteWarmedAccountsTick().catch((err) =>
        logger.error({ err }, 'scheduler: promote failed'),
      );
    }),
    cron.schedule('* * * * *', () => {
      inboundRepliesTick().catch((err) => logger.error({ err }, 'scheduler: inbound replies failed'));
    }),
    cron.schedule('* * * * *', () => {
      dialogSessionsTick().catch((err) => logger.error({ err }, 'scheduler: dialog sessions failed'));
    }),
    cron.schedule('* * * * *', () => {
      warmupDialogsTick().catch((err) => logger.error({ err }, 'scheduler: warm-up dialogs failed'));
    }),
  ];

  onShutdown('scheduler:cron', () => {
    for (const t of tasks) t.stop();
  });
}

main().catch((err) => {
  logger.error({ err }, 'scheduler: fatal');
  process.exit(1);
});
