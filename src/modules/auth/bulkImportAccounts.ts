import fs from 'fs';
import path from 'path';
import { AccountModel, ProxyModel } from '../../db/models';
import { resolveImportPath } from '../../util/resolveImportPath';
import { importAccountFromJsonFile, readJsonAccountMetadata } from './jsonImport';
import { importSessionFromTdata } from './tdataImport';
import { normalizePhoneE164 } from '../accounts/phoneCountry';

export interface AccountBulkRow {
  phone?: string;
  Phone?: string;
  username?: string;
  Username?: string;
  label?: string;
  Label?: string;
  role?: string;
  Role?: string;
  sessionPath?: string;
  session_path?: string;
  proxyLabel?: string;
  proxy_label?: string;
}

export interface AccountBulkLineResult {
  line: number;
  ok: boolean;
  phone?: string;
  accountId?: string;
  error?: string;
}

function pick(row: AccountBulkRow, ...keys: string[]): string {
  const r = row as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function findSiblingJsonMetadata(sessionPath: string): string | null {
  const resolved = resolveImportPath(sessionPath);
  const dirs = [path.dirname(resolved)];
  if (path.basename(resolved).toLowerCase() === 'tdata') {
    dirs.push(path.dirname(resolved));
  }
  const names = ['account.json', 'metadata.json', 'info.json'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    try {
      const jsonFiles = fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.json'))
        .sort();
      if (jsonFiles.length === 1) {
        return path.join(dir, jsonFiles[0]!);
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  return null;
}

export async function bulkImportAccountsFromCsv(
  csv: string,
  opts: { defaultCountry?: string } = {},
): Promise<{ results: AccountBulkLineResult[]; imported: number; failed: number }> {
  const { parseCsvBuffer } = await import('../contacts/importRows');
  const rows = parseCsvBuffer(csv) as AccountBulkRow[];
  const results: AccountBulkLineResult[] = [];
  let imported = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 2;
    const phone = pick(row, 'phone', 'Phone');
    const csvUsername = pick(row, 'username', 'Username');
    const sessionPath = pick(row, 'sessionPath', 'session_path');
    const label = pick(row, 'label', 'Label') || csvUsername;
    const roleRaw = pick(row, 'role', 'Role').toLowerCase();
    const role = roleRaw === 'test_recipient' ? 'test_recipient' : 'sender';
    const proxyLabel = pick(row, 'proxyLabel', 'proxy_label');

    if (!sessionPath) {
      failed++;
      results.push({ line, ok: false, phone, error: 'sessionPath required' });
      continue;
    }

    const resolvedSessionPath = resolveImportPath(sessionPath);
    if (!fs.existsSync(resolvedSessionPath)) {
      failed++;
      results.push({ line, ok: false, phone, error: `path not found: ${sessionPath}` });
      continue;
    }

    try {
      let proxyId: string | undefined;
      if (proxyLabel) {
        const proxy = await ProxyModel.findOne({ label: proxyLabel }).lean();
        if (!proxy) {
          failed++;
          results.push({ line, ok: false, phone, error: `proxy not found: ${proxyLabel}` });
          continue;
        }
        proxyId = String(proxy._id);
      }

      const ext = path.extname(resolvedSessionPath).toLowerCase();
      const stat = fs.statSync(resolvedSessionPath);
      let accountId: string;
      let effectivePhone = phone;

      if (stat.isDirectory() || resolvedSessionPath.toLowerCase().endsWith('.zip')) {
        const jsonPath = findSiblingJsonMetadata(resolvedSessionPath);
        const jsonMeta = jsonPath ? readJsonAccountMetadata(jsonPath, phone || undefined) : null;
        effectivePhone = normalizePhoneE164((phone || jsonMeta?.phone || '').trim());
        if (!effectivePhone) {
          failed++;
          results.push({
            line,
            ok: false,
            error: 'phone required in CSV or JSON metadata for tdata import',
          });
          continue;
        }
        const acc = await importSessionFromTdata(effectivePhone, resolvedSessionPath, {
          label: label || jsonMeta?.label,
          proxyId,
          deviceProfile: jsonMeta?.deviceProfile,
          ...(jsonMeta?.telegramApiId && jsonMeta.telegramApiHash
            ? { telegramApiId: jsonMeta.telegramApiId, telegramApiHash: jsonMeta.telegramApiHash }
            : {}),
        });
        accountId = String(acc._id);
      } else if (ext === '.json') {
        const acc = await importAccountFromJsonFile(resolvedSessionPath, {
          phone: phone ? normalizePhoneE164(phone) : undefined,
          label,
          proxyId,
        });
        effectivePhone = acc.phone;
        accountId = String(acc._id);
      } else {
        failed++;
        results.push({
          line,
          ok: false,
          phone,
          error: 'sessionPath must be tdata dir, .zip, or .json file',
        });
        continue;
      }

      if (role === 'test_recipient') {
        await AccountModel.updateOne(
          { _id: accountId },
          { $set: { role: 'test_recipient' } },
        );
      }

      imported++;
      results.push({ line, ok: true, phone: effectivePhone, accountId });
    } catch (err) {
      failed++;
      results.push({
        line,
        ok: false,
        phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void opts.defaultCountry;
  return { results, imported, failed };
}
