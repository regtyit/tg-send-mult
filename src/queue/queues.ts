import { Queue } from 'bullmq';
import { bullmqConnectionOpts } from './connection';
import { onShutdown } from '../util/shutdown';

export const SEND_JOB_NAME = 'sendMessage';

export function sendQueueName(accountId: string): string {
  /** BullMQ queue names cannot include ":". */
  return `send-${accountId}`;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 2000 },
};

/**
 * Per-process pool of BullMQ Queue instances keyed by queue name.
 *
 * Before this pool, every call to `getSendQueue()` from the dispatcher,
 * Bull Board, and the API would open a fresh ioredis connection — quickly
 * exhausting Redis `maxclients` under load. The pool returns a singleton
 * instance per queue name within the process and registers shutdown hooks
 * so each queue is closed cleanly on SIGINT/SIGTERM.
 */
const queueCache = new Map<string, Queue>();
let shutdownHookRegistered = false;

function ensureShutdownHook(): void {
  if (shutdownHookRegistered) return;
  shutdownHookRegistered = true;
  onShutdown('queues:close-pool', async () => {
    const list = [...queueCache.values()];
    queueCache.clear();
    await Promise.all(list.map((q) => q.close().catch(() => undefined)));
  });
}

export function getSendQueue(accountId: string): Queue {
  ensureShutdownHook();
  const name = sendQueueName(accountId);
  const cached = queueCache.get(name);
  if (cached) return cached;
  const queue = new Queue(name, {
    connection: bullmqConnectionOpts(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  queueCache.set(name, queue);
  return queue;
}

/** Test-only helper to drop the cached queues. Not used in production code. */
export function __resetQueueCacheForTests(): void {
  queueCache.clear();
}

export interface SendMessageJobData {
  messageId: string;
}
