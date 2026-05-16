import IORedis from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { config } from '../config';

export function bullmqConnectionOpts(): ConnectionOptions {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
}

/** Dedicated ioredis client for BullMQ (must allow unlimited retries on blocking cmds). */
export function createRedis(): IORedis {
  return new IORedis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
}
