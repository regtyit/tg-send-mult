#!/usr/bin/env node
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../../db';
import { MessageModel } from '../../db/models';
import type { MessageStatus } from '../../db/models/Message';
import { logger } from '../../logger';

const OLD_INDEX = 'campaignId_1_contactId_1_textHash_1';
const NEW_INDEX = 'campaignId_1_contactId_1';

/** Lower rank = prefer keeping this row when deduping campaign+contact. */
const STATUS_KEEP_RANK: Record<MessageStatus, number> = {
  sent: 0,
  sending: 1,
  queued: 2,
  failed: 3,
  skipped_blocked: 4,
  skipped_quota: 5,
  skipped_duplicate: 6,
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function keepRank(status: string): number {
  return STATUS_KEEP_RANK[status as MessageStatus] ?? 99;
}

function messageSortKey(m: { status: string; sentAt?: Date | null; updatedAt?: Date; createdAt?: Date }): number {
  const rank = keepRank(m.status);
  const t = m.sentAt ?? m.updatedAt ?? m.createdAt;
  const ts = t instanceof Date ? t.getTime() : 0;
  return rank * 1e15 - ts;
}

async function dedupeCampaignContactMessages(dryRun: boolean): Promise<{ groups: number; removed: number }> {
  const groups = await MessageModel.aggregate<{
    _id: { campaignId: Types.ObjectId; contactId: Types.ObjectId };
    count: number;
  }>([
    { $match: { campaignId: { $type: 'objectId' } } },
    {
      $group: {
        _id: { campaignId: '$campaignId', contactId: '$contactId' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let removed = 0;
  for (const g of groups) {
    const msgs = await MessageModel.find({
      campaignId: g._id.campaignId,
      contactId: g._id.contactId,
    }).lean();

    const sorted = [...msgs].sort((a, b) => messageSortKey(a) - messageSortKey(b));
    const toDelete = sorted.slice(1).map((m) => m._id);
    if (!toDelete.length) continue;

    if (dryRun) {
      logger.info(
        {
          campaignId: String(g._id.campaignId),
          contactId: String(g._id.contactId),
          keep: String(sorted[0]!._id),
          keepStatus: sorted[0]!.status,
          remove: toDelete.map(String),
        },
        'migration: would dedupe campaign+contact messages',
      );
      removed += toDelete.length;
      continue;
    }

    const res = await MessageModel.deleteMany({ _id: { $in: toDelete } });
    removed += res.deletedCount ?? 0;
  }

  return { groups: groups.length, removed };
}

async function main(): Promise<void> {
  const dryRun = hasFlag('--dry-run');
  await connectMongo();

  const coll = MessageModel.collection;
  const indexes = await coll.indexes();
  const oldIdx = indexes.find((i) => i.name === OLD_INDEX);
  const newIdx = indexes.find((i) => i.name === NEW_INDEX);

  logger.info(
    { dryRun, hasOldIndex: !!oldIdx, hasNewIndex: !!newIdx },
    'migration: campaign contact dedup index state',
  );

  if (newIdx && !oldIdx) {
    const remaining = await MessageModel.aggregate([
      { $match: { campaignId: { $type: 'objectId' } } },
      { $group: { _id: { campaignId: '$campaignId', contactId: '$contactId' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]);
    if (!remaining.length) {
      logger.info('migration: new index already in place and data is clean');
      return;
    }
  }

  const { groups, removed } = await dedupeCampaignContactMessages(dryRun);
  if (groups > 0) {
    logger.info({ groups, removed, dryRun }, 'migration: deduped duplicate campaign+contact messages');
  }

  if (dryRun) {
    logger.info('migration: dry run — no index changes');
    return;
  }

  if (oldIdx) {
    await coll.dropIndex(OLD_INDEX);
    logger.info({ index: OLD_INDEX }, 'migration: dropped old index');
  }

  if (!newIdx) {
    await coll.createIndex(
      { campaignId: 1, contactId: 1 },
      {
        name: NEW_INDEX,
        unique: true,
        partialFilterExpression: { campaignId: { $type: 'objectId' } },
      },
    );
    logger.info({ index: NEW_INDEX }, 'migration: created unique campaign+contact index');
  } else {
    logger.info({ index: NEW_INDEX }, 'migration: unique campaign+contact index already exists');
  }
}

main()
  .catch((err) => {
    logger.error({ err }, 'migration: failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => undefined);
  });
