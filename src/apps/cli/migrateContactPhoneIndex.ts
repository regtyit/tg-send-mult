#!/usr/bin/env node
import { connectMongo, disconnectMongo } from '../../db';
import { ContactModel } from '../../db/models';
import { logger } from '../../logger';

const INDEX_NAME = 'phoneE164_1';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const dryRun = hasFlag('--dry-run');

  await connectMongo();

  const coll = ContactModel.collection;
  const indexes = await coll.indexes();
  const phoneIndex = indexes.find((i) => i.name === INDEX_NAME);
  const hasPartial =
    phoneIndex?.partialFilterExpression != null &&
    Object.keys(phoneIndex.partialFilterExpression as object).length > 0;

  const emptyPhoneCount = await ContactModel.countDocuments({ phoneE164: '' });

  logger.info(
    { dryRun, hasPhoneIndex: !!phoneIndex, hasPartial, emptyPhoneCount },
    'migration: contact phoneE164 index state',
  );

  if (hasPartial && emptyPhoneCount === 0) {
    logger.info('migration: contact phone index already correct, nothing to do');
    return;
  }

  if (dryRun) {
    logger.info('migration: dry run — would drop/recreate phoneE164 index and unset empty phones');
    return;
  }

  if (phoneIndex && !hasPartial) {
    await coll.dropIndex(INDEX_NAME);
    logger.info({ index: INDEX_NAME }, 'migration: dropped legacy phoneE164 unique index');
  }

  await coll.createIndex(
    { phoneE164: 1 },
    {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: { phoneE164: { $exists: true, $gt: '' } },
    },
  );
  logger.info({ index: INDEX_NAME }, 'migration: created partial unique phoneE164 index');

  if (emptyPhoneCount > 0) {
    const res = await ContactModel.updateMany({ phoneE164: '' }, { $unset: { phoneE164: 1 } });
    logger.info({ modified: res.modifiedCount }, 'migration: unset empty phoneE164 on contacts');
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
