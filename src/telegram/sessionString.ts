import { decryptSession } from '../crypto/sessionCipher';
import type { AccountDoc } from '../db/models/Account';
import { logger } from '../logger';
import { TgDomainError } from './errors';

/**
 * Thrown when an account has a non-empty `sessionEnc` that fails to decrypt
 * (wrong `SESSION_KEY`, corrupted ciphertext, truncated blob, etc).
 *
 * Callers should treat this as `auth_invalid` and not pass through to Telethon
 * with an empty session string — that path produces confusing RPC errors that
 * obscure the real cause.
 */
export class SessionDecryptError extends TgDomainError {
  constructor(message = 'Failed to decrypt account session blob') {
    super({
      kind: 'auth_invalid',
      code: 'SESSION_DECRYPT_FAILED',
      message,
      retryable: false,
    });
    this.name = 'SessionDecryptError';
  }
}

export function decryptSessionStringForAccount(account: AccountDoc): string {
  const enc = account.sessionEnc ?? '';
  if (!enc) return '';
  try {
    return decryptSession(enc);
  } catch (err) {
    logger.error({ err, accountId: account._id?.toString() }, 'tg: decrypt session failed');
    throw new SessionDecryptError();
  }
}
