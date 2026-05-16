import { logger } from '../logger';
import { disconnectMongo } from '../db';

interface Hook {
  name: string;
  fn: () => Promise<void> | void;
  timeoutMs: number;
}

const hooks: Hook[] = [];
let shuttingDown = false;

/**
 * Register a teardown hook to run on SIGINT/SIGTERM.
 * Hooks run in reverse registration order (LIFO) so dependencies are torn
 * down before their dependents (e.g. queues before BullMQ Redis connections).
 *
 * Each hook is wrapped in a per-hook timeout: a single misbehaving hook
 * cannot wedge the shutdown.
 */
export function onShutdown(
  name: string,
  fn: () => Promise<void> | void,
  timeoutMs = 10_000,
): void {
  hooks.push({ name, fn, timeoutMs });
}

async function runWithTimeout(hook: Hook): Promise<void> {
  const timeout = new Promise<void>((_, reject) => {
    setTimeout(
      () => reject(new Error(`shutdown hook "${hook.name}" timed out after ${hook.timeoutMs}ms`)),
      hook.timeoutMs,
    );
  });
  try {
    await Promise.race([Promise.resolve().then(() => hook.fn()), timeout]);
    logger.info({ hook: hook.name }, 'shutdown: hook completed');
  } catch (err) {
    logger.error({ err, hook: hook.name }, 'shutdown: hook failed');
  }
}

async function shutdown(signal: NodeJS.Signals | 'manual'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, hookCount: hooks.length }, 'shutdown: initiated');
  for (const hook of [...hooks].reverse()) {
    await runWithTimeout(hook);
  }
  try {
    await disconnectMongo();
    logger.info('shutdown: mongo disconnected');
  } catch (err) {
    logger.error({ err }, 'shutdown: mongo disconnect failed');
  }
  logger.info('shutdown: complete');
}

let handlersInstalled = false;

export function installShutdownHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.once(sig, () => {
      shutdown(sig)
        .then(() => process.exit(0))
        .catch((err) => {
          logger.error({ err }, 'shutdown: unhandled error');
          process.exit(1);
        });
    });
  }
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'process: uncaughtException');
  });
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'process: unhandledRejection');
  });
}
