#!/usr/bin/env node
/**
 * Standalone entry: npm run seed:qa-dialogs
 * Same as: npm run cli -- seed qa-dialogs
 */
import { seedQaDialogs } from './seedQaDialogs';

const count = Number.parseInt(process.argv[2] ?? '10', 10);
const dryRun = process.argv.includes('--dry-run');

seedQaDialogs({ count: Number.isFinite(count) ? count : 10, dryRun })
  .then((r) => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          count: r.dialogs.length,
          scriptsCreated: r.scriptsCreated,
          contactsUpserted: r.contactsUpserted,
          outFile: r.outFile,
        },
        null,
        2,
      ),
    );
    if (dryRun) {
      console.log(JSON.stringify(r.dialogs, null, 2));
    }
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
