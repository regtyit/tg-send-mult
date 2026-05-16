#!/usr/bin/env node
import { connectMongo, disconnectMongo } from '../../db';
import { MessageModel } from '../../db/models';
import { logger } from '../../logger';

const OLD_INDEX_NAME = 'contactId_1_textHash_1';
const NEW_INDEX_NAME = 'campaignId_1_contactId_1_textHash_1';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const dryRun = hasFlag('--dry-run');
  const force = hasFlag('--force');

  await connectMongo();

  const coll = MessageModel.collection;
  const indexes = await coll.indexes();

  const oldIndex = indexes.find((i) => i.name === OLD_INDEX_NAME);
  const newIndex = indexes.find((i) => i.name === NEW_INDEX_NAME);

  logger.info(
    { dryRun, force, hasOldIndex: !!oldIndex, hasNewIndex: !!newIndex },
    'migration: message dedup index state',
  );

  if (newIndex) {
    logger.info('migration: new index already exists, nothing to do');
    return;
  }

  const duplicateGroups = await MessageModel.aggregate<{ _id: unknown; count: number }>([
    { $match: { campaignId: { $type: 'objectId' } } },
    {
      $group: {
        _id: {
          campaignId: '$campaignId',
          contactId: '$contactId',
          textHash: '$textHash',
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  ]);

  if (duplicateGroups.length > 0 && !force) {
    logger.error(
      { samples: duplicateGroups.length },
      'migration: found duplicates for new unique key; re-run with --force to attempt index creation anyway',
    );
    throw new Error('Cannot create new dedup index due to duplicate rows');
  }

  if (dryRun) {
    logger.info('migration: dry-run finished (no writes performed)');
    return;
  }

  if (oldIndex) {
    await coll.dropIndex(OLD_INDEX_NAME);
    logger.info({ index: OLD_INDEX_NAME }, 'migration: dropped old index');
  }

  await coll.createIndex(
    { campaignId: 1, contactId: 1, textHash: 1 },
    {
      name: NEW_INDEX_NAME,
      unique: true,
      partialFilterExpression: { campaignId: { $type: 'objectId' } },
    },
  );
  logger.info({ index: NEW_INDEX_NAME }, 'migration: created new index');
}

main()
  .catch((err) => {
    logger.error({ err }, 'migration: failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => undefined);
  });
