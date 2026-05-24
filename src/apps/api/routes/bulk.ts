import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { ProxyModel } from '../../../db/models';
import { bulkImportAccountsFromCsv } from '../../../modules/auth/bulkImportAccounts';
import { importProxiesFromBulk } from '../../../modules/proxy/importProxies';
import { testProxy } from '../../../modules/proxy/test';
import { accountsBulkImportBody, bulkImportBody, validate } from '../validation';

export async function registerBulkRoutes(r: FastifyInstance): Promise<void> {
  r.post('/proxies/import', async (req, reply) => {
    const body = validate(reply, bulkImportBody, req.body ?? {});
    if (!body) return;
    const result = await importProxiesFromBulk({ csv: body.csv, json: body.json });

    if (body.testAfterImport) {
      for (const row of result.results) {
        if (!row.ok || !row.proxyId) continue;
        const proxy = await ProxyModel.findById(row.proxyId);
        if (!proxy) continue;
        const test = await testProxy(proxy);
        row.error = test.ok ? undefined : test.message;
        if (!test.ok) row.ok = false;
      }
    }

    return result;
  });

  r.post('/proxies/test-all', async () => {
    const proxies = await ProxyModel.find().lean();
    const results: Array<{
      id: string;
      label: string;
      type: string;
      ok: boolean;
      stage: string;
      message: string;
      durationMs: number;
    }> = [];

    for (const proxy of proxies) {
      const test = await testProxy(proxy);
      results.push({
        id: String(proxy._id),
        label: proxy.label,
        type: proxy.type,
        ok: test.ok,
        stage: test.stage,
        message: test.message,
        durationMs: test.durationMs,
      });
    }

    return { results, total: results.length, ok: results.filter((x) => x.ok).length };
  });

  r.post('/accounts/bulk-import', async (req, reply) => {
    const body = validate(reply, accountsBulkImportBody, req.body ?? {});
    if (!body) return;
    return bulkImportAccountsFromCsv(body.csv, { defaultCountry: body.defaultCountry });
  });
}
