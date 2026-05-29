import { Types } from 'mongoose';
import {
  AccountModel,
  DialogSessionModel,
} from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { isWarmupDialogDue } from '../accounts/warmupSchedule';
import { describeWarmingStatus } from '../accounts/warming';
import { isWithinSendingWindowAccount } from '../antilimit/window';
import { continueDialogSession } from './continueSession';
import { suggestWarmupPreset } from './suggestWarmupPreset';
import { upsertHumanDialogPreset } from './humanDialogTemplates';
import { logger } from '../../logger';

export interface WarmupPairPlan {
  accountAId: string;
  accountBId: string;
  presetSlug: string;
  presetName: string;
  due: boolean;
}

export interface WarmupOrchestratorResult {
  scanned: number;
  paired: number;
  created: number;
  started: number;
  skipped: number;
  dryRun: boolean;
  plans: WarmupPairPlan[];
}

function accountLabel(a: Pick<AccountDoc, 'phone' | 'label'>): string {
  return a.label?.trim() || a.phone;
}

/** List warming senders due for a dialog and propose peer pairs + presets. */
export async function planWarmupDialogPairs(at: Date = new Date()): Promise<WarmupPairPlan[]> {
  const warming = await AccountModel.find({
    status: 'warming',
    sessionEnc: { $ne: '' },
    role: { $in: ['sender', null] },
  })
    .select(
      'phone label warmingScriptDaysCompleted warmingUsedPresetSlugs deviceProfile warmingStartedAt warmupSchedule sendingWindow warmingLastScriptDay',
    )
    .lean();

  const due = warming.filter((a) => isWarmupDialogDue(a, at) && isWithinSendingWindowAccount(a as AccountDoc, at));
  const plans: WarmupPairPlan[] = [];
  const used = new Set<string>();

  for (const a of due) {
    const aId = String(a._id);
    if (used.has(aId)) continue;

    const peer = due.find(
      (b) =>
        String(b._id) !== aId &&
        !used.has(String(b._id)) &&
        b.sendingWindow?.timezone === a.sendingWindow?.timezone,
    ) ?? due.find((b) => String(b._id) !== aId && !used.has(String(b._id)));

    if (!peer) continue;

    const bId = String(peer._id);
    const suggestion = suggestWarmupPreset(a);
    if (!suggestion) continue;

    plans.push({
      accountAId: aId,
      accountBId: bId,
      presetSlug: suggestion.slug,
      presetName: suggestion.name,
      due: true,
    });
    used.add(aId);
    used.add(bId);
  }

  return plans;
}

export async function runWarmupOrchestrator(opts: {
  dryRun?: boolean;
  limit?: number;
  autoStart?: boolean;
}): Promise<WarmupOrchestratorResult> {
  const dryRun = opts.dryRun === true;
  const limit = opts.limit ?? 20;
  const autoStart = opts.autoStart !== false;

  const plans = (await planWarmupDialogPairs()).slice(0, limit);
  const result: WarmupOrchestratorResult = {
    scanned: plans.length,
    paired: plans.length,
    created: 0,
    started: 0,
    skipped: 0,
    dryRun,
    plans,
  };

  if (dryRun || !plans.length) return result;

  for (const plan of plans) {
    try {
      const existing = await DialogSessionModel.findOne({
        accountAId: new Types.ObjectId(plan.accountAId),
        peerAccountId: new Types.ObjectId(plan.accountBId),
        status: { $in: ['draft', 'running', 'waiting_peer', 'paused'] },
      }).lean();
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const applied = await upsertHumanDialogPreset(plan.presetSlug, false);
      const [accA, accB] = await Promise.all([
        AccountModel.findById(plan.accountAId).select('phone label').lean(),
        AccountModel.findById(plan.accountBId).select('phone label').lean(),
      ]);
      const name = `Warm-up — ${accountLabel(accA ?? { phone: plan.accountAId, label: '' })} ↔ ${accountLabel(accB ?? { phone: plan.accountBId, label: '' })}`;

      const session = await DialogSessionModel.create({
        name,
        scriptId: new Types.ObjectId(applied.id),
        accountAId: new Types.ObjectId(plan.accountAId),
        peerType: 'account',
        peerAccountId: new Types.ObjectId(plan.accountBId),
        peerContactId: null,
        runMode: 'auto',
        status: 'draft',
      });
      result.created += 1;

      if (autoStart) {
        await DialogSessionModel.updateOne(
          { _id: session._id },
          {
            $set: {
              status: 'running',
              currentTurn: 0,
              waitCursorAt: null,
              nextRunAt: new Date(),
            },
          },
        );
        await continueDialogSession(session._id);
        result.started += 1;
      }
    } catch (err) {
      result.skipped += 1;
      logger.warn({ err, plan }, 'warmup orchestrator: pair failed');
    }
  }

  return result;
}

export async function warmingFleetSummary(): Promise<{
  warmingCount: number;
  dueCount: number;
  readinessMetCount: number;
}> {
  const warming = await AccountModel.find({ status: 'warming' }).select('_id').lean();
  const at = new Date();
  let dueCount = 0;
  let readinessMetCount = 0;
  for (const id of warming) {
    const full = await AccountModel.findById(id._id).lean();
    if (!full) continue;
    const status = describeWarmingStatus(full, at);
    if (status?.readinessMet) readinessMetCount += 1;
    if (status?.warmupDialogDue) dueCount += 1;
  }
  return {
    warmingCount: warming.length,
    dueCount,
    readinessMetCount,
  };
}
