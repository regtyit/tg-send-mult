import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import {
  AccountModel,
  ContactModel,
  DialogScriptModel,
  DialogSessionModel,
  DialogTurnModel,
  InboundReplyModel,
} from '../../../db/models';
import { continueDialogSession } from '../../../modules/dialog/continueSession';
import { executeDialogTurn } from '../../../modules/dialog/executeTurn';
import {
  parseDialogTurnsFromCsv,
  parseDialogTurnsFromJson,
} from '../../../modules/dialog/importScript';
import { totalTurnsForScript } from '../../../modules/dialog/planTurn';
import {
  filterHumanDialogPresets,
  getHumanDialogPreset,
  humanDialogPresetDetail,
  humanDialogPresetSummary,
  upsertAllHumanDialogPresets,
  upsertHumanDialogPreset,
} from '../../../modules/dialog/humanDialogTemplates';
import {
  dialogPresetApplyBody,
  dialogPresetSlugParams,
  dialogPresetsQuery,
  dialogScriptCreateBody,
  dialogScriptImportBody,
  dialogSessionCreateBody,
  idParams,
  validate,
} from '../validation';

export async function registerDialogRoutes(r: FastifyInstance): Promise<void> {
  r.get('/dialog-scripts', async () =>
    DialogScriptModel.find().sort({ updatedAt: -1 }).lean(),
  );

  r.get('/dialog-scripts/presets', async (req) => {
    const q = dialogPresetsQuery.safeParse(req.query ?? {});
    const filters = q.success ? q.data : {};
    const list = filterHumanDialogPresets(filters);
    return { presets: list.map(humanDialogPresetSummary) };
  });

  r.get('/dialog-scripts/presets/:slug', async (req, reply) => {
    const params = validate(reply, dialogPresetSlugParams, req.params ?? {}, 'params');
    if (!params) return;
    const preset = getHumanDialogPreset(params.slug);
    if (!preset) return reply.code(404).send({ error: 'preset_not_found' });
    return humanDialogPresetDetail(preset);
  });

  r.post('/dialog-scripts/presets/apply', async (req, reply) => {
    const body = validate(reply, dialogPresetApplyBody, req.body ?? {});
    if (!body) return;
    if (!body.slug?.trim()) {
      return reply.code(400).send({ error: 'slug_required' });
    }
    const applied = await upsertHumanDialogPreset(body.slug.trim(), body.replace);
    const doc = await DialogScriptModel.findById(applied.id).lean();
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    return { ...applied, script: doc };
  });

  r.post('/dialog-scripts/presets/:slug/apply', async (req, reply) => {
    const params = validate(reply, dialogPresetSlugParams, req.params ?? {}, 'params');
    if (!params) return;
    const body = validate(reply, dialogPresetApplyBody, req.body ?? {}) ?? { replace: false };
    const applied = await upsertHumanDialogPreset(params.slug, body.replace ?? false);
    const doc = await DialogScriptModel.findById(applied.id).lean();
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    return { ...applied, script: doc };
  });

  r.post('/dialog-scripts/presets/apply-all', async (req, reply) => {
    const replace = Boolean((req.body as { replace?: boolean } | undefined)?.replace);
    const results = await upsertAllHumanDialogPresets(replace);
    return { results };
  });

  r.post('/dialog-scripts', async (req, reply) => {
    const body = validate(reply, dialogScriptCreateBody, req.body ?? {});
    if (!body) return;
    const doc = await DialogScriptModel.create(body);
    return doc.toObject();
  });

  r.delete('/dialog-scripts/:id', async (req, reply) => {
    const params = validate(reply, idParams, req.params ?? {}, 'params');
    if (!params) return;
    await DialogScriptModel.deleteOne({ _id: new Types.ObjectId(params.id) });
    return { ok: true };
  });

  r.post('/dialog-scripts/import', async (req, reply) => {
    const body = validate(reply, dialogScriptImportBody, req.body ?? {});
    if (!body) return;
    const turns = body.csv
      ? parseDialogTurnsFromCsv(body.csv)
      : body.json
        ? parseDialogTurnsFromJson(body.json)
        : [];
    if (!turns.length) {
      return reply.code(400).send({ error: 'no_valid_turns' });
    }
    const doc = await DialogScriptModel.create({
      name: body.name,
      mode: 'turns',
      turns: turns.map((t) => ({
        side: t.side,
        text: t.text,
        ...(t.templateId ? { templateId: new Types.ObjectId(t.templateId) } : {}),
        ...(t.waitForText ? { waitForText: t.waitForText } : {}),
        delaySecMin: t.delaySecMin ?? body.defaultDelaySecMin ?? 30,
        delaySecMax: t.delaySecMax ?? body.defaultDelaySecMax ?? 90,
      })),
      defaultDelaySecMin: body.defaultDelaySecMin ?? 30,
      defaultDelaySecMax: body.defaultDelaySecMax ?? 90,
      typingSec: body.typingSec ?? 3,
    });
    return doc.toObject();
  });

  r.get('/dialog-sessions', async () =>
    DialogSessionModel.find().sort({ updatedAt: -1 }).limit(200).lean(),
  );

  r.post('/dialog-sessions', async (req, reply) => {
    const body = validate(reply, dialogSessionCreateBody, req.body ?? {});
    if (!body) return;

    const accountA = await AccountModel.findById(body.accountAId);
    if (!accountA) return reply.code(404).send({ error: 'account_a_not_found' });

    if (body.peerType === 'account') {
      if (!body.peerAccountId) {
        return reply.code(400).send({ error: 'peer_account_required' });
      }
      const peer = await AccountModel.findById(body.peerAccountId);
      if (!peer) return reply.code(404).send({ error: 'peer_account_not_found' });
    } else {
      if (!body.peerContactId) {
        return reply.code(400).send({ error: 'peer_contact_required' });
      }
      const contact = await ContactModel.findById(body.peerContactId);
      if (!contact) return reply.code(404).send({ error: 'peer_contact_not_found' });
    }

    let scriptId = body.scriptId;
    if (body.presetSlug) {
      const applied = await upsertHumanDialogPreset(body.presetSlug, false);
      scriptId = applied.id;
    }
    if (!scriptId) {
      return reply.code(400).send({ error: 'script_required' });
    }

    const script = await DialogScriptModel.findById(scriptId);
    if (!script) return reply.code(404).send({ error: 'script_not_found' });

    const doc = await DialogSessionModel.create({
      name: body.name ?? '',
      scriptId,
      accountAId: body.accountAId,
      peerType: body.peerType,
      peerAccountId: body.peerType === 'account' ? body.peerAccountId : null,
      peerContactId: body.peerType === 'contact' ? body.peerContactId : null,
      runMode: body.runMode ?? 'manual',
      status: 'draft',
    });
    return doc.toObject();
  });

  r.post('/dialog-sessions/:id/start', async (req, reply) => {
    const params = validate(reply, idParams, req.params ?? {}, 'params');
    if (!params) return;
    const session = await DialogSessionModel.findById(params.id);
    if (!session) return reply.code(404).send({ error: 'not_found' });

    const script = await DialogScriptModel.findById(session.scriptId);
    if (!script) return reply.code(400).send({ error: 'script_missing' });
    if (totalTurnsForScript(script) === 0) {
      return reply.code(400).send({ error: 'script_has_no_turns' });
    }

    await DialogSessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          status: 'running',
          currentTurn: 0,
          waitCursorAt: null,
          lastError: '',
          completedAt: null,
          nextRunAt: session.runMode === 'auto' ? new Date() : null,
        },
      },
    );

    if (session.runMode === 'auto') {
      void continueDialogSession(params.id).catch(() => {});
    }

    return { ok: true, sessionId: params.id };
  });

  r.post('/dialog-sessions/:id/pause', async (req, reply) => {
    const params = validate(reply, idParams, req.params ?? {}, 'params');
    if (!params) return;
    await DialogSessionModel.updateOne(
      { _id: new Types.ObjectId(params.id) },
      { $set: { status: 'paused', nextRunAt: null } },
    );
    return { ok: true };
  });

  r.post('/dialog-sessions/:id/resume', async (req, reply) => {
    const params = validate(reply, idParams, req.params ?? {}, 'params');
    if (!params) return;
    const session = await DialogSessionModel.findById(params.id);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    await DialogSessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          status: 'running',
          nextRunAt: session.runMode === 'auto' ? new Date() : null,
        },
      },
    );
    if (session.runMode === 'auto') {
      void continueDialogSession(params.id).catch(() => {});
    }
    return { ok: true };
  });

  r.post('/dialog-sessions/:id/step', async (req, reply) => {
    const params = validate(reply, idParams, req.params ?? {}, 'params');
    if (!params) return;
    const session = await DialogSessionModel.findById(params.id);
    if (!session) return reply.code(404).send({ error: 'not_found' });

    if (session.status === 'draft') {
      await DialogSessionModel.updateOne(
        { _id: session._id },
        { $set: { status: 'running', currentTurn: 0 } },
      );
    } else if (
      session.status !== 'running' &&
      session.status !== 'paused' &&
      session.status !== 'waiting_peer'
    ) {
      return reply.code(400).send({ error: 'session_not_active', status: session.status });
    }

    if (session.status === 'paused' || session.status === 'waiting_peer') {
      await DialogSessionModel.updateOne({ _id: session._id }, { $set: { status: 'running' } });
    }

    const result = await executeDialogTurn(new Types.ObjectId(params.id));
    if (session.runMode === 'auto' && !result.done) {
      void continueDialogSession(params.id).catch(() => {});
    }
    const updated = await DialogSessionModel.findById(params.id).lean();
    return { ok: true, result, session: updated };
  });

  r.get('/dialog-sessions/:id/transcript', async (req, reply) => {
    const params = validate(reply, idParams, req.params ?? {}, 'params');
    if (!params) return;
    const session = await DialogSessionModel.findById(params.id).lean();
    if (!session) return reply.code(404).send({ error: 'not_found' });

    const turns = await DialogTurnModel.find({ sessionId: session._id })
      .sort({ turnIndex: 1 })
      .lean();

    const inbound = await InboundReplyModel.find({ dialogSessionId: session._id })
      .sort({ telegramDate: 1, createdAt: 1 })
      .limit(500)
      .lean();

    const accountIds = [
      session.accountAId,
      ...(session.peerAccountId ? [session.peerAccountId] : []),
    ];
    const accounts = await AccountModel.find({ _id: { $in: accountIds } })
      .select('phone label telegramUsername')
      .lean();

    return { session, turns, inbound, accounts };
  });
}
