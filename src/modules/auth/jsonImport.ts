import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { config } from '../../config';
import { AccountModel, ProxyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { defaultDeviceProfile, type DeviceProfile } from '../../telegram/client';
import { importSessionString, type ImportSessionOptions } from './sessionImport';
import { resolveSendingWindowForNewAccount } from '../accounts/regionalSendingWindow';

interface JsonAccountLike {
  phone?: string | null;
  username?: string | null;
  device?: string | null;
  sdk?: string | null;
  app_version?: string | null;
  lang_code?: string | null;
  system_lang_code?: string | null;
  session_file?: string | null;
  app_id?: string | number | null;
  app_hash?: string | number | null;
}

export interface ImportJsonAccountOptions extends ImportSessionOptions {
  phone?: string;
}

export interface JsonAccountMetadata {
  phone?: string;
  label?: string;
  deviceProfile: DeviceProfile;
  telegramApiId?: number;
  telegramApiHash?: string;
}

function normalizeDeviceProfileFromJson(obj: JsonAccountLike): DeviceProfile {
  const d = defaultDeviceProfile();
  const pick = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
  };
  return {
    deviceModel: pick(obj.device, d.deviceModel),
    systemVersion: pick(obj.sdk, d.systemVersion),
    appVersion: pick(obj.app_version, d.appVersion),
    langCode: pick(obj.lang_code, d.langCode),
    systemLangCode: pick(obj.system_lang_code, d.systemLangCode),
  };
}

function readRecord(obj: JsonAccountLike): Record<string, unknown> {
  return obj as Record<string, unknown>;
}

/** app_id / app_hash and common export aliases (api_id, camelCase, etc.). */
function telegramApiFromJson(obj: JsonAccountLike): {
  telegramApiId?: number;
  telegramApiHash?: string;
} {
  const r = readRecord(obj);
  const rawId =
    r.app_id ??
    r.appId ??
    r.api_id ??
    r.apiId ??
    r.tg_app_id ??
    r.telegram_api_id ??
    r.TG_API_ID;
  let telegramApiId: number | undefined;
  if (typeof rawId === 'number' && rawId > 0) {
    const n = Math.trunc(rawId);
    if (n > 0) telegramApiId = n;
  } else if (typeof rawId === 'string' && rawId.trim()) {
    const n = parseInt(rawId.trim(), 10);
    if (!Number.isNaN(n) && n > 0) telegramApiId = n;
  }
  const rawHash =
    r.app_hash ??
    r.appHash ??
    r.api_hash ??
    r.apiHash ??
    r.tg_app_hash ??
    r.telegram_api_hash ??
    r.TG_API_HASH;
  let telegramApiHash: string | undefined;
  if (typeof rawHash === 'string' && rawHash.trim()) telegramApiHash = rawHash.trim();
  else if (typeof rawHash === 'number' && Number.isFinite(rawHash)) telegramApiHash = String(rawHash);
  if (telegramApiId && telegramApiHash) {
    return { telegramApiId, telegramApiHash };
  }
  return {};
}

/**
 * Some exports wrap the account in a single-key object, e.g. `{ "227636356": { "app_id": ... } }`.
 */
function unwrapJsonAccountRoot(parsed: unknown): JsonAccountLike {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const o = parsed as Record<string, unknown>;
  const hasFlatAccountField =
    'phone' in o ||
    'app_id' in o ||
    'app_hash' in o ||
    'appId' in o ||
    'appHash' in o ||
    'session_file' in o ||
    'sessionFile' in o;
  if (hasFlatAccountField) {
    return o as JsonAccountLike;
  }
  const keys = Object.keys(o);
  if (keys.length === 1) {
    const inner = o[keys[0]];
    if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as JsonAccountLike;
    }
  }
  return o as JsonAccountLike;
}

function resolveSessionString(raw: unknown, baseDir: string): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  const absolute = path.isAbsolute(value) ? value : path.resolve(baseDir, value);
  if (fs.existsSync(absolute)) return fs.readFileSync(absolute, 'utf8').trim();
  return value;
}

/**
 * Parse account/device/API metadata from a JSON export without importing
 * session data. Useful when combining `tdata` session import with metadata
 * fields (`app_id`, `app_hash`, device/lang) from a separate JSON dump.
 */
export function readJsonAccountMetadata(jsonPath: string): JsonAccountMetadata {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = unwrapJsonAccountRoot(JSON.parse(raw));
  const api = telegramApiFromJson(data);
  return {
    phone: typeof data.phone === 'string' ? data.phone.trim() || undefined : undefined,
    label: typeof data.username === 'string' ? data.username.trim() || undefined : undefined,
    deviceProfile: normalizeDeviceProfileFromJson(data),
    telegramApiId: api.telegramApiId,
    telegramApiHash: api.telegramApiHash,
  };
}

export async function importAccountFromJsonFile(
  jsonPath: string,
  opts: ImportJsonAccountOptions = {},
): Promise<AccountDoc> {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = unwrapJsonAccountRoot(JSON.parse(raw));
  const jsonDir = path.dirname(path.resolve(jsonPath));

  const phone = String(opts.phone ?? data.phone ?? '').trim();
  if (!phone) {
    throw new Error(
      'Phone is required. Provide it via --phone or include non-empty "phone" in JSON.',
    );
  }

  const proxyDoc = opts.proxyId
    ? await ProxyModel.findById(new Types.ObjectId(opts.proxyId))
    : null;

  const deviceProfile = opts.deviceProfile ?? normalizeDeviceProfileFromJson(data);
  const label = opts.label ?? String(data.username ?? '').trim();
  const rdata = readRecord(data);
  const sessionString = resolveSessionString(
    rdata.session_file ?? rdata.sessionFile ?? rdata.session,
    jsonDir,
  );
  const apiJson = telegramApiFromJson(data);
  const apiCli =
    typeof opts.telegramApiId === 'number' &&
    !Number.isNaN(opts.telegramApiId) &&
    opts.telegramApiId > 0 &&
    typeof opts.telegramApiHash === 'string' &&
    opts.telegramApiHash.trim()
      ? { telegramApiId: opts.telegramApiId, telegramApiHash: opts.telegramApiHash.trim() }
      : null;
  const api = apiCli ?? (Object.keys(apiJson).length ? apiJson : {});

  if (sessionString) {
    if (!opts.proxyId) {
      throw new Error(
        'MTProxy is required to import session from JSON. Pass --proxy-id <id>, or set TELEGRAM_PROXY_ID, or TG_MTPROXY_HOST/TG_MTPROXY_PORT in .env.',
      );
    }
    return importSessionString(phone, sessionString, {
      proxyId: opts.proxyId,
      label,
      deviceProfile,
      ...api,
    });
  }

  let account = await AccountModel.findOne({ phone });
  if (!account) {
    const sw = resolveSendingWindowForNewAccount(phone, null);
    account = await AccountModel.create({
      phone,
      label,
      deviceProfile,
      proxyId: proxyDoc?._id ?? null,
      status: 'new',
      sendingWindow: {
        start: sw.start,
        end: sw.end,
        timezone: sw.timezone,
      },
      dailyLimits: {
        msgsToNew: config.DEFAULT_MSGS_PER_DAY,
        contactsAdded: 20,
        ratePerHour: config.DEFAULT_RATE_PER_HOUR,
      },
      ...(api.telegramApiId && api.telegramApiHash
        ? { telegramApiId: api.telegramApiId, telegramApiHash: api.telegramApiHash }
        : {}),
    });
  } else {
    account.deviceProfile = deviceProfile;
    if (label) account.label = label;
    if (proxyDoc) account.set('proxyId', proxyDoc._id);
    if (api.telegramApiId && api.telegramApiHash) {
      account.telegramApiId = api.telegramApiId;
      account.telegramApiHash = api.telegramApiHash;
    }
    await account.save();
  }

  return account;
}
