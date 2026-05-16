import { Types } from 'mongoose';
import { config } from '../../config';
import { encryptSession } from '../../crypto/sessionCipher';
import { AccountModel, ProxyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import {
  MissingTelegramApiCredentialsError,
  telegramApiCredentialsForLogin,
} from '../../telegram/apiCredentials';
import { defaultDeviceProfile, type DeviceProfile } from '../../telegram/deviceProfile';
import { proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
import { runTelethonBridge, telethonCommon, unwrapTelethonBridge } from '../../telegram/pythonBridge';
import { mapTgError, TgDomainError } from '../../telegram/errors';
import { assertMtProxyPolicy } from '../proxy/policy';
import { promptLoginCode, promptLoginPhone, promptTwoFactorPassword } from './loginInquirer';
import { logSessionEvent } from './sessionEvents';
import { logger } from '../../logger';

const LOGIN_FLOOD_SLEEP_CAP_SEC = 86_400;

export interface InteractiveLoginOptions {
  phone?: string;
  proxyId?: string;
  label?: string;
  deviceProfile?: DeviceProfile;
  forceSMS?: boolean;
  telegramApiId?: number;
  telegramApiHash?: string;
}

/**
 * Interactive MTProto login: phone → code → optional 2FA. Persists encrypted StringSession (Telethon).
 */
export async function interactiveLogin(opts: InteractiveLoginOptions): Promise<AccountDoc> {
  const phone = await promptLoginPhone(opts.phone);

  let account = await AccountModel.findOne({ phone });
  const resolvedProxyId = opts.proxyId ?? (account?.proxyId ? String(account.proxyId) : undefined);
  const proxyDoc = resolvedProxyId ? await ProxyModel.findById(new Types.ObjectId(resolvedProxyId)) : null;
  if (!account) {
    account = await AccountModel.create({
      phone,
      label: opts.label ?? '',
      deviceProfile: opts.deviceProfile ?? defaultDeviceProfile(),
      proxyId: proxyDoc?._id ?? null,
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
      status: 'new',
    });
  } else if (opts.deviceProfile) {
    account.deviceProfile = opts.deviceProfile;
    await account.save();
  }

  await logSessionEvent(account._id, 'login_started', { phone });
  assertMtProxyPolicy(account, proxyDoc);

  const proxyPayload = proxyDocToTelethonPayload(proxyDoc);
  const device = account.deviceProfile ?? defaultDeviceProfile();

  try {
    const creds = telegramApiCredentialsForLogin(account, {
      telegramApiId: opts.telegramApiId,
      telegramApiHash: opts.telegramApiHash,
    });
    const common = telethonCommon(creds, device, proxyPayload, LOGIN_FLOOD_SLEEP_CAP_SEC);

    logger.info(
      {
        phone,
        forceSMS: !!opts.forceSMS,
        hint: 'Telegram usually sends login code to an already logged-in Telegram app first. If no app code arrives, retry with --force-sms.',
      },
      'auth: waiting for login code',
    );

    const sent = unwrapTelethonBridge(
      runTelethonBridge<{ phoneCodeHash: string; session: string }>({
        action: 'auth_send_code',
        phone,
        session: '',
        forceSMS: !!opts.forceSMS,
        ...common,
      }),
    );

    const code = await promptLoginCode(undefined);
    let session = sent.session;
    let phoneCodeHash = sent.phoneCodeHash;

    const signed = unwrapTelethonBridge(
      runTelethonBridge<{
        userId?: string;
        username?: string;
        session: string;
        needsPassword: boolean;
      }>({
        action: 'auth_sign_in',
        phone,
        code,
        phoneCodeHash,
        session,
        ...common,
      }),
    );

    if (signed.needsPassword === true) {
      session = signed.session;
      const pw = await promptTwoFactorPassword();
      if (!pw) {
        throw new TgDomainError({
          kind: 'phone_password_invalid',
          code: 'PASSWORD_REQUIRED',
          message: '2FA is enabled; password cannot be empty',
          retryable: false,
        });
      }
      const fin = unwrapTelethonBridge(
        runTelethonBridge<{ userId: string; username?: string; session: string }>({
          action: 'auth_password',
          password: pw,
          session,
          ...common,
        }),
      );
      session = fin.session;
      if (fin.username) {
        account.telegramUsername = fin.username;
      }
    } else {
      session = signed.session;
      if (signed.username) {
        account.telegramUsername = signed.username;
      }
    }

    account.sessionEnc = encryptSession(session);
    account.sessionAuthorizedAt = new Date();
    account.telegramApiId = creds.apiId;
    account.telegramApiHash = creds.apiHash;
    account.status = account.status === 'banned' ? 'new' : 'warming';
    if (!account.warmingStartedAt) {
      account.warmingStartedAt = new Date();
      const finish = new Date();
      finish.setDate(finish.getDate() + 7);
      account.warmingFinishesAt = finish;
    }
    await account.save();

    await logSessionEvent(account._id, 'login_succeeded', {});
    return account;
  } catch (err) {
    const mapped =
      err instanceof MissingTelegramApiCredentialsError
        ? new TgDomainError({
            kind: 'unknown',
            code: 'NO_API_CREDENTIALS',
            message: err.message,
            retryable: false,
          })
        : err instanceof TgDomainError
          ? err
          : mapTgError(err);
    await logSessionEvent(account._id, 'login_failed', {
      code: mapped.code,
      message: mapped.message,
    });
    throw mapped;
  }
}
