import { ProxyModel } from '../../db/models';
import type { ProxyDoc } from '../../db/models/Proxy';
import { coerceMtProxyImportFields, proxyDocToTelethonPayload } from '../../telegram/proxyPayload';
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

    if (typeRaw === 'mtproto') {
      const c = coerceMtProxyImportFields({
        host,
        port: Number.isInteger(port) && port > 0 ? port : 443,
        secret: secret || '',
      });
      host = c.host;
      port = c.port;
      secret = c.secret;
    } else if (!host.includes('://') && !host.includes('/') && !host.includes('?')) {
      const lastColon = host.lastIndexOf(':');
      if (lastColon > 0) {
        const tail = host.slice(lastColon + 1);
        const p = Number.parseInt(tail, 10);
        if (/^\d+$/.test(tail) && Number.isInteger(p) && p > 0 && p <= 65535) {
          host = host.slice(0, lastColon).trim();
          port = p;
        }
      }
    }

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
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
      if (typeRaw === 'mtproto') {
        proxyDocToTelethonPayload(payload as ProxyDoc);
      }
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
