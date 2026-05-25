import { Types } from 'mongoose';
import { DialogSessionModel } from '../../db/models';
import { config } from '../../config';
import { continueDialogSession } from './continueSession';
import { logger } from '../../logger';
import { dialogSessionStaggerMs, sleep } from '../sync/timing';

export interface DialogBatchTickOptions {
  limit?: number;
  concurrency?: number;
  lockSec?: number;
  dryRun?: boolean;
}

export interface DialogBatchTickResult {
  scanned: number;
  claimed: number;
  processed: number;
  errors: number;
  dryRun: boolean;
}

function dialogBatchLimit(): number {
  return config.DIALOG_BATCH_LIMIT;
}

function dialogBatchConcurrency(): number {
  return config.DIALOG_BATCH_CONCURRENCY;
}

function dialogLockSec(): number {
  return config.DIALOG_PROCESSING_LOCK_SEC;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  let idx = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) break;
        await fn(items[i]!);
      }
    }),
  );
}

/** Atomically claim a session so multiple schedulers/workers do not double-run the same turn. */
export async function claimDialogSession(
  sessionId: Types.ObjectId,
  lockSec: number,
): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + lockSec * 1000);
  const res = await DialogSessionModel.updateOne(
    {
      _id: sessionId,
      runMode: 'auto',
      status: { $in: ['running', 'waiting_peer'] },
      $or: [{ processingLockUntil: null }, { processingLockUntil: { $lte: now } }],
    },
    { $set: { processingLockUntil: until } },
  );
  return (res.modifiedCount ?? 0) > 0;
}

export async function releaseDialogSessionLock(sessionId: Types.ObjectId): Promise<void> {
  await DialogSessionModel.updateOne({ _id: sessionId }, { $set: { processingLockUntil: null } });
}

/**
 * Process due auto dialog sessions in batches (designed for 10k+ concurrent sessions).
 */
export async function runDialogSessionsBatch(
  opts: DialogBatchTickOptions = {},
): Promise<DialogBatchTickResult> {
  const limit = opts.limit ?? dialogBatchLimit();
  const concurrency = opts.concurrency ?? dialogBatchConcurrency();
  const lockSec = opts.lockSec ?? dialogLockSec();
  const dryRun = opts.dryRun === true;
  const now = new Date();

  const due = await DialogSessionModel.find({
    runMode: 'auto',
    $and: [
      {
        $or: [
          {
            status: 'waiting_peer',
            $or: [{ nextRunAt: null }, { nextRunAt: { $lte: now } }],
          },
          { status: 'running', nextRunAt: { $lte: now } },
        ],
      },
      {
        $or: [{ processingLockUntil: null }, { processingLockUntil: { $lte: now } }],
      },
    ],
  })
    .sort({ nextRunAt: 1, updatedAt: 1 })
    .limit(limit)
    .select('_id status')
    .lean();

  const result: DialogBatchTickResult = {
    scanned: due.length,
    claimed: 0,
    processed: 0,
    errors: 0,
    dryRun,
  };

  if (dryRun || !due.length) return result;

  const ids: Types.ObjectId[] = [];
  for (const row of due) {
    const id = new Types.ObjectId(String(row._id));
    if (await claimDialogSession(id, lockSec)) {
      ids.push(id);
      result.claimed += 1;
    }
  }

  const staggerMs = dialogSessionStaggerMs();
  let lastStart = 0;
  await runPool(ids, concurrency, async (id) => {
    if (staggerMs > 0 && lastStart > 0) {
      const wait = lastStart + staggerMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = Date.now();
    try {
      await continueDialogSession(id);
      result.processed += 1;
    } catch (err) {
      result.errors += 1;
      logger.warn({ err, sessionId: id }, 'dialog: batch tick session failed');
    } finally {
      await releaseDialogSessionLock(id);
    }
  });

  return result;
}

/** Defaults used by scheduler (overridable via env). */
export function dialogBatchConfig(): {
  limit: number;
  concurrency: number;
  lockSec: number;
} {
  return {
    limit: dialogBatchLimit(),
    concurrency: dialogBatchConcurrency(),
    lockSec: dialogLockSec(),
  };
}
