import { config } from '../config';
import type { AccountDoc } from '../db/models/Account';

export class MissingTelegramApiCredentialsError extends Error {
  constructor() {
    super(
      'Telegram api_id and api_hash are missing. Set telegramApiId + telegramApiHash on the sender account (dashboard, API, or import), pass --api-id/--api-hash on auth login, or set TG_API_ID and TG_API_HASH in .env as a fallback.',
    );
    this.name = 'MissingTelegramApiCredentialsError';
  }
}

type AccountApiFields = Pick<AccountDoc, 'telegramApiId' | 'telegramApiHash'>;

/**
 * Credentials for Telethon: per-account fields override optional global .env.
 */
export function telegramApiCredentialsForAccount(
  account: AccountApiFields | null | undefined,
): { apiId: number; apiHash: string } {
  const id = account?.telegramApiId;
  const hash = typeof account?.telegramApiHash === 'string' ? account.telegramApiHash.trim() : '';
  if (typeof id === 'number' && !Number.isNaN(id) && id > 0 && hash) {
    return { apiId: id, apiHash: hash };
  }
  const gId = config.TG_API_ID;
  const gHash = typeof config.TG_API_HASH === 'string' ? config.TG_API_HASH.trim() : '';
  if (typeof gId === 'number' && !Number.isNaN(gId) && gId > 0 && gHash) {
    return { apiId: gId, apiHash: gHash };
  }
  throw new MissingTelegramApiCredentialsError();
}

export interface LoginApiCredentialOpts {
  telegramApiId?: number;
  telegramApiHash?: string;
}

/**
 * For interactive login: CLI opts override saved account, then .env.
 */
export function telegramApiCredentialsForLogin(
  account: AccountApiFields | null | undefined,
  opts: LoginApiCredentialOpts,
): { apiId: number; apiHash: string } {
  if (
    typeof opts.telegramApiId === 'number' &&
    !Number.isNaN(opts.telegramApiId) &&
    opts.telegramApiId > 0 &&
    typeof opts.telegramApiHash === 'string' &&
    opts.telegramApiHash.trim()
  ) {
    return { apiId: opts.telegramApiId, apiHash: opts.telegramApiHash.trim() };
  }
  return telegramApiCredentialsForAccount(account);
}
