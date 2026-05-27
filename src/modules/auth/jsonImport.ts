import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { config } from '../../config';
import { AccountModel, ProxyModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { defaultDeviceProfile, type DeviceProfile } from '../../telegram/client';
import { resolveImportPath } from '../../util/resolveImportPath';
import { importSessionString, type ImportSessionOptions } from './sessionImport';
import { resolveSendingWindowForNewAccount } from '../accounts/regionalSendingWindow';

interface JsonAccountLike {
  phone?: string | number | null;
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

function stripJsonBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function normalizePhoneFromJson(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const digits = String(Math.trunc(Math.abs(value)));
    return digits || undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function normalizeLabelFromJson(obj: JsonAccountLike): string | undefined {
  const r = obj as Record<string, unknown>;
  for (const key of ['username', 'user_name', 'userName', 'login', 'name', 'first_name', 'firstName']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizeDeviceProfileFromJson(obj: JsonAccountLike): DeviceProfile {
  const d = defaultDeviceProfile();
  const r = obj as Record<string, unknown>;
  const pick = (keys: string[], fallback: string) => {
    for (const key of keys) {
      const value = r[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return fallback;
  };
  return {
    deviceModel: pick(['device', 'device_model', 'deviceModel'], d.deviceModel),
    systemVersion: pick(['sdk', 'system_version', 'systemVersion'], d.systemVersion),
    appVersion: pick(['app_version', 'appVersion'], d.appVersion),
    langCode: pick(['lang_code', 'langCode'], d.langCode),
    systemLangCode: pick(['system_lang_code', 'systemLangCode'], d.systemLangCode),
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

function hasFlatAccountFields(o: Record<string, unknown>): boolean {
  return (
    'phone' in o ||
    'app_id' in o ||
    'app_hash' in o ||
    'appId' in o ||
    'appHash' in o ||
    'api_id' in o ||
    'api_hash' in o ||
    'session_file' in o ||
    'sessionFile' in o ||
    'session' in o ||
    'device' in o
  );
}

/**
 * Normalize common account-export JSON shapes:
 * - flat object
 * - `{ "227636356": { ... } }` (phone/user id wrapper)
 * - `{ account: {...} }` / `{ data: {...} }`
 * - `[{ ... }]` array (optional phone hint to pick the right row)
 */
export function unwrapJsonAccountRoot(parsed: unknown, phoneHint?: string): JsonAccountLike {
  if (parsed == null) return {};

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return {};
    const hint = phoneHint?.trim();
    if (hint) {
      for (const item of parsed) {
        const row = unwrapJsonAccountRoot(item);
        const phone = normalizePhoneFromJson(row.phone);
        if (phone && (phone === hint || phone.endsWith(hint.replace(/^\+/, '')))) {
          return row;
        }
      }
    }
    return unwrapJsonAccountRoot(parsed[0]);
  }

  if (typeof parsed !== 'object') return {};

  const o = parsed as Record<string, unknown>;
  if (hasFlatAccountFields(o)) {
    return o as JsonAccountLike;
  }

  for (const key of ['account', 'data', 'session', 'user']) {
    const inner = o[key];
    if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
      const unwrapped = unwrapJsonAccountRoot(inner, phoneHint);
      if (Object.keys(unwrapped).length) return unwrapped;
    }
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

function parseJsonAccountFile(jsonPath: string, phoneHint?: string): JsonAccountLike {
  const resolved = resolveImportPath(jsonPath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read JSON metadata at ${jsonPath} (resolved: ${resolved}): ${msg}`);
  }
  try {
    return unwrapJsonAccountRoot(JSON.parse(stripJsonBom(raw)), phoneHint);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${jsonPath}: ${msg}`);
  }
}

function resolveSessionString(raw: unknown, baseDir: string): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  const absolute = resolveImportPath(path.isAbsolute(value) ? value : path.resolve(baseDir, value));
  if (fs.existsSync(absolute)) return fs.readFileSync(absolute, 'utf8').trim();
  return value;
}

function metadataFromAccountJson(data: JsonAccountLike): JsonAccountMetadata {
  const api = telegramApiFromJson(data);
  return {
    phone: normalizePhoneFromJson(data.phone),
    label: normalizeLabelFromJson(data),
    deviceProfile: normalizeDeviceProfileFromJson(data),
    telegramApiId: api.telegramApiId,
    telegramApiHash: api.telegramApiHash,
  };
}

/**
 * Parse account/device/API metadata from a JSON export without importing
 * session data. Useful when combining `tdata` session import with metadata
 * fields (`app_id`, `app_hash`, device/lang) from a separate JSON dump.
 */
export function readJsonAccountMetadata(jsonPath: string, phoneHint?: string): JsonAccountMetadata {
  const data = parseJsonAccountFile(jsonPath, phoneHint);
  return metadataFromAccountJson(data);
}

export async function importAccountFromJsonFile(
  jsonPath: string,
  opts: ImportJsonAccountOptions = {},
): Promise<AccountDoc> {
  const phoneHint = opts.phone?.trim();
  const data = parseJsonAccountFile(jsonPath, phoneHint);
  const jsonDir = path.dirname(resolveImportPath(jsonPath));

  const phone = String(phoneHint ?? normalizePhoneFromJson(data.phone) ?? '').trim();
  if (!phone) {
    throw new Error(
      'Phone is required. Provide it via --phone or include non-empty "phone" in JSON.',
    );
  }

  const proxyDoc = opts.proxyId
    ? await ProxyModel.findById(new Types.ObjectId(opts.proxyId))
    : null;

  const deviceProfile = opts.deviceProfile ?? normalizeDeviceProfileFromJson(data);
  const label = opts.label ?? normalizeLabelFromJson(data) ?? '';
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
