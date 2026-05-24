import { Types } from 'mongoose';
import { config } from '../../config';
import { encryptSession } from '../../crypto/sessionCipher';
import { AccountModel, ProxyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { defaultDeviceProfile, type DeviceProfile } from '../../telegram/client';
import { applyWarmingSchedule } from '../accounts/warming';
import { applyWarmingSchedule } from '../accounts/warming';
import { logSessionEvent } from './sessionEvents';
import { buildGramJsStringSessionV1 } from './gramJsStringSession';
import { connectWithSavedSession } from './connect';
import { assertMtProxyPolicy } from '../proxy/policy';

export interface ImportSessionOptions {
  label?: string;
  proxyId?: string;
  deviceProfile?: DeviceProfile;
  /** Per-account Telegram API id (overrides TG_API_ID in .env). */
  telegramApiId?: number;
  /** Per-account Telegram API hash (overrides TG_API_HASH in .env). */
  telegramApiHash?: string;
}

/**
 * Quick sanity check on a session string. We accept both formats the Python
 * bridge can normalize:
 *   1. gramJS-style v1: `1` + base64 payload
 *   2. Telethon `StringSession.save()`: base64 (no `1` prefix)
 *
 * Both are URL-safe base64 (the gramJS format adds `+/=` padding too). To stay
 * permissive we just check that the value is reasonably long and made up of
 * legal base64/url-safe characters; `_normalize_session_string` in
 * `python/tg_worker/run.py` is the source of truth for actual parsing.
 */
const STRING_SESSION_RE = /^[A-Za-z0-9_+/=-]+$/;

export function looksLikeStringSession(raw: string): boolean {
  if (!raw) return false;
  if (raw.length < 16) return false;
  return STRING_SESSION_RE.test(raw);
}

/**
 * Stores a Telethon / gramJS-compatible `StringSession.save()` value.
 * Accepts both `1`+base64 (gramJS) and plain base64 (Telethon native) forms.
 */
export async function importSessionString(
  phone: string,
  sessionString: string,
  opts: ImportSessionOptions = {},
): Promise<AccountDoc> {
  const raw = sessionString.trim();
  if (!raw) {
    throw new Error('Session string is empty');
  }
  if (!looksLikeStringSession(raw)) {
    throw new Error(
      'Session string does not look like a Telethon/gramJS StringSession. ' +
        'Use auth import-mtp with DC id + auth key hex, or export a fresh ' +
        'StringSession from Telethon/Pyrogram/gramJS (StringSession.save()).',
    );
  }
  const enc = encryptSession(raw);
  const proxyDoc = opts.proxyId
    ? await ProxyModel.findById(new Types.ObjectId(opts.proxyId))
    : null;
  assertMtProxyPolicy({ phone }, proxyDoc);

  const apiFromOpts =
    typeof opts.telegramApiId === 'number' &&
    !Number.isNaN(opts.telegramApiId) &&
    opts.telegramApiId > 0 &&
    typeof opts.telegramApiHash === 'string' &&
    opts.telegramApiHash.trim()
      ? { telegramApiId: opts.telegramApiId, telegramApiHash: opts.telegramApiHash.trim() }
      : {};
  const apiFromEnv =
    typeof config.TG_API_ID === 'number' &&
    !Number.isNaN(config.TG_API_ID) &&
    config.TG_API_ID > 0 &&
    typeof config.TG_API_HASH === 'string' &&
    config.TG_API_HASH.trim()
      ? { telegramApiId: config.TG_API_ID, telegramApiHash: config.TG_API_HASH.trim() }
      : {};

  let account = await AccountModel.findOne({ phone: phone.trim() });
  if (!account) {
    account = await AccountModel.create({
      phone: phone.trim(),
      label: opts.label ?? '',
      deviceProfile: opts.deviceProfile ?? defaultDeviceProfile(),
      proxyId: proxyDoc?._id ?? null,
      sessionEnc: enc,
      sessionAuthorizedAt: new Date(),
      status: 'warming',
      sendingWindow: {
        start: config.DEFAULT_WINDOW_START,
        end: config.DEFAULT_WINDOW_END,
        timezone: config.DEFAULT_TIMEZONE,
      },
      dailyLimits: {
        msgsToNew: config.DEFAULT_MSGS_PER_DAY,
        contactsAdded: 20,
        ratePerHour: config.DEFAULT_RATE_PER_HOUR,
      },
      ...(Object.keys(apiFromOpts).length ? apiFromOpts : apiFromEnv),
    });
    applyWarmingSchedule(account);
    await account.save();
  } else {
    account.sessionEnc = enc;
    account.sessionAuthorizedAt = new Date();
    applyWarmingSchedule(account);
    if (opts.label) account.label = opts.label;
    if (proxyDoc) account.set('proxyId', proxyDoc._id);
    if (opts.deviceProfile) account.deviceProfile = opts.deviceProfile;
    if ('telegramApiId' in apiFromOpts) {
      account.telegramApiId = apiFromOpts.telegramApiId;
      account.telegramApiHash = apiFromOpts.telegramApiHash ?? '';
    } else if (!account.telegramApiId && !account.telegramApiHash && 'telegramApiId' in apiFromEnv) {
      /**
       * Preserve per-account creds when present; only backfill from env
       * for legacy rows so API id/hash become visible in DB/UI.
       */
      account.telegramApiId = apiFromEnv.telegramApiId;
      account.telegramApiHash = apiFromEnv.telegramApiHash ?? '';
    }
    await account.save();
  }

  await logSessionEvent(account._id, 'imported', {});
  return account;
}

export interface ImportMtpSessionParams {
  phone: string;
  dcId: number;
  authKeyHex: string;
  /** If set, connects once and checks `users.getFullUser` id matches (catches wrong key/DC). */
  expectedUserId?: string;
  serverHost?: string;
  serverPort?: number;
}

/**
 * Converts exported MTProto fields (phone, DC id, auth key hex, optional user id) into a StringSession and persists it.
 */
export async function importSessionFromMtpExport(
  params: ImportMtpSessionParams,
  opts: ImportSessionOptions = {},
): Promise<AccountDoc> {
  const sessionString = buildGramJsStringSessionV1({
    dcId: params.dcId,
    authKeyHex: params.authKeyHex,
    serverAddress: params.serverHost,
    port: params.serverPort,
  });

  const account = await importSessionString(params.phone, sessionString, opts);

  const expect = params.expectedUserId?.trim();
  if (expect) {
    const proxyDoc = opts.proxyId
      ? await ProxyModel.findById(new Types.ObjectId(opts.proxyId))
      : null;
    const { userId } = await connectWithSavedSession(account, proxyDoc);
    if (String(userId) !== String(expect)) {
      throw new Error(
        `Telegram user id mismatch: session resolved to ${userId}, export said ${expect}`,
      );
    }
  }

  return account;
}
