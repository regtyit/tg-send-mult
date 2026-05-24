import { Worker } from 'bullmq';
import { connectMongo } from '../../db';
import { AccountModel } from '../../db/models';
import { logger } from '../../logger';
import { bullmqConnectionOpts } from '../../queue/connection';
import { processDialogTurnJob } from '../../queue/processors/dialogTurn';
import { processSendMessageJob } from '../../queue/processors/sendMessage';
import { DIALOG_TURN_QUEUE_NAME, sendQueueName } from '../../queue/queues';
import { installShutdownHandlers, onShutdown } from '../../util/shutdown';

const workers = new Map<string, Worker>();
let dialogTurnWorker: Worker | null = null;

let refreshing = false;
let refreshPending = false;
let stopping = false;

/**
 * Reconciles the running BullMQ worker pool with eligible accounts in Mongo.
 *
 * A simple in-flight mutex (`refreshing`) prevents two ticks from racing on
 * the `workers` map. If a refresh is requested mid-flight we set
 * `refreshPending` and run exactly one more pass when the current finishes —
 * coalescing bursts without missing the latest state.
 */
async function refreshWorkers(): Promise<void> {
  if (stopping) return;
  if (refreshing) {
    refreshPending = true;
    return;
  }
  refreshing = true;
  try {
    const accounts = await AccountModel.find({
      sessionEnc: { $ne: '' },
      status: { $in: ['active', 'warming'] },
    }).lean();

    const wanted = new Set(accounts.map((a) => sendQueueName(a._id.toString())));

    for (const [name, w] of workers) {
      if (!wanted.has(name)) {
        await w.close().catch((err) => {
          logger.warn({ err, queue: name }, 'worker: close failed during refresh');
        });
        workers.delete(name);
        logger.info({ queue: name }, 'worker: removed queue worker');
      }
    }

    const conn = bullmqConnectionOpts();

    for (const acc of accounts) {
      const name = sendQueueName(acc._id.toString());
      if (workers.has(name)) continue;

      const rate = acc.dailyLimits?.ratePerHour ?? 20;
      /** BullMQ: at most `max` jobs per `duration` ms (rolling). Matches hourly cap, not a leaky per-minute guess. */
      const maxPerHour = Math.max(1, Math.min(500, Math.floor(rate)));

      const w = new Worker(name, async (job, token) => processSendMessageJob(job, token), {
        connection: conn,
        concurrency: 1,
        limiter: { max: maxPerHour, duration: 3_600_000 },
      });

      w.on('failed', (job, err) => {
        logger.warn({ queue: name, jobId: job?.id, err: String(err) }, 'worker: job failed');
      });

      workers.set(name, w);
      logger.info({ queue: name, maxPerHour }, 'worker: registered');
    }
  } finally {
    refreshing = false;
    if (refreshPending && !stopping) {
      refreshPending = false;
      /** Run exactly one coalesced re-pass for any state changes that arrived during the previous run. */
      setImmediate(() => {
        refreshWorkers().catch((err) => logger.error({ err }, 'worker: refresh re-pass failed'));
      });
    }
  }
}

async function closeAllWorkers(): Promise<void> {
  stopping = true;
  const list = [...workers.values()];
  workers.clear();
  if (dialogTurnWorker) {
    list.push(dialogTurnWorker);
    dialogTurnWorker = null;
  }
  await Promise.all(
    list.map((w) =>
      w.close().catch((err) => logger.error({ err }, 'worker: close failed during shutdown')),
    ),
  );
}

function ensureDialogTurnWorker(): void {
  if (dialogTurnWorker) return;
  const conn = bullmqConnectionOpts();
  dialogTurnWorker = new Worker(
    DIALOG_TURN_QUEUE_NAME,
    async (job) => processDialogTurnJob(job),
    { connection: conn, concurrency: 2 },
  );
  dialogTurnWorker.on('failed', (job, err) => {
    logger.warn(
      { queue: DIALOG_TURN_QUEUE_NAME, jobId: job?.id, err: String(err) },
      'worker: dialog turn failed',
    );
  });
  /** Kept out of `workers` — refreshWorkers only reconciles per-account send queues. */
  logger.info({ queue: DIALOG_TURN_QUEUE_NAME }, 'worker: dialog-turn registered');
}

async function main(): Promise<void> {
  installShutdownHandlers();
  await connectMongo();
  logger.info('worker: started, refreshing workers every 15s');
  ensureDialogTurnWorker();
  await refreshWorkers();
  const interval = setInterval(() => {
    refreshWorkers().catch((err) => logger.error({ err }, 'worker: refresh failed'));
  }, 15_000);
  onShutdown('worker:refresh-loop', () => {
    clearInterval(interval);
  });
  onShutdown('worker:close-all', closeAllWorkers, 30_000);
}

main().catch((err) => {
  logger.error({ err }, 'worker: fatal');
  process.exit(1);
});
