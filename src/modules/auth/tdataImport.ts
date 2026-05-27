import crypto from 'crypto';
import { unzipSync } from 'fflate';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AccountDoc } from '../../db/models/Account';
import { AccountModel } from '../../db/models';
import { phoneCountryIso2 } from '../accounts/phoneCountry';
import { resolveImportPath } from '../../util/resolveImportPath';
import { claimMtProxyForAccount, connectAccountViaMtProxies } from '../proxy/assign';
import { buildGramJsStringSessionV1 } from './gramJsStringSession';
import { importSessionString, type ImportSessionOptions } from './sessionImport';
import { connectWithSavedSession } from './connect';
import { TdesktopBinaryReader, igeDecrypt } from './tdesktopBinary';

/** Telegram Desktop writes `key_data` as a basename with suffix 0, 1, or `s`. */
const TDATA_KEY_FILES = ['key_data0', 'key_data1', 'key_datas'] as const;

function isLikelyTdataDir(dir: string): boolean {
  return TDATA_KEY_FILES.some((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * Locate a folder that looks like a Telegram Desktop `tdata` root (contains key_data*).
 * Walks subdirectories up to `maxDepth` (e.g. `Telegram Desktop/tdata` inside a parent path).
 */
export function findTdataDirectory(startDir: string, maxDepth = 10): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: path.resolve(startDir), depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);

    if (isLikelyTdataDir(dir)) return dir;
    if (depth >= maxDepth) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules') continue;
      queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return null;
}

function safeJoinUnderBase(baseDir: string, relPosix: string): string {
  const base = path.resolve(baseDir);
  const segments = relPosix
    .replace(/^[/\\]+/, '')
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new Error(`zip: path traversal in entry "${relPosix}"`);
  }
  const resolved = path.resolve(base, ...segments);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new Error(`zip: illegal path "${relPosix}"`);
  }
  return resolved;
}

function extractZipToDir(zipPath: string, destDir: string): void {
  const buf = fs.readFileSync(zipPath);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch (e) {
    throw new Error(`Invalid or unsupported zip (${path.basename(zipPath)}): ${String(e)}`);
  }
  const base = path.resolve(destDir);
  for (const name of Object.keys(files)) {
    if (name.endsWith('/')) continue;
    const target = safeJoinUnderBase(base, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, files[name]);
  }
}

export interface PreparedTdataRoot {
  root: string;
  cleanup: () => void;
}

/**
 * Resolve a `tdata` directory from a filesystem path or `.zip` archive.
 * Zips are extracted to a temporary directory; call `cleanup()` when done.
 */
export function prepareTdataRoot(inputPath: string): PreparedTdataRoot {
  const abs = resolveImportPath(inputPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Path does not exist: ${inputPath} (resolved: ${abs})`);
  }

  const stat = fs.statSync(abs);
  const noop = (): void => {};

  if (stat.isDirectory()) {
    if (isLikelyTdataDir(abs)) {
      return { root: abs, cleanup: noop };
    }
    const found = findTdataDirectory(abs);
    if (found) {
      return { root: found, cleanup: noop };
    }
    throw new Error(
      `No Telegram Desktop tdata found under ${abs}. Expected files like key_data0 / key_data1 / key_datas (often in a "tdata" folder).`,
    );
  }

  if (!stat.isFile()) {
    throw new Error(`Not a file or directory: ${abs}`);
  }

  const lower = abs.toLowerCase();
  if (!lower.endsWith('.zip')) {
    throw new Error(
      `Not a directory or .zip archive: ${abs}. Use a folder containing tdata or a zip of that folder.`,
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tdata-'));
  const cleanup = (): void => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  try {
    extractZipToDir(abs, tmp);
  } catch (e) {
    cleanup();
    throw e;
  }

  if (isLikelyTdataDir(tmp)) {
    return { root: tmp, cleanup };
  }
  const found = findTdataDirectory(tmp);
  if (found) {
    return { root: found, cleanup };
  }
  cleanup();
  throw new Error(
    `Zip did not contain a recognizable tdata folder (missing key_data0 / key_data1 / key_datas).`,
  );
}

function tdesktopMd5(data: string): string {
  const hex = crypto.createHash('md5').update(data).digest('hex');
  let out = '';
  for (let i = 0; i < hex.length; i += 2) out += hex[i + 1] + hex[i];
  return out.toUpperCase();
}

function tdesktopReadBuffer(reader: TdesktopBinaryReader): Buffer {
  const len = reader.read(4).reverse().readInt32LE();
  return len > 0 ? reader.read(len, false) : Buffer.alloc(0);
}

function sha1(buf: Buffer): Buffer {
  return crypto.createHash('sha1').update(buf).digest();
}

function calcLegacyAesKey(authKey: Buffer, msgKey: Buffer, client: boolean): [Buffer, Buffer] {
  const x = client ? 0 : 8;
  const sha1a = sha1(Buffer.concat([msgKey, authKey.subarray(x, x + 32)]));
  const sha1b = sha1(
    Buffer.concat([
      authKey.subarray(32 + x, 32 + x + 16),
      msgKey,
      authKey.subarray(48 + x, 48 + x + 16),
    ]),
  );
  const sha1c = sha1(Buffer.concat([authKey.subarray(64 + x, 64 + x + 32), msgKey]));
  const sha1d = sha1(Buffer.concat([msgKey, authKey.subarray(96 + x, 96 + x + 32)]));
  const aesKey = Buffer.concat([sha1a.subarray(0, 8), sha1b.subarray(8, 20), sha1c.subarray(4, 16)]);
  const aesIv = Buffer.concat([
    sha1a.subarray(8, 20),
    sha1b.subarray(0, 8),
    sha1c.subarray(16, 20),
    sha1d.subarray(0, 8),
  ]);
  return [aesKey, aesIv];
}

function tdesktopDecrypt(data: TdesktopBinaryReader, authKey: Buffer): TdesktopBinaryReader {
  const msgKey = data.read(16);
  const encryptedData = data.read();
  const [aesKey, aesIv] = calcLegacyAesKey(authKey, msgKey, false);
  const decrypted = igeDecrypt(encryptedData, aesKey, aesIv);
  if (msgKey.toString('hex') !== sha1(decrypted).subarray(0, 16).toString('hex')) {
    throw new Error('tdata decrypt failed: message key mismatch');
  }
  return new TdesktopBinaryReader(decrypted);
}

function tdesktopOpen(fileBasePath: string): TdesktopBinaryReader {
  const candidates = ['0', '1', 's']
    .map((suffix) => `${fileBasePath}${suffix}`)
    .filter((p) => fs.existsSync(p))
    .map((p) => new TdesktopBinaryReader(fs.readFileSync(p)));

  for (const reader of candidates) {
    if (reader.read(4).toString('utf8') !== 'TDF$') continue;
    const versionBytes = reader.read(4);
    let payload = reader.read();
    const fileMd5 = payload.subarray(-16).toString('hex');
    payload = payload.subarray(0, -16);
    const lengthBytes = Buffer.alloc(4);
    lengthBytes.writeInt32LE(payload.length, 0);
    const digestInput = Buffer.concat([payload, lengthBytes, versionBytes, Buffer.from('TDF$', 'utf8')]);
    const expectedMd5 = crypto.createHash('md5').update(digestInput).digest('hex');
    if (expectedMd5 !== fileMd5) continue;
    return new TdesktopBinaryReader(payload);
  }
  throw new Error(`Could not open tdata file: ${fileBasePath}`);
}

function tdesktopOpenEncrypted(fileBasePath: string, tdesktopKey: Buffer): TdesktopBinaryReader {
  const file = tdesktopOpen(fileBasePath);
  const encrypted = tdesktopReadBuffer(file);
  const data = tdesktopDecrypt(new TdesktopBinaryReader(encrypted), tdesktopKey);
  const length = data.readUInt32LE();
  if (length > data.getBuffer().length || length < 4) throw new Error('Malformed encrypted tdata payload');
  return data;
}

export async function tdataToStringSession(tdataPathInput: string): Promise<string> {
  const { root: tdataPath, cleanup } = prepareTdataRoot(tdataPathInput);
  try {
    return tdataToStringSessionFromDir(tdataPath);
  } finally {
    cleanup();
  }
}

/**
 * Telegram Desktop stores several integer fields in mixed-endian layouts
 * across versions/builds. For account count we expect a tiny positive value;
 * some dumps encode it as big-endian, while our old parser assumed LE only,
 * turning `1` into `16777216`.
 */
export function decodeTdataAccountCount(raw4: Buffer): number {
  if (raw4.length < 4) return 0;
  const le = raw4.readUInt32LE(0);
  const be = raw4.readUInt32BE(0);
  if (le >= 1 && le <= 64) return le;
  if (be >= 1 && be <= 64) return be;
  return le;
}

function tdataToStringSessionFromDir(tdataPath: string): string {
  const oldSessionKey = 'data';
  const partOneMd5 = tdesktopMd5(oldSessionKey).slice(0, 16);
  const userBasePath = path.join(tdataPath, partOneMd5);
  const keyFilePath = path.join(tdataPath, `key_${oldSessionKey}`);

  const data = tdesktopOpen(keyFilePath);
  const salt = tdesktopReadBuffer(data);
  if (salt.length !== 32) throw new Error('Invalid tdata key salt length');
  const encryptedKey = tdesktopReadBuffer(data);
  const encryptedInfo = tdesktopReadBuffer(data);

  const hash = crypto.createHash('sha512').update(salt).update('').update(salt).digest();
  const passKey = crypto.pbkdf2Sync(hash, salt, 1, 256, 'sha512');
  const key = tdesktopReadBuffer(tdesktopDecrypt(new TdesktopBinaryReader(encryptedKey), passKey));
  const info = tdesktopReadBuffer(tdesktopDecrypt(new TdesktopBinaryReader(encryptedInfo), key));
  const count = decodeTdataAccountCount(info.subarray(0, 4));
  if (count !== 1) {
    throw new Error(
      `This importer currently supports exactly one account in tdata, found ${count}.`,
    );
  }

  const main = tdesktopOpenEncrypted(userBasePath, key);
  const magic = main.read(4).reverse().readUInt32LE();
  if (magic !== 75) throw new Error(`Unsupported tdata magic version: ${magic}`);
  const final = new TdesktopBinaryReader(tdesktopReadBuffer(main));

  final.read(12);
  final.read(4);
  const mainDc = final.read(4).reverse().readUInt32LE();
  const dcCount = final.read(4).reverse().readUInt32LE();

  for (let i = 0; i < dcCount; i += 1) {
    const dcId = final.read(4).reverse().readUInt32LE();
    const authKeyBytes = final.read(256);
    if (dcId !== mainDc) continue;
    return buildGramJsStringSessionV1({
      dcId: mainDc,
      authKeyHex: authKeyBytes.toString('hex'),
    });
  }

  throw new Error(`Main DC auth key not found in tdata (dc=${mainDc})`);
}

export async function importSessionFromTdata(
  phone: string,
  tdataPath: string,
  opts: ImportSessionOptions = {},
): Promise<AccountDoc> {
  const sessionString = await tdataToStringSession(tdataPath);
  const { proxyId: preferProxyId, verifySession = true, ...importOpts } = opts;
  const account = await importSessionString(phone, sessionString, importOpts);

  if (verifySession === false) {
    const country = phoneCountryIso2(account.phone);
    if (country) {
      await claimMtProxyForAccount(account._id, country);
    }
    const refreshed = await AccountModel.findById(account._id);
    return refreshed ?? account;
  }

  return connectAccountViaMtProxies(
    account,
    (acc, proxy) => connectWithSavedSession(acc, proxy),
    preferProxyId,
    { maxAttempts: 3 },
  );
}
