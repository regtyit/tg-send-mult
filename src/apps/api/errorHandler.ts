import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../../logger';
import { TgDomainError } from '../../telegram/errors';

function statusForError(err: unknown): number {
  if (err instanceof TgDomainError) {
    if (err.kind === 'auth_invalid' || err.kind === 'phone_banned' || err.kind === 'phone_invalid') {
      return 401;
    }
    if (
      err.kind === 'flood_wait' ||
      err.kind === 'peer_flood' ||
      err.kind === 'peer_blocked' ||
      err.kind === 'account_frozen'
    ) {
      return 429;
    }
    if (err.kind === 'peer_invalid' || err.kind === 'proxy_invalid') {
      return 400;
    }
    return 502;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('not found') || msg.includes('path not found')) return 400;
    if (msg.includes('required') || msg.includes('invalid') || msg.includes('must')) return 400;
  }
  return 500;
}

function payloadForError(err: unknown, statusCode: number): Record<string, unknown> {
  if (err instanceof TgDomainError) {
    return {
      error: err.code,
      message: err.message,
      kind: err.kind,
      retryable: err.retryable,
      ...(err.waitSeconds != null ? { waitSeconds: err.waitSeconds } : {}),
    };
  }
  if (err instanceof Error) {
    return {
      error: statusCode >= 500 ? 'internal_error' : 'bad_request',
      message: err.message,
    };
  }
  return { error: 'internal_error', message: 'Unknown error' };
}

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error, req: FastifyRequest, reply: FastifyReply) => {
    const statusCode = statusForError(err);
    const body = payloadForError(err, statusCode);

    logger.error(
      {
        err,
        statusCode,
        method: req.method,
        url: req.url,
        ...(err instanceof TgDomainError ? { tgKind: err.kind, tgCode: err.code } : {}),
      },
      'api: request failed',
    );

    if (!reply.sent) {
      reply.code(statusCode).send(body);
    }
  });
}
