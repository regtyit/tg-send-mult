import { Command } from 'commander';
import { Types } from 'mongoose';
import fs from 'fs';
import { connectMongo } from '../../db';
import {
  CampaignModel,
  ContactModel,
  DialogScriptModel,
  DialogSessionModel,
  TemplateModel,
} from '../../db/models';
import { deleteCampaign } from '../../modules/messaging/deleteCampaign';
import { pauseCampaign, resumeCampaign, startCampaign } from '../../modules/messaging/campaignLifecycle';
import { verifyCampaignDelivery } from '../../modules/messaging/verifyCampaign';
import { runDialogSessionsBatch } from '../../modules/dialog/batchTick';
import { continueDialogSession } from '../../modules/dialog/continueSession';
import { executeDialogTurn } from '../../modules/dialog/executeTurn';
import {
  parseDialogTurnsFromCsv,
  parseDialogTurnsFromJson,
} from '../../modules/dialog/importScript';
import { totalTurnsForScript } from '../../modules/dialog/planTurn';
import {
  HUMAN_DIALOG_PRESETS,
  filterHumanDialogPresets,
  getHumanDialogPreset,
  humanDialogPresetDetail,
  humanDialogPresetSummary,
  upsertAllHumanDialogPresets,
  upsertHumanDialogPreset,
} from '../../modules/dialog/humanDialogTemplates';
import { resolveAccountSpecifiers } from '../../modules/accounts/resolveAccountSpecifiers';
import { getWarmingStartHintsForSession } from '../../modules/accounts/warming';
import { planWarmupDialogPairs, runWarmupOrchestrator, warmingFleetSummary } from '../../modules/dialog/warmupOrchestrator';
import { logger } from '../../logger';

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  let idx = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) break;
        await fn(items[i]!);
      }
    }),
  );
}

export function registerDialogCommands(program: Command): void {
  const dialog = program.command('dialog').description('Dialog scripts and auto-chat sessions');

  dialog
    .command('tick')
    .description('Run one batch tick for all due auto dialog sessions (scheduler uses this)')
    .option('--limit <n>', 'Max sessions to scan', (v) => parseInt(String(v), 10))
    .option('--concurrency <n>', 'Parallel sessions per tick', (v) => parseInt(String(v), 10))
    .option('--dry-run', 'List due sessions without executing')
    .action(async (opts) => {
      await connectMongo();
      const r = await runDialogSessionsBatch({
        limit: Number.isFinite(opts.limit) ? opts.limit : undefined,
        concurrency: Number.isFinite(opts.concurrency) ? opts.concurrency : undefined,
        dryRun: Boolean(opts.dryRun),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  const scripts = dialog.command('scripts').description('Dialog scripts');

  scripts
    .command('list')
    .description('List saved dialog scripts')
    .action(async () => {
      await connectMongo();
      const rows = await DialogScriptModel.find().sort({ updatedAt: -1 }).limit(500).lean();
      console.table(
        rows.map((s) => ({
          id: String(s._id),
          name: s.name,
          mode: s.mode,
          turns: s.mode === 'turns' ? (s.turns?.length ?? 0) : (s.rounds ?? 1) * 2,
        })),
      );
    });

  scripts
    .command('show <id>')
    .description('Show one script (turns, delays, notes)')
    .action(async (id) => {
      await connectMongo();
      const s = await DialogScriptModel.findById(id).lean();
      if (!s) throw new Error('Script not found');
      console.log(JSON.stringify(s, null, 2));
    });

  const presets = scripts.command('presets').description('Built-in human-style dialog templates');

  presets
    .command('list')
    .description('List built-in presets (not yet in DB until applied)')
    .option('--lang <code>', 'Filter: en or ru')
    .option('--category <cat>', 'Filter: social, work, support, logistics')
    .action((opts) => {
      const list = filterHumanDialogPresets({
        lang: opts.lang ? String(opts.lang) : undefined,
        category: opts.category ? String(opts.category) : undefined,
      });
      console.table(list.map((p, i) => humanDialogPresetSummary(p, i)));
    });

  presets
    .command('show <slug>')
    .description('Show full preset (all turns)')
    .action((slug) => {
      const p = getHumanDialogPreset(String(slug));
      if (!p) throw new Error(`Unknown preset: ${slug}`);
      console.log(JSON.stringify(humanDialogPresetDetail(p), null, 2));
    });

  presets
    .command('apply <slug>')
    .description('Create or skip preset script in MongoDB')
    .option('--replace', 'Overwrite existing script with the same name')
    .action(async (slug, opts) => {
      await connectMongo();
      const r = await upsertHumanDialogPreset(String(slug), Boolean(opts.replace));
      console.log(JSON.stringify(r, null, 2));
    });

  presets
    .command('apply-all')
    .description('Apply all built-in presets to MongoDB')
    .option('--replace', 'Overwrite scripts that share preset names')
    .action(async (opts) => {
      await connectMongo();
      const results = await upsertAllHumanDialogPresets(Boolean(opts.replace));
      console.table(results);
      logger.info({ count: results.length }, 'dialog: presets applied');
    });

  scripts
    .command('create')
    .description('Create a turns script from the command line')
    .requiredOption('-n, --name <name>')
    .option('--json <file>', 'JSON array of turns: side, text, delaySecMin, delaySecMax, waitForText')
    .option('--delay-min <sec>', 'Default delay min', (v) => parseInt(String(v), 10), 30)
    .option('--delay-max <sec>', 'Default delay max', (v) => parseInt(String(v), 10), 90)
    .option('--typing-sec <sec>', 'Typing indicator seconds', (v) => parseInt(String(v), 10), 3)
    .action(async (opts) => {
      await connectMongo();
      if (!opts.json) throw new Error('Provide --json <file> with turn rows');
      const turns = parseDialogTurnsFromJson(fs.readFileSync(opts.json, 'utf8'));
      if (!turns.length) throw new Error('No valid turns in JSON');
      const doc = await DialogScriptModel.create({
        name: opts.name,
        mode: 'turns',
        turns: turns.map((t) => ({
          side: t.side,
          text: t.text,
          ...(t.templateId ? { templateId: new Types.ObjectId(t.templateId) } : {}),
          ...(t.waitForText ? { waitForText: t.waitForText } : {}),
          delaySecMin: t.delaySecMin ?? opts.delayMin ?? 30,
          delaySecMax: t.delaySecMax ?? opts.delayMax ?? 90,
        })),
        defaultDelaySecMin: opts.delayMin ?? 30,
        defaultDelaySecMax: opts.delayMax ?? 90,
        typingSec: opts.typingSec ?? 3,
      });
      logger.info({ id: doc._id.toString(), turns: turns.length }, 'dialog: script created');
    });

  scripts
    .command('delete <id>')
    .description('Delete a dialog script')
    .action(async (id) => {
      await connectMongo();
      const res = await DialogScriptModel.deleteOne({ _id: new Types.ObjectId(id) });
      if (!res.deletedCount) throw new Error('Script not found');
      logger.info({ id }, 'dialog: script deleted');
    });

  scripts
    .command('import')
    .requiredOption('-n, --name <name>')
    .option('--csv <file>')
    .option('--json <file>')
    .action(async (opts) => {
      await connectMongo();
      const turns = opts.csv
        ? parseDialogTurnsFromCsv(fs.readFileSync(opts.csv, 'utf8'))
        : opts.json
          ? parseDialogTurnsFromJson(fs.readFileSync(opts.json, 'utf8'))
          : [];
      if (!turns.length) throw new Error('No valid turns in file');
      const doc = await DialogScriptModel.create({
        name: opts.name,
        mode: 'turns',
        turns: turns.map((t) => ({
          side: t.side,
          text: t.text,
          ...(t.templateId ? { templateId: new Types.ObjectId(t.templateId) } : {}),
          ...(t.waitForText ? { waitForText: t.waitForText } : {}),
          delaySecMin: t.delaySecMin ?? 30,
          delaySecMax: t.delaySecMax ?? 90,
        })),
      });
      logger.info({ id: doc._id.toString(), turns: turns.length }, 'dialog: script imported');
    });

  const sessions = dialog.command('sessions').description('Dialog sessions');

  sessions
    .command('list')
    .description('List dialog sessions')
    .option('--status <status>', 'Filter by status (draft,running,waiting_peer,...)')
    .option('--limit <n>', 'Max rows', (v) => parseInt(String(v), 10), 100)
    .action(async (opts) => {
      await connectMongo();
      const filter: Record<string, unknown> = {};
      if (opts.status) filter.status = String(opts.status);
      const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
      const rows = await DialogSessionModel.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      console.table(
        rows.map((s) => ({
          id: String(s._id),
          name: s.name || '',
          status: s.status,
          runMode: s.runMode,
          turn: s.currentTurn,
          accountA: String(s.accountAId),
        })),
      );
      const total = await DialogSessionModel.countDocuments(filter);
      console.log(`Showing ${rows.length} of ${total} session(s).`);
    });

  sessions
    .command('create')
    .description('Create a dialog session')
    .option('--script <id>', 'Saved dialog script id')
    .option('--preset <slug>', 'Built-in human dialog template slug')
    .requiredOption('--account-a <ref>', 'Sender A: id, +phone, or @username')
    .option('--peer-account <ref>', 'Peer account (account peer)')
    .option('--peer-contact <id>', 'Peer contact id')
    .option('--name <name>', 'Session label')
    .option('--run-mode <mode>', 'auto or manual', 'manual')
    .action(async (opts) => {
      await connectMongo();
      const a = await resolveAccountSpecifiers([String(opts.accountA)]);
      if (!a.ids.length) throw new Error('account-a not found');

      let peerType: 'account' | 'contact' = 'contact';
      let peerAccountId: Types.ObjectId | null = null;
      let peerContactId: Types.ObjectId | null = null;

      if (opts.peerAccount) {
        peerType = 'account';
        const p = await resolveAccountSpecifiers([String(opts.peerAccount)]);
        if (!p.ids.length) throw new Error('peer-account not found');
        peerAccountId = p.ids[0]!;
      } else if (opts.peerContact) {
        const c = await ContactModel.findById(opts.peerContact);
        if (!c) throw new Error('peer-contact not found');
        peerContactId = c._id;
      } else {
        throw new Error('Provide --peer-account or --peer-contact');
      }

      let scriptId: Types.ObjectId | undefined;
      if (opts.preset) {
        const applied = await upsertHumanDialogPreset(String(opts.preset), false);
        scriptId = new Types.ObjectId(applied.id);
      } else if (opts.script) {
        scriptId = new Types.ObjectId(String(opts.script));
      } else {
        throw new Error('Provide --script <id> or --preset <slug>');
      }

      const script = await DialogScriptModel.findById(scriptId);
      if (!script) throw new Error('script not found');

      const doc = await DialogSessionModel.create({
        name: opts.name ?? '',
        scriptId: script._id,
        accountAId: a.ids[0],
        peerType,
        peerAccountId,
        peerContactId,
        runMode: opts.runMode === 'auto' ? 'auto' : 'manual',
        status: 'draft',
      });
      logger.info({ id: doc._id.toString() }, 'dialog: session created');
    });

  sessions
    .command('start <id>')
    .description('Start session (auto mode continues in background via tick/worker)')
    .action(async (id) => {
      await connectMongo();
      const session = await DialogSessionModel.findById(id);
      if (!session) throw new Error('Session not found');
      const script = await DialogScriptModel.findById(session.scriptId);
      if (!script || totalTurnsForScript(script) === 0) throw new Error('Script has no turns');

      const warmingHints = await getWarmingStartHintsForSession(session);
      if (warmingHints.length) {
        logger.info({ warmingHints }, 'dialog: warm-up hints (not blocking)');
      }

      await DialogSessionModel.updateOne(
        { _id: session._id },
        {
          $set: {
            status: 'running',
            currentTurn: 0,
            waitCursorAt: null,
            processingLockUntil: null,
            lastError: '',
            completedAt: null,
            nextRunAt: session.runMode === 'auto' ? new Date() : null,
          },
        },
      );

      if (session.runMode === 'auto') {
        await continueDialogSession(id);
      }
      logger.info({ id, runMode: session.runMode }, 'dialog: session started');
    });

  sessions
    .command('bulk-start')
    .description('Start many draft sessions (for large fleets)')
    .option('--status <status>', 'Only sessions with this status', 'draft')
    .option('--run-mode <mode>', 'Only sessions with this run mode', 'auto')
    .option('--limit <n>', 'Max sessions', (v) => parseInt(String(v), 10), 500)
    .option('--concurrency <n>', 'Parallel starts', (v) => parseInt(String(v), 10), 20)
    .action(async (opts) => {
      await connectMongo();
      const rows = await DialogSessionModel.find({
        status: String(opts.status),
        runMode: String(opts.runMode),
      })
        .sort({ createdAt: 1 })
        .limit(Number.isFinite(opts.limit) ? opts.limit : 500)
        .select('_id')
        .lean();

      let started = 0;
      let failed = 0;
      await mapPool(rows, opts.concurrency, async (row) => {
        try {
          const id = String(row._id);
          const session = await DialogSessionModel.findById(id);
          if (!session) return;
          const script = await DialogScriptModel.findById(session.scriptId);
          if (!script || totalTurnsForScript(script) === 0) return;

          await DialogSessionModel.updateOne(
            { _id: session._id },
            {
              $set: {
                status: 'running',
                currentTurn: 0,
                waitCursorAt: null,
                processingLockUntil: null,
                nextRunAt: new Date(),
              },
            },
          );
          await continueDialogSession(id);
          started += 1;
        } catch {
          failed += 1;
        }
      });

      console.log(JSON.stringify({ candidates: rows.length, started, failed }, null, 2));
    });

  sessions
    .command('show <id>')
    .description('Show session document')
    .action(async (id) => {
      await connectMongo();
      const s = await DialogSessionModel.findById(id).lean();
      if (!s) throw new Error('Session not found');
      console.log(JSON.stringify(s, null, 2));
    });

  sessions
    .command('pause <id>')
    .action(async (id) => {
      await connectMongo();
      await DialogSessionModel.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { status: 'paused', nextRunAt: null, processingLockUntil: null } },
      );
      logger.info({ id }, 'dialog: session paused');
    });

  sessions
    .command('step <id>')
    .description('Run exactly one turn (manual ops or debugging)')
    .action(async (id) => {
      await connectMongo();
      const session = await DialogSessionModel.findById(id);
      if (!session) throw new Error('Session not found');
      if (session.status === 'draft') {
        const hints = await getWarmingStartHintsForSession(session);
        if (hints.length) console.warn('Warm-up hints:', JSON.stringify(hints));
        await DialogSessionModel.updateOne({ _id: session._id }, { $set: { status: 'running' } });
      } else if (session.status === 'paused' || session.status === 'waiting_peer') {
        await DialogSessionModel.updateOne({ _id: session._id }, { $set: { status: 'running' } });
      }
      const result = await executeDialogTurn(new Types.ObjectId(id), { forcePeerCheck: true });
      console.log(JSON.stringify(result, null, 2));
      if (session.runMode === 'auto' && !result.done) {
        await continueDialogSession(id);
      }
    });

  sessions
    .command('stats')
    .description('Count sessions by status (fleet overview)')
    .action(async () => {
      await connectMongo();
      const statuses = ['draft', 'running', 'waiting_peer', 'paused', 'completed', 'failed'] as const;
      const rows: Array<{ status: string; count: number }> = [];
      for (const status of statuses) {
        const count = await DialogSessionModel.countDocuments({ status });
        rows.push({ status, count });
      }
      const autoRunning = await DialogSessionModel.countDocuments({
        runMode: 'auto',
        status: { $in: ['running', 'waiting_peer'] },
      });
      console.table(rows);
      console.log(`Auto active (running + waiting_peer): ${autoRunning}`);
    });

  const warmup = dialog.command('warmup').description('Warm-up dialog scheduling and fleet runs');

  warmup
    .command('summary')
    .description('Fleet warm-up readiness overview')
    .action(async () => {
      await connectMongo();
      console.log(JSON.stringify(await warmingFleetSummary(), null, 2));
    });

  warmup
    .command('plan')
    .description('List sender pairs due for a warm-up dialog per schedule')
    .action(async () => {
      await connectMongo();
      const plans = await planWarmupDialogPairs();
      console.table(plans);
      console.log(`${plans.length} pair(s) due`);
    });

  warmup
    .command('run')
    .description('Create and start warm-up dialog sessions for due pairs')
    .option('--dry-run', 'Only show plan')
    .option('--limit <n>', 'Max pairs', (v) => parseInt(String(v), 10), 20)
    .option('--no-start', 'Create drafts only')
    .action(async (opts) => {
      await connectMongo();
      const r = await runWarmupOrchestrator({
        dryRun: Boolean(opts.dryRun),
        limit: Number.isFinite(opts.limit) ? opts.limit : 20,
        autoStart: !opts.noStart,
      });
      console.log(JSON.stringify(r, null, 2));
    });
}

export function registerTemplateCommands(program: Command): void {
  const templates = program.command('templates').description('Message templates');

  templates
    .command('list')
    .description('List templates')
    .action(async () => {
      await connectMongo();
      const rows = await TemplateModel.find().sort({ name: 1 }).lean();
      console.table(rows.map((t) => ({ id: String(t._id), name: t.name, chars: t.body.length })));
    });

  templates
    .command('create')
    .requiredOption('-n, --name <name>')
    .requiredOption('-b, --body <body>')
    .action(async (opts) => {
      await connectMongo();
      const t = await TemplateModel.create({ name: opts.name, body: opts.body });
      logger.info({ id: t._id.toString() }, 'templates: created');
    });

  templates
    .command('delete <id>')
    .description('Delete a template')
    .action(async (id) => {
      await connectMongo();
      const res = await TemplateModel.findByIdAndDelete(id);
      if (!res) throw new Error('Template not found');
      logger.info({ id }, 'templates: deleted');
    });

  templates
    .command('show <id>')
    .action(async (id) => {
      await connectMongo();
      const t = await TemplateModel.findById(id).lean();
      if (!t) throw new Error('Template not found');
      console.log(JSON.stringify(t, null, 2));
    });
}

export function registerCampaignCommands(program: Command): void {
  const campaign = program.command('campaign').description('Campaigns');

  campaign
    .command('list')
    .description('List campaigns')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      await connectMongo();
      const filter: Record<string, unknown> = {};
      if (opts.status) filter.status = String(opts.status);
      const rows = await CampaignModel.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
      console.table(
        rows.map((c) => ({
          id: String(c._id),
          name: c.name,
          status: c.status,
          senders: (c.accountPool ?? []).length,
          tags: (c.audience?.tags ?? []).join(','),
        })),
      );
    });

  campaign
    .command('delete <id>')
    .description('Delete campaign and its queued/sent message rows')
    .action(async (id) => {
      await connectMongo();
      const r = await deleteCampaign(id);
      logger.info({ id, messagesRemoved: r.messagesRemoved }, 'campaign: deleted');
    });

  // existing subcommands stay in index.ts - we'll move create/start etc here or leave duplicated

  campaign
    .command('create')
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
    });

  campaign
    .command('start <id>')
    .action(async (id) => {
      await connectMongo();
      await startCampaign(id);
      logger.info({ id }, 'campaign: started');
    });

  campaign
    .command('pause <id>')
    .action(async (id) => {
      await connectMongo();
      await pauseCampaign(id);
    });

  campaign
    .command('resume <id>')
    .action(async (id) => {
      await connectMongo();
      await resumeCampaign(id);
    });

  campaign
    .command('verify <id>')
    .description('Verify delivery via test_recipient inboxes')
    .action(async (id) => {
      await connectMongo();
      const r = await verifyCampaignDelivery(id);
      console.log(JSON.stringify(r, null, 2));
    });

  campaign
    .command('stats <id>')
    .action(async (id) => {
      await connectMongo();
      const c = await CampaignModel.findById(id).lean();
      console.log(JSON.stringify(c?.stats, null, 2));
    });
}
