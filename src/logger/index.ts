import pino from 'pino';
import { config } from '../config';

const isDev = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;

export function child(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings) as Logger;
}
