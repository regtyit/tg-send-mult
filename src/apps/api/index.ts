import path from 'path';
import fs from 'fs';
import fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyBasicAuth from '@fastify/basic-auth';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { Types } from 'mongoose';
import { parsePhoneNumber } from 'libphonenumber-js';
import { config } from '../../config';
import { connectMongo } from '../../db';
import {
  AccountModel,
  CampaignModel,
  ContactModel,
  InboundReplyModel,
  MessageModel,
  ProxyModel,
  TemplateModel,
} from '../../db/models';
import { logger } from '../../logger';
import { getSendQueue } from '../../queue/queues';
import { parseCsvBuffer, parseJsonBuffer, importContactsFromRows } from '../../modules/contacts/importRows';
import { ensureContactForTestRecipient } from '../../modules/contacts/testRecipient';
import { importAccountFromJsonFile, importSessionFromTdata, readJsonAccountMetadata } from '../../modules/auth/login';
import { pauseCampaign, resumeCampaign, startCampaign } from '../../modules/messaging/campaignLifecycle';
import { resolveAccountSpecifiers } from '../../modules/accounts/resolveAccountSpecifiers';
import { defaultDeviceProfile, type DeviceProfile } from '../../telegram/client';
import { tryParseTelegramProxyLink } from '../../telegram/proxyPayload';
import { sendText } from '../../modules/messaging/send';
import { installShutdownHandlers, onShutdown } from '../../util/shutdown';
import { syncInboundRepliesForAccount } from '../../modules/messaging/syncInboundReplies';
import { verifyCampaignDelivery } from '../../modules/messaging/verifyCampaign';
import { testProxy } from '../../modules/proxy/test';
import {
  sanitizeAccount,
  sanitizeAccounts,
  sanitizeProxies,
  sanitizeProxy,
} from './sanitize';
import {
  accountAssignProxyAutoBody,
  accountAssignProxyBody,
  accountCreateBody,
  accountPatchBody,
  accountSendTestBody,
  accountSessionBody,
  accountImportTdataBody,
  accountImportJsonBody,
  campaignCreateBody,
  contactsImportBody,
  contactsQuery,
  idParams,
  inboundRepliesQuery,
  messagesQuery,
  proxyCreateBody,
  proxyPatchBody,
  templateCreateBody,
  validate,
} from './validation';

function normalizeDeviceProfile(input?: Partial<DeviceProfile> | null): DeviceProfile {
  const defaults = defaultDeviceProfile();
  const trimOr = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
  };
  return {
    deviceModel: trimOr(input?.deviceModel, defaults.deviceModel),
    systemVersion: trimOr(input?.systemVersion, defaults.systemVersion),
    appVersion: trimOr(input?.appVersion, defaults.appVersion),
    langCode: trimOr(input?.langCode, defaults.langCode),
    systemLangCode: trimOr(input?.systemLangCode, defaults.systemLangCode),
  };
}

function phoneCountryIso2(phone: string): string | null {
  try {
    return parsePhoneNumber(phone.trim())?.country?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

async function ensureProxyNotUsedByAnotherAccount(
  proxyId: string,
  accountId: string,
): Promise<void> {
  const conflict = await AccountModel.findOne({
    _id: { $ne: new Types.ObjectId(accountId) },
    proxyId: new Types.ObjectId(proxyId),
  })
    .select('_id phone')
    .lean();
  if (conflict) {
    throw new Error(`MTProxy already assigned to another account: ${conflict.phone}`);
  }
}

/**
 * Atomically claim an unused MTProxy for the given account/country and write
 * the assignment back to the account document. Two concurrent auto-assign
 * requests will pick distinct proxies (or the second returns null if there
 * are no more free proxies in that country) instead of both racing on the
 * same one.
 *
 * Implementation: `findOneAndUpdate` on Account with a guard that the proxy
 * we picked isn't already used by any other account.
 */
async function claimProxyForAccount(
  accountId: Types.ObjectId,
  country: string,
): Promise<string | null> {
  const upper = country.toUpperCase();
  const MAX_ATTEMPTS = 8;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const used = await AccountModel.find({
      _id: { $ne: accountId },
      proxyId: { $ne: null },
    })
      .select('proxyId')
      .lean();
    const usedIds = used
      .map((x) => (x.proxyId ? new Types.ObjectId(String(x.proxyId)) : null))
      .filter((x): x is Types.ObjectId => x !== null);

    const candidate = await ProxyModel.findOne({
      country: upper,
      ...(usedIds.length ? { _id: { $nin: usedIds } } : {}),
    })
      .sort({ healthScore: -1, createdAt: 1 })
      .select('_id')
      .lean();
    if (!candidate?._id) return null;

    /**
     * Conditional claim: only set proxyId if no *other* account has it. The
     * `$elemMatch` style filter on the Account collection wouldn't help here,
     * so we double-check the proxy is still free at write time. If a race
     * stole it from us we just pick the next candidate.
     */
    const stillFree = await AccountModel.exists({
      _id: { $ne: accountId },
      proxyId: candidate._id,
    });
    if (stillFree) {
      continue;
    }
    const updated = await AccountModel.findOneAndUpdate(
      { _id: accountId },
      { $set: { proxyId: candidate._id } },
      { new: true },
    );
    if (updated) {
      return String(candidate._id);
    }
    return null;
  }
  return null;
}

async function buildBoard(): Promise<FastifyAdapter> {
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin/queues');
  const accounts = await AccountModel.find({ sessionEnc: { $ne: '' } }).lean();
  /** Reuse the pooled Queue instances so Bull Board shares Redis connections with the dispatcher. */
  const queues = accounts.map((a) => getSendQueue(a._id.toString()));
  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });
  return serverAdapter;
}

async function main() {
  installShutdownHandlers();
  await connectMongo();

  const app = fastify({ logger: false });

  /**
   * CORS policy:
   * - In development with no allowlist configured, reflect any origin so the
   *   Vite/Nuxt dev server (typically localhost:3000) can call the API on
   *   localhost:3001 with credentials.
   * - In production, default-deny: only origins explicitly listed in
   *   `CORS_ALLOWED_ORIGINS` (comma-separated) are accepted. Set
   *   `CORS_ALLOWED_ORIGINS=*` to opt-in to wildcard if you really must.
   */
  const corsAllowList = config.CORS_ALLOWED_ORIGINS;
  const wildcardCors = corsAllowList.length === 1 && corsAllowList[0] === '*';
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (wildcardCors) return cb(null, true);
      if (corsAllowList.length === 0) {
        if (config.NODE_ENV !== 'production') return cb(null, true);
        return cb(null, false);
      }
      if (corsAllowList.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  });

  await app.register(fastifyBasicAuth, {
    validate: (username, password, _req, _reply, done) => {
      if (username !== config.API_BASIC_USER || password !== config.API_BASIC_PASSWORD) {
        done(new Error('Unauthorized'));
      } else {
        done();
      }
    },
    authenticate: { realm: 'tg-send-mult' },
  });

  app.addHook('onRequest', (request, reply, done) => {
    if (request.url === '/health' || request.url.startsWith('/health?')) {
      return done();
    }
    app.basicAuth(request, reply, done);
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/metrics', async (_req, reply) => {
    const [sent, failed, queued] = await Promise.all([
      MessageModel.countDocuments({ status: 'sent' }),
      MessageModel.countDocuments({ status: 'failed' }),
      MessageModel.countDocuments({ status: 'queued' }),
    ]);
    const lines = [
      '# HELP tg_messages_sent_total Messages marked sent',
      '# TYPE tg_messages_sent_total counter',
      `tg_messages_sent_total ${sent}`,
      '# HELP tg_messages_failed_total Messages failed',
      '# TYPE tg_messages_failed_total counter',
      `tg_messages_failed_total ${failed}`,
      '# HELP tg_messages_queued_total Messages queued',
      '# TYPE tg_messages_queued_total gauge',
      `tg_messages_queued_total ${queued}`,
      '',
    ];
    return reply.type('text/plain').send(lines.join('\n'));
  });

  await app.register(
    async (r) => {
      r.get('/accounts', async () =>
        sanitizeAccounts(await AccountModel.find().sort({ createdAt: -1 }).lean()),
      );

      r.post('/accounts', async (req, reply) => {
        const body = validate(reply, accountCreateBody, req.body);
        if (!body) return;
        const proxyId = body.proxyId ? new Types.ObjectId(body.proxyId) : null;
        const tid = typeof body.telegramApiId === 'number' ? body.telegramApiId : null;
        const th = body.telegramApiHash?.trim() ?? '';
        const created = await AccountModel.create({
          phone: body.phone.trim(),
          label: body.label ?? '',
          role: body.role ?? 'sender',
          deviceProfile: normalizeDeviceProfile(body.deviceProfile),
          proxyId,
          ...(tid && th ? { telegramApiId: tid, telegramApiHash: th } : {}),
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
        if (created.role === 'test_recipient') {
          await ensureContactForTestRecipient(created);
        }
        return sanitizeAccount(created);
      });

      r.patch('/accounts/:id', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const body = validate(reply, accountPatchBody, req.body);
        if (!body) return;
        const patch: Record<string, unknown> = { ...body };
        delete patch.telegramApiId;
        delete patch.telegramApiHash;
        if (body.telegramApiId !== undefined) {
          patch.telegramApiId = body.telegramApiId ?? null;
        }
        if (body.telegramApiHash !== undefined) {
          patch.telegramApiHash = body.telegramApiHash.trim();
        }
        if (typeof body.proxyId === 'string' && body.proxyId.trim()) {
          await ensureProxyNotUsedByAnotherAccount(body.proxyId, params.id);
        }
        if (body.deviceProfile) {
          const acc = await AccountModel.findById(params.id).lean();
          if (!acc) return reply.code(404).send({ error: 'not found' });
          patch.deviceProfile = normalizeDeviceProfile({
            ...(acc.deviceProfile ?? {}),
            ...body.deviceProfile,
          });
        }
        const updated = await AccountModel.findByIdAndUpdate(params.id, { $set: patch }, { new: true });
        if (!updated) return reply.code(404).send({ error: 'not found' });
        if (updated.role === 'test_recipient') {
          await ensureContactForTestRecipient(updated);
        }
        return sanitizeAccount(updated);
      });

      r.post('/accounts/:id/assign-mtproxy', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const body = validate(reply, accountAssignProxyBody, req.body ?? {});
        if (!body) return;
        const id = new Types.ObjectId(params.id);
        const account = await AccountModel.findById(id);
        if (!account) return reply.code(404).send({ error: 'not found' });

        if (body.proxyId === null) {
          account.proxyId = null;
          await account.save();
          return sanitizeAccount(account);
        }

        if (body.auto || !body.proxyId) {
          const country = phoneCountryIso2(account.phone);
          if (!country) {
            return reply.code(400).send({ error: `Cannot derive country from phone ${account.phone}` });
          }
          const picked = await claimProxyForAccount(account._id, country);
          if (!picked) {
            return reply.code(400).send({ error: `No free proxy for country ${country}` });
          }
          const refreshed = await AccountModel.findById(account._id);
          return sanitizeAccount(refreshed);
        }

        const proxyId = new Types.ObjectId(body.proxyId);
        const proxy = await ProxyModel.findById(proxyId);
        if (!proxy) return reply.code(404).send({ error: 'proxy not found' });
        const phoneCountry = phoneCountryIso2(account.phone);
        if (!phoneCountry) {
          return reply.code(400).send({ error: `Cannot derive country from phone ${account.phone}` });
        }
        if (String(proxy.country ?? '').toUpperCase() !== phoneCountry) {
          return reply
            .code(400)
            .send({ error: `Proxy country ${proxy.country} does not match phone country ${phoneCountry}` });
        }
        await ensureProxyNotUsedByAnotherAccount(String(proxy._id), String(account._id));
        account.set('proxyId', proxy._id);
        await account.save();
        return sanitizeAccount(account);
      });

      r.post('/accounts/assign-mtproxy-auto', async (req, reply) => {
        const body = validate(reply, accountAssignProxyAutoBody, req.body ?? {});
        if (!body) return;
        const onlyUnassigned = body.onlyUnassigned !== false;
        const accounts = await AccountModel.find(onlyUnassigned ? { proxyId: null } : {}).sort({ createdAt: 1 });
        let assigned = 0;
        let skipped = 0;
        const errors: string[] = [];
        for (const acc of accounts) {
          const country = phoneCountryIso2(acc.phone);
          if (!country) {
            skipped++;
            errors.push(`${acc.phone}: country unknown`);
            continue;
          }
          const picked = await claimProxyForAccount(acc._id, country);
          if (!picked) {
            skipped++;
            errors.push(`${acc.phone}: no free proxy for ${country}`);
            continue;
          }
          assigned++;
        }
        return { assigned, skipped, errors };
      });

      r.delete('/accounts/:id', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const removed = await AccountModel.findByIdAndDelete(params.id);
        if (!removed) return reply.code(404).send({ error: 'not found' });
        return { ok: true };
      });

      r.post('/accounts/:id/send-test', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const body = validate(reply, accountSendTestBody, req.body);
        if (!body) return;
        const account = await AccountModel.findById(params.id);
        if (!account) return reply.code(404).send({ error: 'not found' });
        const proxy = account.proxyId ? await ProxyModel.findById(account.proxyId) : null;
        const sent = await sendText(account, proxy, body.to.trim(), body.text);
        return { ok: true, randomId: sent.randomId };
      });

      r.post('/accounts/:id/inbound-replies/sync', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const account = await AccountModel.findById(params.id);
        if (!account) return reply.code(404).send({ error: 'not found' });
        const proxy = account.proxyId ? await ProxyModel.findById(account.proxyId) : null;
        const result = await syncInboundRepliesForAccount(account, proxy, { markRead: true });
        return {
          ok: true,
          accountId: String(account._id),
          saved: result.saved,
          scanned: result.scanned,
          markedRead: result.markedRead,
        };
      });

      r.post('/accounts/:id/session', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const body = validate(reply, accountSessionBody, req.body);
        if (!body) return;
        const acc = await AccountModel.findById(params.id);
        if (!acc) return reply.code(404).send({ error: 'not found' });
        const { encryptSession } = await import('../../crypto/sessionCipher');
        acc.sessionEnc = encryptSession(body.sessionString.trim());
        acc.sessionAuthorizedAt = new Date();
        acc.status = 'warming';
        await acc.save();
        return sanitizeAccount(acc);
      });

      r.post('/accounts/import-tdata', async (req, reply) => {
        const body = validate(reply, accountImportTdataBody, req.body);
        if (!body) return;
        const jsonMeta = body.jsonPath ? readJsonAccountMetadata(body.jsonPath) : null;
        const imported = await importSessionFromTdata(body.phone, body.tdataPath, {
          proxyId: body.proxyId,
          label: body.label || jsonMeta?.label,
          deviceProfile: jsonMeta?.deviceProfile,
          ...(jsonMeta?.telegramApiId && jsonMeta.telegramApiHash
            ? { telegramApiId: jsonMeta.telegramApiId, telegramApiHash: jsonMeta.telegramApiHash }
            : {}),
        });
        if (body.role) {
          await AccountModel.findByIdAndUpdate(imported._id, { $set: { role: body.role } });
          imported.role = body.role;
        }
        if (imported.role === 'test_recipient') {
          await ensureContactForTestRecipient(imported);
        }
        return sanitizeAccount(imported);
      });

      r.post('/accounts/import-json', async (req, reply) => {
        const body = validate(reply, accountImportJsonBody, req.body);
        if (!body) return;
        const imported = await importAccountFromJsonFile(body.jsonPath, {
          phone: body.phone,
          proxyId: body.proxyId,
          label: body.label,
        });
        if (body.role) {
          await AccountModel.findByIdAndUpdate(imported._id, { $set: { role: body.role } });
          imported.role = body.role;
        }
        if (imported.role === 'test_recipient') {
          await ensureContactForTestRecipient(imported);
        }
        return sanitizeAccount(imported);
      });

      r.get('/proxies', async () =>
        sanitizeProxies(await ProxyModel.find().sort({ createdAt: -1 }).lean()),
      );

      r.post('/proxies', async (req, reply) => {
        const body = validate(reply, proxyCreateBody, req.body);
        if (!body) return;
        const fromLink = body.type === 'mtproto' ? tryParseTelegramProxyLink(body.host) : null;
        const created = await ProxyModel.create({
          ...body,
          host: fromLink?.host ?? body.host,
          port: fromLink?.port ?? body.port,
          secret: body.type === 'mtproto' ? (fromLink?.secret ?? body.secret ?? '').trim() : '',
          country: (body.country ?? '').trim().toUpperCase(),
        });
        return sanitizeProxy(created);
      });

      r.patch('/proxies/:id', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const body = validate(reply, proxyPatchBody, req.body);
        if (!body) return;
        const patch: Record<string, unknown> = { ...body };
        const effectiveType = typeof body.type === 'string' ? body.type : undefined;
        if (typeof body.host === 'string' && (effectiveType === 'mtproto' || effectiveType == null)) {
          const fromLink = tryParseTelegramProxyLink(body.host);
          if (fromLink) {
            patch.host = fromLink.host;
            patch.port = fromLink.port;
            if (!body.secret) patch.secret = fromLink.secret;
          }
        }
        if (effectiveType && effectiveType !== 'mtproto') {
          patch.secret = '';
        }
        if (typeof body.country === 'string') {
          patch.country = body.country.trim().toUpperCase();
        }
        const updated = await ProxyModel.findByIdAndUpdate(params.id, { $set: patch }, { new: true });
        if (!updated) return reply.code(404).send({ error: 'not found' });
        return sanitizeProxy(updated);
      });

      r.delete('/proxies/:id', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const removed = await ProxyModel.findByIdAndDelete(params.id);
        if (!removed) return reply.code(404).send({ error: 'not found' });
        return { ok: true };
      });

      r.post('/proxies/:id/test', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const proxy = await ProxyModel.findById(params.id);
        if (!proxy) return reply.code(404).send({ error: 'not found' });
        return testProxy(proxy);
      });

      r.post('/contacts/import', async (req, reply) => {
        const body = validate(reply, contactsImportBody, req.body);
        if (!body) return;
        const rows = body.csv ? parseCsvBuffer(body.csv) : parseJsonBuffer(body.json!);
        return importContactsFromRows(rows, {
          tags: body.tags,
          defaultCountry: body.defaultCountry,
          source: 'api',
        });
      });

      r.get('/contacts', async (req, reply) => {
        const q = validate(reply, contactsQuery, req.query ?? {}, 'query');
        if (!q) return;
        const filter: Record<string, unknown> = {};
        if (q.tag) filter.tags = q.tag;
        if (q.status) filter.status = q.status;
        if (q.q) {
          const regex = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          filter.$or = [
            { phoneE164: regex },
            { username: regex },
            { firstName: regex },
            { lastName: regex },
          ];
        }
        /**
         * Backwards-compat: callers that hit /api/contacts with no pagination
         * params still get a flat array (the campaigns page picker depends on
         * this). When `paginated=true` (or `skip>0`) we return the structured
         * page shape `{ items, total, limit, skip }` so the contacts page can
         * render server-paged tables.
         */
        const wantsPaginated = q.paginated || q.skip > 0;
        if (!wantsPaginated) {
          return ContactModel.find(filter)
            .sort({ createdAt: -1 })
            .limit(q.limit)
            .lean();
        }
        const [items, total] = await Promise.all([
          ContactModel.find(filter).sort({ createdAt: -1 }).skip(q.skip).limit(q.limit).lean(),
          ContactModel.countDocuments(filter),
        ]);
        return { items, total, limit: q.limit, skip: q.skip };
      });
      r.delete('/contacts/:id', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const removed = await ContactModel.findByIdAndDelete(params.id);
        if (!removed) return reply.code(404).send({ error: 'not found' });
        return { ok: true };
      });

      r.get('/templates', async () =>
        TemplateModel.find().sort({ createdAt: -1 }).lean(),
      );
      r.post('/templates', async (req, reply) => {
        const body = validate(reply, templateCreateBody, req.body);
        if (!body) return;
        return TemplateModel.create(body);
      });
      r.delete('/templates/:id', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const removed = await TemplateModel.findByIdAndDelete(params.id);
        if (!removed) return reply.code(404).send({ error: 'not found' });
        return { ok: true };
      });

      r.get('/campaigns', async () =>
        CampaignModel.find().sort({ createdAt: -1 }).lean(),
      );
      r.post('/campaigns', async (req, reply) => {
        const body = validate(reply, campaignCreateBody, req.body);
        if (!body) return;
        const resolved = await resolveAccountSpecifiers(body.accountPool);
        if (resolved.unresolved.length) {
          return reply.code(400).send({
            error: 'unknown_accounts',
            unresolved: resolved.unresolved,
            message:
              'Could not match sending account(s). Use the phone you logged in with (+E.164), your Telegram @username (shown on Senders after login), or the internal id from the table.',
          });
        }
        const hg = body.homoglyphs;
        return CampaignModel.create({
          name: body.name,
          templateId: new Types.ObjectId(body.templateId),
          accountPool: resolved.ids,
          audience: {
            contactIds: body.audience?.contactIds?.map((id) => new Types.ObjectId(id)) ?? [],
            tags: body.audience?.tags ?? [],
          },
          schedule: body.schedule ?? {},
          homoglyphs: hg
            ? {
                enabled: Boolean(hg.enabled),
                probability:
                  typeof hg.probability === 'number'
                    ? Math.min(1, Math.max(0, hg.probability))
                    : undefined,
              }
            : undefined,
          status: 'draft',
        });
      });

      r.post('/campaigns/:id/start', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        await startCampaign(params.id);
        return { ok: true };
      });
      r.post('/campaigns/:id/pause', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        await pauseCampaign(params.id);
        return { ok: true };
      });
      r.post('/campaigns/:id/resume', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        await resumeCampaign(params.id);
        return { ok: true };
      });

      r.post('/campaigns/:id/verify', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const result = await verifyCampaignDelivery(params.id);
        return result;
      });

      r.get('/campaigns/:id/results', async (req, reply) => {
        const params = validate(reply, idParams, req.params, 'params');
        if (!params) return;
        const campaignId = new Types.ObjectId(params.id);
        const messages = await MessageModel.find({ campaignId })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();
        const toValidObjectIds = (values: unknown[]): Types.ObjectId[] =>
          [...new Set(values.map((v) => (v == null ? '' : String(v))).filter((v) => Types.ObjectId.isValid(v)))].map(
            (id) => new Types.ObjectId(id),
          );
        const contactIds = toValidObjectIds(messages.map((m) => m.contactId));
        const accountIds = toValidObjectIds(messages.map((m) => m.accountId));
        logger.debug(
          { campaignId: params.id, messages: messages.length, contacts: contactIds.length, accounts: accountIds.length },
          'campaign results: loaded linked entities',
        );
        const [contacts, accounts] = await Promise.all([
          ContactModel.find({ _id: { $in: contactIds } }).select('_id phoneE164 username firstName lastName').lean(),
          AccountModel.find({ _id: { $in: accountIds } }).select('_id phone telegramUsername label').lean(),
        ]);
        const contactMap = new Map(contacts.map((c) => [String(c._id), c]));
        const accountMap = new Map(accounts.map((a) => [String(a._id), a]));
        const summary: Record<string, number> = {};
        for (const m of messages) {
          summary[m.status] = (summary[m.status] ?? 0) + 1;
        }
        return {
          campaignId: params.id,
          total: messages.length,
          summary,
          items: messages.map((m) => {
            const c = contactMap.get(String(m.contactId));
            const a = m.accountId ? accountMap.get(String(m.accountId)) : null;
            return {
              id: String(m._id),
              status: m.status,
              contact: c
                ? {
                    id: String(c._id),
                    phone: c.phoneE164 || '',
                    username: c.username || '',
                    name: [c.firstName || '', c.lastName || ''].filter(Boolean).join(' '),
                  }
                : null,
              account: a
                ? {
                    id: String(a._id),
                    phone: a.phone,
                    username: a.telegramUsername || '',
                    label: a.label || '',
                  }
                : null,
              peerId: m.peerId || '',
              error: m.error ?? { code: '', message: '' },
              attempts: m.attempts ?? 0,
              text: m.renderedText || '',
              sentAt: m.sentAt ?? null,
              createdAt: m.createdAt,
            };
          }),
        };
      });

      r.get('/messages', async (req, reply) => {
        const q = validate(reply, messagesQuery, req.query ?? {}, 'query');
        if (!q) return;
        const filter: Record<string, unknown> = {};
        if (q.campaignId) filter.campaignId = new Types.ObjectId(q.campaignId);
        if (q.accountId) filter.accountId = new Types.ObjectId(q.accountId);
        if (q.contactId) filter.contactId = new Types.ObjectId(q.contactId);
        if (q.status) filter.status = q.status;
        const wantsPaginated = q.paginated || q.skip > 0;
        if (!wantsPaginated) {
          return MessageModel.find(filter)
            .sort({ createdAt: -1 })
            .limit(q.limit)
            .lean();
        }
        const [items, total] = await Promise.all([
          MessageModel.find(filter).sort({ createdAt: -1 }).skip(q.skip).limit(q.limit).lean(),
          MessageModel.countDocuments(filter),
        ]);
        return { items, total, limit: q.limit, skip: q.skip };
      });

      r.get('/inbound-replies', async (req, reply) => {
        const q = validate(reply, inboundRepliesQuery, req.query ?? {}, 'query');
        if (!q) return;
        const filter: Record<string, unknown> = {};
        if (q.accountId) filter.accountId = new Types.ObjectId(q.accountId);
        if (q.contactId) filter.contactId = new Types.ObjectId(q.contactId);
        const wantsPaginated = q.paginated || q.skip > 0;
        if (!wantsPaginated) {
          return InboundReplyModel.find(filter).sort({ telegramDate: -1, createdAt: -1 }).limit(q.limit).lean();
        }
        const [items, total] = await Promise.all([
          InboundReplyModel.find(filter)
            .sort({ telegramDate: -1, createdAt: -1 })
            .skip(q.skip)
            .limit(q.limit)
            .lean(),
          InboundReplyModel.countDocuments(filter),
        ]);
        return { items, total, limit: q.limit, skip: q.skip };
      });
    },
    { prefix: '/api' },
  );

  const board = await buildBoard();
  await app.register(board.registerPlugin(), { prefix: '/admin/queues' });
  /**
   * Pooled queues are closed by the queue pool's own shutdown hook
   * (`queues:close-pool`); no per-instance teardown required here.
   */

  const publicDir = path.join(__dirname, 'public');
  /** Nuxt `nitro.output.dir` is `public/.nuxt-spa`; static assets are in `public/` under that. */
  const nuxtSpaDir = path.join(publicDir, '.nuxt-spa', 'public');
  const staticRoot = fs.existsSync(path.join(nuxtSpaDir, 'index.html')) ? nuxtSpaDir : publicDir;
  if (fs.existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/admin')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html', staticRoot);
    });
  }

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  logger.info({ port: config.API_PORT }, 'api: listening');

  onShutdown('api:fastify', async () => {
    await app.close();
  });
}

main().catch((err) => {
  logger.error({ err }, 'api: fatal');
  process.exit(1);
});
