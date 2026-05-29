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

export interface WarmupOrchestratorSkip {
  accountAId?: string;
  accountBId?: string;
  presetSlug?: string;
  reason: string;
}

export interface WarmupOrchestratorFailure {
  sessionId?: string;
  accountAId?: string;
  accountBId?: string;
  presetSlug?: string;
  reason: string;
}

export interface WarmupOrchestratorResult {
  scanned: number;
  paired: number;
  created: number;
  started: number;
  skipped: number;
  dryRun: boolean;
  plans: WarmupPairPlan[];
  skippedDetails: WarmupOrchestratorSkip[];
  failures: WarmupOrchestratorFailure[];
}

function accountLabel(a: Pick<AccountDoc, 'phone' | 'label'>): string {
  return a.label?.trim() || a.phone;
}

export interface PlanWarmupOptions {
  /** Only these account ids (must be warming senders). */
  accountIds?: string[];
  /** When false, include selected accounts even if schedule says not due yet. */
  requireDue?: boolean;
  /** When false, allow pairing outside active sending window. */
  requireInWindow?: boolean;
}

function excludeSlugsForPair(
  a: AccountDoc,
  b: AccountDoc,
  batchUsedSlugs: Set<string>,
): Set<string> {
  const slugs = new Set(batchUsedSlugs);
  for (const s of a.warmingUsedPresetSlugs ?? []) slugs.add(s);
  for (const s of b.warmingUsedPresetSlugs ?? []) slugs.add(s);
  return slugs;
}

function buildPairPlan(
  a: AccountDoc,
  b: AccountDoc,
  at: Date,
  batchUsedSlugs: Set<string>,
): WarmupPairPlan | null {
  const suggestion = suggestWarmupPreset(a, {
    excludeSlugs: excludeSlugsForPair(a, b, batchUsedSlugs),
  });
  if (!suggestion) return null;
  batchUsedSlugs.add(suggestion.slug);
  return {
    accountAId: String(a._id),
    accountBId: String(b._id),
    presetSlug: suggestion.slug,
    presetName: suggestion.name,
    due: isWarmupDialogDue(a, at),
  };
}

/** Pair explicit account ids (even count); order preserved. */
export function planWarmupForAccountIds(
  accounts: AccountDoc[],
  orderedIds: string[],
  at: Date = new Date(),
  batchUsedSlugs = new Set<string>(),
): WarmupPairPlan[] {
  const byId = new Map(accounts.map((a) => [String(a._id), a]));
  const plans: WarmupPairPlan[] = [];
  for (let i = 0; i + 1 < orderedIds.length; i += 2) {
    const a = byId.get(orderedIds[i]!);
    const b = byId.get(orderedIds[i + 1]!);
    if (!a || !b) continue;
    const plan = buildPairPlan(a, b, at, batchUsedSlugs);
    if (plan) plans.push(plan);
  }
  return plans;
}

/** List warming senders due for a dialog and propose peer pairs + presets. */
export async function planWarmupDialogPairs(
  at: Date = new Date(),
  opts: PlanWarmupOptions = {},
): Promise<WarmupPairPlan[]> {
  const filter: Record<string, unknown> = {
    status: 'warming',
    sessionEnc: { $ne: '' },
    role: { $in: ['sender', null] },
  };
  if (opts.accountIds?.length) {
    filter._id = { $in: opts.accountIds.map((id) => new Types.ObjectId(id)) };
  }

  const warming = await AccountModel.find(filter)
    .select(
      'phone label warmingScriptDaysCompleted warmingUsedPresetSlugs deviceProfile warmingStartedAt warmupSchedule sendingWindow warmingLastScriptDay',
    )
    .lean();

  const batchUsedSlugs = new Set<string>();

  if (opts.accountIds?.length) {
    const requireDue = opts.requireDue !== false;
    const requireInWindow = opts.requireInWindow !== false;
    const eligibleIds = new Set(
      warming
        .filter((a) => {
          if (requireDue && !isWarmupDialogDue(a, at)) return false;
          if (requireInWindow && !isWithinSendingWindowAccount(a as AccountDoc, at)) return false;
          return true;
        })
        .map((a) => String(a._id)),
    );
    const ordered = opts.accountIds.filter((id) => eligibleIds.has(id));
    return planWarmupForAccountIds(warming as AccountDoc[], ordered, at, batchUsedSlugs);
  }

  const due = warming.filter((a) => {
    if (opts.requireDue === false || isWarmupDialogDue(a, at)) {
      if (opts.requireInWindow === false) return true;
      return isWithinSendingWindowAccount(a as AccountDoc, at);
    }
    return false;
  });
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
    const plan = buildPairPlan(a as AccountDoc, peer as AccountDoc, at, batchUsedSlugs);
    if (!plan) continue;

    plans.push(plan);
    used.add(aId);
    used.add(bId);
  }

  return plans;
}

export async function runWarmupOrchestrator(opts: {
  dryRun?: boolean;
  limit?: number;
  autoStart?: boolean;
  accountIds?: string[];
  requireDue?: boolean;
  requireInWindow?: boolean;
}): Promise<WarmupOrchestratorResult> {
  const dryRun = opts.dryRun === true;
  const limit = opts.limit ?? 20;
  const autoStart = opts.autoStart !== false;

  const plans = (
    await planWarmupDialogPairs(new Date(), {
      accountIds: opts.accountIds,
      requireDue: opts.requireDue,
      requireInWindow: opts.requireInWindow,
    })
  ).slice(0, limit);
  const result: WarmupOrchestratorResult = {
    scanned: plans.length,
    paired: plans.length,
    created: 0,
    started: 0,
    skipped: 0,
    dryRun,
    plans,
    skippedDetails: [],
    failures: [],
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
        result.skippedDetails.push({
          accountAId: plan.accountAId,
          accountBId: plan.accountBId,
          presetSlug: plan.presetSlug,
          reason: 'Active session already exists for this pair',
        });
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
        const updated = await DialogSessionModel.findById(session._id).lean();
        if (updated?.status === 'failed') {
          result.failures.push({
            sessionId: String(session._id),
            accountAId: plan.accountAId,
            accountBId: plan.accountBId,
            presetSlug: plan.presetSlug,
            reason: updated.lastError?.trim() || 'Session failed during first turn',
          });
        } else {
          result.started += 1;
        }
      }
    } catch (err) {
      result.skipped += 1;
      const reason = err instanceof Error ? err.message : String(err);
      result.skippedDetails.push({
        accountAId: plan.accountAId,
        accountBId: plan.accountBId,
        presetSlug: plan.presetSlug,
        reason,
      });
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
