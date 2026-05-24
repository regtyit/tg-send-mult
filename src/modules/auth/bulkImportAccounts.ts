import fs from 'fs';
import path from 'path';
import { AccountModel, ProxyModel } from '../../db/models';
import { importAccountFromJsonFile } from './jsonImport';
import { importSessionFromTdata } from './tdataImport';

export interface AccountBulkRow {
  phone?: string;
  Phone?: string;
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
    const sessionPath = pick(row, 'sessionPath', 'session_path');
    const label = pick(row, 'label', 'Label');
    const roleRaw = pick(row, 'role', 'Role').toLowerCase();
    const role = roleRaw === 'test_recipient' ? 'test_recipient' : 'sender';
    const proxyLabel = pick(row, 'proxyLabel', 'proxy_label');

    if (!phone || !sessionPath) {
      failed++;
      results.push({ line, ok: false, phone, error: 'phone and sessionPath required' });
      continue;
    }

    if (!fs.existsSync(sessionPath)) {
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

      const ext = path.extname(sessionPath).toLowerCase();
      const stat = fs.statSync(sessionPath);
      let accountId: string;

      if (stat.isDirectory() || sessionPath.toLowerCase().endsWith('.zip')) {
        const acc = await importSessionFromTdata(phone, sessionPath, {
          label,
          proxyId,
        });
        accountId = String(acc._id);
      } else if (ext === '.json') {
        const acc = await importAccountFromJsonFile(sessionPath, {
          phone,
          label,
          proxyId,
        });
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
      results.push({ line, ok: true, phone, accountId });
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
