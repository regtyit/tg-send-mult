import { ProxyModel } from '../../db/models';
import type { ProxyDoc } from '../../db/models/Proxy';
import { tryParseTelegramProxyLink } from '../../telegram/proxyPayload';
import { parseBulkInput } from '../import/parseBulk';

export interface ProxyImportRow extends Record<string, unknown> {
  label?: string;
  Label?: string;
  type?: string;
  Type?: string;
  host?: string;
  Host?: string;
  port?: string | number;
  Port?: string | number;
  country?: string;
  Country?: string;
  secret?: string;
  Secret?: string;
  login?: string;
  Login?: string;
  password?: string;
  Password?: string;
}

export interface ProxyImportLineResult {
  line: number;
  ok: boolean;
  label?: string;
  proxyId?: string;
  error?: string;
}

function pick(row: ProxyImportRow, ...keys: string[]): string {
  const r = row as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

export async function importProxiesFromBulk(input: {
  csv?: string;
  json?: string;
}): Promise<{ results: ProxyImportLineResult[]; imported: number; failed: number }> {
  const { rows: rawRows } = parseBulkInput(input);
  const rows = rawRows as ProxyImportRow[];
  const results: ProxyImportLineResult[] = [];
  let imported = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 2;
    const label = pick(row, 'label', 'Label');
    const typeRaw = pick(row, 'type', 'Type').toLowerCase() || 'mtproto';
    let host = pick(row, 'host', 'Host');
    let port = Number.parseInt(pick(row, 'port', 'Port') || '443', 10);
    const country = pick(row, 'country', 'Country').toUpperCase().slice(0, 2);
    let secret = pick(row, 'secret', 'Secret');
    const login = pick(row, 'login', 'Login');
    const password = pick(row, 'password', 'Password');

    if (!label) {
      failed++;
      results.push({ line, ok: false, error: 'missing label' });
      continue;
    }

    if (!['mtproto', 'socks5', 'http'].includes(typeRaw)) {
      failed++;
      results.push({ line, ok: false, label, error: `invalid type ${typeRaw}` });
      continue;
    }

    const fromLink = tryParseTelegramProxyLink(host) ?? tryParseTelegramProxyLink(secret);
    if (fromLink) {
      host = fromLink.host;
      port = fromLink.port;
      if (!secret) secret = fromLink.secret;
    }

    if (!host || !Number.isInteger(port) || port <= 0) {
      failed++;
      results.push({ line, ok: false, label, error: 'invalid host/port' });
      continue;
    }

    if (typeRaw === 'mtproto' && !secret) {
      failed++;
      results.push({ line, ok: false, label, error: 'mtproto requires secret' });
      continue;
    }

    try {
      const existing = await ProxyModel.findOne({ label }).lean();
      const payload: Partial<ProxyDoc> = {
        label,
        type: typeRaw as ProxyDoc['type'],
        host,
        port,
        country: country || 'RU',
        secret: typeRaw === 'mtproto' ? secret : '',
        login: login || '',
        password: password || '',
      };
      if (existing) {
        await ProxyModel.updateOne({ _id: existing._id }, { $set: payload });
        imported++;
        results.push({ line, ok: true, label, proxyId: String(existing._id) });
      } else {
        const doc = await ProxyModel.create(payload);
        imported++;
        results.push({ line, ok: true, label, proxyId: String(doc._id) });
      }
    } catch (err) {
      failed++;
      results.push({
        line,
        ok: false,
        label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results, imported, failed };
}
