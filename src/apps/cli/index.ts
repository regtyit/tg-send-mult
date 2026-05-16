#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import { Types } from 'mongoose';
import { config } from '../../config';
import { connectMongo } from '../../db';
import { AccountModel, CampaignModel, ProxyModel, TemplateModel } from '../../db/models';
import { defaultDeviceProfile, type DeviceProfile } from '../../telegram/client';
import {
  interactiveLogin,
  importSessionString,
  importSessionFromMtpExport,
  importSessionFromTdata,
  importAccountFromJsonFile,
  readJsonAccountMetadata,
} from '../../modules/auth/login';
import { connectWithSavedSession } from '../../modules/auth/connect';
import { sendText } from '../../modules/messaging/send';
import {
  parseCsvBuffer,
  parseJsonBuffer,
  importContactsFromRows,
} from '../../modules/contacts/importRows';
import { startCampaign, pauseCampaign, resumeCampaign } from '../../modules/messaging/campaignLifecycle';
import { logger } from '../../logger';
import { resolveAccountSpecifiers } from '../../modules/accounts/resolveAccountSpecifiers';
import { syncInboundRepliesForAccount } from '../../modules/messaging/syncInboundReplies';
import { verifyCampaignDelivery } from '../../modules/messaging/verifyCampaign';
import { testProxy } from '../../modules/proxy/test';
import { ensureContactForTestRecipient } from '../../modules/contacts/testRecipient';
import { tryParseTelegramProxyLink } from '../../telegram/proxyPayload';

const program = new Command();
program.name('tg').description('Telegram bulk sender CLI').version('0.1.0');

function telegramApiOptsFromCli(
  opts: Record<string, unknown>,
): { telegramApiId?: number; telegramApiHash?: string } {
  const rawId = opts.apiId;
  let telegramApiId: number | undefined;
  if (typeof rawId === 'number' && rawId > 0) telegramApiId = rawId;
  else if (typeof rawId === 'string' && rawId.trim()) {
    const n = parseInt(rawId.trim(), 10);
    if (!Number.isNaN(n) && n > 0) telegramApiId = n;
  }
  const telegramApiHash =
    typeof opts.apiHash === 'string' && opts.apiHash.trim() ? opts.apiHash.trim() : undefined;
  return { telegramApiId, telegramApiHash };
}

function deviceProfileOverrideFromOpts(opts: Record<string, unknown>): DeviceProfile | undefined {
  const hasAny =
    typeof opts.deviceModel === 'string' ||
    typeof opts.systemVersion === 'string' ||
    typeof opts.appVersion === 'string' ||
    typeof opts.langCode === 'string' ||
    typeof opts.systemLangCode === 'string';
  if (!hasAny) return undefined;

  const defaults = defaultDeviceProfile();
  return {
    deviceModel: String(opts.deviceModel ?? defaults.deviceModel).trim(),
    systemVersion: String(opts.systemVersion ?? defaults.systemVersion).trim(),
    appVersion: String(opts.appVersion ?? defaults.appVersion).trim(),
    langCode: String(opts.langCode ?? defaults.langCode).trim(),
    systemLangCode: String(opts.systemLangCode ?? defaults.systemLangCode).trim(),
  };
}

async function resolveProxyId(input: unknown): Promise<string | undefined> {
  const fromCli = typeof input === 'string' ? input.trim() : '';
  if (fromCli) return fromCli;
  const fromEnv = String(config.TELEGRAM_PROXY_ID ?? '').trim();
  if (fromEnv) return fromEnv;

  const host = String(config.TG_MTPROXY_HOST ?? '').trim();
  const portRaw = String(config.TG_MTPROXY_PORT ?? '').trim();
  if (!host && !portRaw) return undefined;
  if (!host || !portRaw) {
    throw new Error(
      'Both TG_MTPROXY_HOST and TG_MTPROXY_PORT are required when using MTProxy credentials from .env',
    );
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid TG_MTPROXY_PORT: ${portRaw}`);
  }
  const secret = String(config.TG_MTPROXY_SECRET ?? '').trim();
  const country = String(config.TG_MTPROXY_COUNTRY ?? '')
    .trim()
    .toUpperCase();
  const label = `env-mtproto-${host}:${port}`;

  let proxy = await ProxyModel.findOne({ label });
  if (!proxy) {
    proxy = await ProxyModel.create({
      label,
      type: 'mtproto',
      host,
      port,
      secret,
      country,
    });
  } else {
    const shouldUpdate =
      proxy.type !== 'mtproto' ||
      proxy.host !== host ||
      proxy.port !== port ||
      String(proxy.secret ?? '') !== secret ||
      String(proxy.country ?? '').trim().toUpperCase() !== country;
    if (shouldUpdate) {
      proxy.type = 'mtproto';
      proxy.host = host;
      proxy.port = port;
      proxy.secret = secret;
      proxy.country = country;
      await proxy.save();
    }
  }

  return String(proxy._id);
}

async function requireExplicitProxyIdForTelegramAction(input: unknown, action: string): Promise<string> {
  const proxyId = await resolveProxyId(input);
  if (proxyId) return proxyId;
  throw new Error(
    `MTProxy must be chosen before ${action}. Pass --proxy-id <id> (recommended), or set TELEGRAM_PROXY_ID, or TG_MTPROXY_HOST/TG_MTPROXY_PORT in .env`,
  );
}

async function verifyImportedAccount(
  accountId: Types.ObjectId,
  proxyId: string,
): Promise<{ userId: string; telegramUsername: string }> {
  const acc = await AccountModel.findById(accountId);
  if (!acc) throw new Error('Imported account disappeared before verification');
  const proxy = await ProxyModel.findById(proxyId);
  return connectWithSavedSession(acc, proxy);
}

async function rollbackNewAccountOnVerifyFail(
  phone: string,
  existedBefore: boolean,
  importedId: Types.ObjectId | null,
): Promise<void> {
  if (existedBefore) return;
  if (importedId) {
    await AccountModel.deleteOne({ _id: importedId });
  } else {
    await AccountModel.deleteOne({ phone: phone.trim() });
  }
}

program
  .command('auth')
  .description('Authentication')
  .addCommand(
    new Command('login')
      .description('Interactive MTProto login (phone, code, 2FA)')
      .option('-p, --phone <phone>')
      .option('--proxy-id <id>')
      .option('-l, --label <label>')
      .option('--device-model <value>', 'Telegram device model for this account')
      .option('--system-version <value>', 'Telegram system version for this account')
      .option('--app-version <value>', 'Telegram app version for this account')
      .option('--lang-code <value>', 'Telegram lang code, e.g. en')
      .option('--system-lang-code <value>', 'Telegram system lang code, e.g. en-US')
      .option('--force-sms', 'Request login code via SMS (if in-app code never arrives)')
      .option('--api-id <id>', 'Telegram api_id for this account (else saved account or TG_API_ID in .env)')
      .option('--api-hash <hash>', 'Telegram api_hash (else saved account or TG_API_HASH in .env)')
      .action(async (opts) => {
        await connectMongo();
        const proxyId = await resolveProxyId(opts.proxyId);
        const { telegramApiId, telegramApiHash } = telegramApiOptsFromCli(opts as Record<string, unknown>);
        const acc = await interactiveLogin({
          phone: opts.phone,
          proxyId,
          label: opts.label,
          deviceProfile: deviceProfileOverrideFromOpts(opts),
          forceSMS: !!opts.forceSms,
          telegramApiId,
          telegramApiHash,
        });
        logger.info({ accountId: acc._id.toString(), phone: acc.phone }, 'auth: login saved');
      }),
  )
  .addCommand(
    new Command('import-session')
      .description(
        'Import an existing StringSession.save() value (Telethon/gramJS compatible, usually starts with "1")',
      )
      .requiredOption('-p, --phone <phone>', 'E.164 phone tied to this account in our DB')
      .requiredOption('-s, --session <stringOrFile>', 'Session string or path to a one-line file')
      .option('--proxy-id <id>')
      .option('--device-model <value>', 'Telegram device model for this account')
      .option('--system-version <value>', 'Telegram system version for this account')
      .option('--app-version <value>', 'Telegram app version for this account')
      .option('--lang-code <value>', 'Telegram lang code, e.g. en')
      .option('--system-lang-code <value>', 'Telegram system lang code, e.g. en-US')
      .option('--api-id <id>', 'Telegram api_id for this account')
      .option('--api-hash <hash>', 'Telegram api_hash for this account')
      .action(async (opts) => {
        await connectMongo();
        const proxyId = await requireExplicitProxyIdForTelegramAction(opts.proxyId, 'auth import-session');
        const existedBefore = Boolean(await AccountModel.exists({ phone: String(opts.phone).trim() }));
        let importedId: Types.ObjectId | null = null;
        let raw = opts.session as string;
        if (fs.existsSync(raw)) raw = fs.readFileSync(raw, 'utf8');
        try {
          const acc = await importSessionString(opts.phone, raw.trim(), {
            proxyId,
            deviceProfile: deviceProfileOverrideFromOpts(opts),
            ...telegramApiOptsFromCli(opts as Record<string, unknown>),
          });
          importedId = acc._id;
          const verified = await verifyImportedAccount(acc._id, proxyId);
          logger.info(
            { accountId: acc._id.toString(), userId: verified.userId, telegramUsername: verified.telegramUsername },
            'auth: session imported and verified',
          );
        } catch (e) {
          await rollbackNewAccountOnVerifyFail(opts.phone, existedBefore, importedId);
          throw e;
        }
      }),
  )
  .addCommand(
    new Command('import-tdata')
      .description(
        'Import session from Telegram Desktop tdata: directory (or parent folder containing tdata), or a .zip of that folder. Single account, no local passcode.',
      )
      .requiredOption('-p, --phone <phone>', 'E.164 phone tied to this account in our DB')
      .requiredOption(
        '--tdata <path>',
        'tdata directory, parent directory (e.g. "Telegram Desktop"), or path to a .zip archive',
      )
      .option('--proxy-id <id>')
      .option('--json <path>', 'Optional JSON export to read app/device metadata (app_id/app_hash/device/lang)')
      .option('-l, --label <label>', 'Optional label (defaults to JSON username if --json provided)')
      .option('--device-model <value>', 'Telegram device model for this account')
      .option('--system-version <value>', 'Telegram system version for this account')
      .option('--app-version <value>', 'Telegram app version for this account')
      .option('--lang-code <value>', 'Telegram lang code, e.g. en')
      .option('--system-lang-code <value>', 'Telegram system lang code, e.g. en-US')
      .option('--api-id <id>', 'Telegram api_id for this account')
      .option('--api-hash <hash>', 'Telegram api_hash for this account')
      .action(async (opts) => {
        await connectMongo();
        const proxyId = await requireExplicitProxyIdForTelegramAction(opts.proxyId, 'auth import-tdata');
        const existedBefore = Boolean(await AccountModel.exists({ phone: String(opts.phone).trim() }));
        const jsonMeta =
          typeof opts.json === 'string' && opts.json.trim()
            ? readJsonAccountMetadata(String(opts.json).trim())
            : null;
        const cliDevice = deviceProfileOverrideFromOpts(opts);
        const cliApi = telegramApiOptsFromCli(opts as Record<string, unknown>);
        const mergedApi =
          typeof cliApi.telegramApiId === 'number' && typeof cliApi.telegramApiHash === 'string'
            ? cliApi
            : jsonMeta?.telegramApiId && jsonMeta.telegramApiHash
              ? {
                  telegramApiId: jsonMeta.telegramApiId,
                  telegramApiHash: jsonMeta.telegramApiHash,
                }
              : {};
        const importOpts = {
          label:
            (typeof opts.label === 'string' && opts.label.trim() ? opts.label.trim() : undefined) ??
            jsonMeta?.label,
          deviceProfile: cliDevice ?? jsonMeta?.deviceProfile,
          ...mergedApi,
        };
        let importedId: Types.ObjectId | null = null;
        let acc: Awaited<ReturnType<typeof importSessionFromTdata>> | null = null;
        try {
          acc = await importSessionFromTdata(opts.phone, opts.tdata, {
            proxyId,
            ...importOpts,
          });
          importedId = acc._id;
        } catch (e) {
          await rollbackNewAccountOnVerifyFail(opts.phone, existedBefore, importedId);
          throw e;
        }
        logger.info(
          {
            accountId: acc._id.toString(),
            phone: acc.phone,
            metadataSource: jsonMeta ? 'tdata+json' : 'tdata',
            hasPerAccountApi: Boolean(acc.telegramApiId && acc.telegramApiHash),
          },
          'auth: tdata imported and verified',
        );
      }),
  )
  .addCommand(
    new Command('import-json')
      .description(
        'Import account/session from JSON (device/sdk/lang/session_file; app_id & app_hash → telegramApiId/Hash).',
      )
      .requiredOption('--json <path>', 'Path to JSON file')
      .option('-p, --phone <phone>', 'Overrides phone from JSON')
      .option('--proxy-id <id>')
      .option('-l, --label <label>')
      .option('--device-model <value>', 'Telegram device model for this account')
      .option('--system-version <value>', 'Telegram system version for this account')
      .option('--app-version <value>', 'Telegram app version for this account')
      .option('--lang-code <value>', 'Telegram lang code, e.g. en')
      .option('--system-lang-code <value>', 'Telegram system lang code, e.g. en-US')
      .option('--api-id <id>', 'Override Telegram api_id from JSON')
      .option('--api-hash <hash>', 'Override Telegram api_hash from JSON')
      .action(async (opts) => {
        await connectMongo();
        const proxyId = await resolveProxyId(opts.proxyId);
        const acc = await importAccountFromJsonFile(opts.json, {
          phone: opts.phone,
          proxyId,
          label: opts.label,
          deviceProfile: deviceProfileOverrideFromOpts(opts),
          ...telegramApiOptsFromCli(opts as Record<string, unknown>),
        });
        logger.info({ accountId: acc._id.toString(), phone: acc.phone }, 'auth: json imported');
      }),
  )
  .addCommand(
    new Command('import-mtp')
      .description(
        'Import from exported MTProto fields: phone, DC id, auth key (hex). Optional user id checks the session after save.',
      )
      .requiredOption('-p, --phone <phone>')
      .requiredOption('--dc <n>', 'Data center id (1–5 for production)', (v) => parseInt(v, 10))
      .requiredOption('--auth-key-hex <hex>', '256-byte auth key as hex (512 chars)')
      .option('--user-id <id>', 'If set, connect once and require getMe().id to match')
      .option('--host <host>', 'Override DC host (default table for --dc)')
      .option('--port <n>', 'Override port (default 443)', (v) => parseInt(v, 10))
      .option('--proxy-id <id>')
      .option('--device-model <value>', 'Telegram device model for this account')
      .option('--system-version <value>', 'Telegram system version for this account')
      .option('--app-version <value>', 'Telegram app version for this account')
      .option('--lang-code <value>', 'Telegram lang code, e.g. en')
      .option('--system-lang-code <value>', 'Telegram system lang code, e.g. en-US')
      .option('--api-id <id>', 'Telegram api_id for this account')
      .option('--api-hash <hash>', 'Telegram api_hash for this account')
      .action(async (opts) => {
        await connectMongo();
        const proxyId = await requireExplicitProxyIdForTelegramAction(opts.proxyId, 'auth import-mtp');
        const existedBefore = Boolean(await AccountModel.exists({ phone: String(opts.phone).trim() }));
        let importedId: Types.ObjectId | null = null;
        try {
          const acc = await importSessionFromMtpExport(
            {
              phone: opts.phone,
              dcId: opts.dc,
              authKeyHex: opts.authKeyHex,
              expectedUserId: opts.userId,
              serverHost: opts.host,
              serverPort: opts.port,
            },
            {
              proxyId,
              deviceProfile: deviceProfileOverrideFromOpts(opts),
              ...telegramApiOptsFromCli(opts as Record<string, unknown>),
            },
          );
          importedId = acc._id;
          const verified = await verifyImportedAccount(acc._id, proxyId);
          logger.info(
            { accountId: acc._id.toString(), userId: verified.userId, telegramUsername: verified.telegramUsername },
            'auth: MTProto export imported and verified',
          );
        } catch (e) {
          await rollbackNewAccountOnVerifyFail(opts.phone, existedBefore, importedId);
          throw e;
        }
      }),
  );

program
  .command('proxies')
  .description('Manage proxies')
  .addCommand(
    new Command('add-mtproto')
      .requiredOption('--host <host>')
      .requiredOption('--port <port>', 'MTProxy port', (v) => parseInt(v, 10))
      .option('--secret <secret>', 'MTProxy secret (optional)', '')
      .option('--country <iso2>', 'Exit country (ISO2, e.g. US)', '')
      .option('--label <label>')
      .action(async (opts) => {
        await connectMongo();
        let host = String(opts.host).trim();
        let port = Number(opts.port);
        let secret = String(opts.secret ?? '').trim();

        const fromHost = tryParseTelegramProxyLink(host);
        if (fromHost) {
          host = fromHost.host;
          port = fromHost.port;
          if (!secret) secret = fromHost.secret;
        }
        const fromSecret = tryParseTelegramProxyLink(secret);
        if (fromSecret) {
          host = fromSecret.host;
          port = fromSecret.port;
          secret = fromSecret.secret;
        }

        const country = String(opts.country ?? '')
          .trim()
          .toUpperCase();
        const label = String(opts.label ?? `mtproto-${host}:${port}`).trim();
        const doc = await ProxyModel.create({
          label,
          type: 'mtproto',
          host,
          port,
          secret,
          country,
        });
        logger.info({ proxyId: doc._id.toString(), label: doc.label }, 'proxies: mtproto created');
      }),
  )
  .addCommand(
    new Command('list').action(async () => {
      await connectMongo();
      const list = await ProxyModel.find().sort({ createdAt: -1 }).lean();
      console.table(
        list.map((p) => ({
          id: p._id.toString(),
          label: p.label,
          type: p.type,
          host: p.host,
          port: p.port,
          country: p.country ?? '',
          secret: p.secret ?? '',
        })),
      );
    }),
  )
  .addCommand(
    new Command('test')
      .description('Verify a proxy actually reaches Telegram (uses Telethon with empty session)')
      .argument('[id]', 'Proxy id (omit to test every MTProxy in the database)')
      .option('--timeout <ms>', 'Per-proxy timeout in ms', (v) => Number.parseInt(v, 10), 25_000)
      .action(async (id: string | undefined, opts: { timeout: number }) => {
        await connectMongo();
        const docs = id
          ? await ProxyModel.find({ _id: id })
          : await ProxyModel.find({ type: 'mtproto' }).sort({ createdAt: -1 });
        if (!docs.length) {
          logger.warn({ id }, 'proxies: no proxy matched');
          return;
        }
        const rows: Array<{
          id: string;
          label: string;
          host: string;
          port: number;
          ok: boolean;
          stage: string;
          ms: number;
          code: string;
          message: string;
        }> = [];
        for (const proxy of docs) {
          const result = await testProxy(proxy, { timeoutMs: opts.timeout });
          rows.push({
            id: proxy._id.toString(),
            label: proxy.label,
            host: proxy.host,
            port: proxy.port,
            ok: result.ok,
            stage: result.stage,
            ms: result.durationMs,
            code: result.code ?? '',
            message: result.message.slice(0, 80),
          });
        }
        console.table(rows);
        const reachable = rows.filter((r) => r.ok).length;
        logger.info({ reachable, total: rows.length }, 'proxies: test summary');
      }),
  );

program
  .command('accounts')
  .description('Manage accounts')
  .addCommand(
    new Command('list').action(async () => {
      await connectMongo();
      const list = await AccountModel.find().sort({ createdAt: -1 }).lean();
      console.table(
        list.map((a) => ({
          id: a._id.toString(),
          phone: a.phone,
          status: a.status,
          health: a.healthScore?.toFixed?.(2) ?? a.healthScore,
        })),
      );
    }),
  )
  .addCommand(
    new Command('pause')
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        await AccountModel.findByIdAndUpdate(id, { $set: { status: 'paused' } });
        logger.info({ id }, 'accounts: paused');
      }),
  )
  .addCommand(
    new Command('resume')
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        await AccountModel.findByIdAndUpdate(id, { $set: { status: 'active' } });
        logger.info({ id }, 'accounts: resumed');
      }),
  )
  .addCommand(
    new Command('set-role')
      .description('Mark an account as sender (default) or test_recipient (used for delivery verification)')
      .argument('<id>')
      .argument('<role>', 'sender | test_recipient')
      .action(async (id, role) => {
        await connectMongo();
        if (role !== 'sender' && role !== 'test_recipient') {
          throw new Error('role must be "sender" or "test_recipient"');
        }
        const updated = await AccountModel.findByIdAndUpdate(id, { $set: { role } }, { new: true });
        if (!updated) {
          throw new Error(`Account not found: ${id}`);
        }
        if (role === 'test_recipient') {
          await ensureContactForTestRecipient(updated);
        }
        logger.info({ id, role }, 'accounts: role updated');
      }),
  )
  .addCommand(
    new Command('sync-test-recipients')
      .description('Ensure every test_recipient account exists in contacts with tag test_recipient')
      .action(async () => {
        await connectMongo();
        const accounts = await AccountModel.find({ role: 'test_recipient' }).select(
          '_id phone telegramUsername role',
        );
        const rows: Array<{ id: string; phone: string; upserted: string; reason: string }> = [];
        for (const acc of accounts) {
          const r = await ensureContactForTestRecipient(acc);
          rows.push({
            id: String(acc._id),
            phone: acc.phone,
            upserted: r.upserted ? 'yes' : 'no',
            reason: r.reason ?? '',
          });
        }
        console.table(rows);
        logger.info({ total: rows.length, upserted: rows.filter((r) => r.upserted === 'yes').length }, 'accounts: sync-test-recipients done');
      }),
  )
  .addCommand(
    new Command('sync-inbox')
      .description('Force-sync incoming dialog replies for sender accounts')
      .option('--accounts <refs>', 'Comma-separated account refs (id, +phone, @username). Default: all')
      .action(async (opts) => {
        await connectMongo();
        const refs = String(opts.accounts ?? '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const ids = refs.length
          ? (await resolveAccountSpecifiers(refs)).ids
          : (await AccountModel.find().select('_id').lean()).map((a) => new Types.ObjectId(String(a._id)));
        const rows: Array<Record<string, string | number>> = [];
        for (const id of ids) {
          const acc = await AccountModel.findById(id);
          if (!acc) continue;
          const proxy = acc.proxyId ? await ProxyModel.findById(acc.proxyId) : null;
          try {
            const { saved, scanned, markedRead } = await syncInboundRepliesForAccount(
              acc,
              proxy,
              { markRead: true },
            );
            rows.push({
              id: acc._id.toString(),
              phone: acc.phone,
              status: 'ok',
              saved,
              scanned,
              markedRead,
            });
          } catch (err) {
            rows.push({
              id: acc._id.toString(),
              phone: acc.phone,
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        console.table(rows);
      }),
  )
  .addCommand(
    new Command('verify-login')
      .description('Check that sender accounts have valid Telegram sessions')
      .option('--accounts <refs>', 'Comma-separated account refs (id, +phone, @username). Default: all')
      .action(async (opts) => {
        await connectMongo();
        const refs = String(opts.accounts ?? '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const ids = refs.length
          ? (await resolveAccountSpecifiers(refs)).ids
          : (await AccountModel.find().select('_id').lean()).map((a) => new Types.ObjectId(String(a._id)));

        const rows: Array<Record<string, string>> = [];
        for (const id of ids) {
          const acc = await AccountModel.findById(id);
          if (!acc) continue;
          if (!acc.sessionEnc) {
            rows.push({
              id: acc._id.toString(),
              phone: acc.phone,
              status: acc.status,
              login: 'no_session',
              detail: 'Run auth login/import to attach session',
            });
            continue;
          }
          const proxyRef = acc.proxyId ? String(acc.proxyId) : '';
          const proxy = proxyRef ? await ProxyModel.findById(proxyRef) : null;
          try {
            const { userId } = await connectWithSavedSession(acc, proxy);
            rows.push({
              id: acc._id.toString(),
              phone: acc.phone,
              status: acc.status,
              login: 'ok',
              detail: `userId=${userId}`,
            });
          } catch (err) {
            rows.push({
              id: acc._id.toString(),
              phone: acc.phone,
              status: acc.status,
              login: 'failed',
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }
        console.table(rows);
      }),
  );

program
  .command('send-test')
  .description('Send a test message')
  .requiredOption('-a, --account <ref>', 'Sender account id, phone, or @telegram_username')
  .option('--proxy-id <id>', 'Override account proxy id (or use TELEGRAM_PROXY_ID from .env)')
  .requiredOption(
    '-t, --to <peer>',
    'me | +E164 | username | https://t.me/username | numeric user id',
  )
  .requiredOption('-m, --text <text>')
  .action(async (opts) => {
    await connectMongo();
    const resolved = await resolveAccountSpecifiers([String(opts.account)]);
    if (!resolved.ids.length) {
      throw new Error(
        `Could not resolve sender account "${opts.account}". Use account id, +E164 phone, or @telegram_username.`,
      );
    }
    if (resolved.ids.length > 1) {
      throw new Error(`Account reference "${opts.account}" matched multiple accounts`);
    }
    const overrideProxyId = await resolveProxyId(opts.proxyId);
    const acc = await AccountModel.findById(resolved.ids[0]);
    if (!acc) throw new Error('Account not found');
    if (!acc.sessionEnc) {
      throw new Error(
        `Account ${acc.phone} has no saved session. Run "npm run cli -- auth login --phone ${acc.phone}" or import session first.`,
      );
    }
    const proxyRef = overrideProxyId ?? (acc.proxyId ? String(acc.proxyId) : '');
    const proxy = proxyRef ? await ProxyModel.findById(proxyRef) : null;
    await connectWithSavedSession(acc, proxy);
    await sendText(acc, proxy, opts.to, opts.text);
    logger.info('send-test: ok');
  });

program
  .command('contacts')
  .description('Contacts')
  .addCommand(
    new Command('import')
      .argument('<file>', 'CSV or JSON file')
      .option('--country <iso>', 'Default country for parsing')
      .option('--tags <tags>', 'Comma-separated tags', '')
      .action(async (file, opts) => {
        await connectMongo();
        const buf = fs.readFileSync(file);
        const rows = file.endsWith('.json') ? parseJsonBuffer(buf) : parseCsvBuffer(buf);
        const tags = opts.tags ? String(opts.tags).split(',').map((t: string) => t.trim()) : [];
        const res = await importContactsFromRows(rows, {
          defaultCountry: opts.country,
          tags,
          source: file,
        });
        logger.info(res, 'contacts: import done');
      }),
  );

program
  .command('templates')
  .description('Templates')
  .addCommand(
    new Command('create')
      .requiredOption('-n, --name <name>')
      .requiredOption('-b, --body <body>')
      .action(async (opts) => {
        await connectMongo();
        const t = await TemplateModel.create({ name: opts.name, body: opts.body });
        logger.info({ id: t._id.toString() }, 'templates: created');
      }),
  );

program
  .command('campaign')
  .description('Campaigns')
  .addCommand(
    new Command('create')
      .requiredOption('-n, --name <name>')
      .requiredOption('--template <templateId>')
      .requiredOption('--accounts <ids>', 'Comma-separated account ids')
      .option('--tags <tags>', 'Audience tags (comma-separated)')
      .option('--homoglyphs', 'Random Latin→Cyrillic lookalike letters in rendered text')
      .option(
        '--homoglyph-probability <n>',
        'Per-letter chance 0..1 (default 0.35)',
        (v) => parseFloat(String(v)),
        0.35,
      )
      .action(async (opts) => {
        await connectMongo();
        const accountPool = String(opts.accounts)
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((id: string) => new Types.ObjectId(id));
        const tags = opts.tags
          ? String(opts.tags)
              .split(',')
              .map((t: string) => t.trim())
              .filter(Boolean)
          : [];
        const homoglyphs =
          opts.homoglyphs === true
            ? {
                enabled: true,
                probability: Math.min(1, Math.max(0, Number(opts.homoglyphProbability) || 0.35)),
              }
            : undefined;
        const c = await CampaignModel.create({
          name: opts.name,
          templateId: new Types.ObjectId(opts.template),
          accountPool,
          audience: { tags, contactIds: [] },
          homoglyphs,
          status: 'draft',
        });
        logger.info({ id: c._id.toString() }, 'campaign: created');
      }),
  )
  .addCommand(
    new Command('start')
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        await startCampaign(id);
        logger.info({ id }, 'campaign: started');
      }),
  )
  .addCommand(
    new Command('pause')
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        await pauseCampaign(id);
      }),
  )
  .addCommand(
    new Command('resume')
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        await resumeCampaign(id);
      }),
  )
  .addCommand(
    new Command('verify')
      .description(
        'Force-sync test_recipient inboxes and verify which campaign messages actually arrived',
      )
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        const r = await verifyCampaignDelivery(id);
        console.log(
          JSON.stringify(
            {
              campaignId: r.campaignId,
              totalSent: r.totalSent,
              testRecipients: r.testRecipients,
              observable: r.observable,
              verified: r.verified,
              missing: r.missing,
            },
            null,
            2,
          ),
        );
        if (r.details.length) {
          console.table(
            r.details.map((d) => ({
              messageId: d.messageId,
              phone: d.contactPhone,
              status: d.status,
              testAccount: d.testAccountId ?? '',
              reason: d.reason ?? '',
            })),
          );
        }
      }),
  )
  .addCommand(
    new Command('stats')
      .argument('<id>')
      .action(async (id) => {
        await connectMongo();
        const c = await CampaignModel.findById(id).lean();
        console.log(JSON.stringify(c?.stats, null, 2));
      }),
  );

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'cli: error');
  process.exit(1);
});
