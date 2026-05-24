import { Command } from 'commander';
import { logger } from '../../logger';
import { seedQaDialogs } from '../../seeds/seedQaDialogs';

export function registerSeedCommands(program: Command): void {
  const seed = program.command('seed').description('Dev/QA database seeds (disabled in production)');

  seed
    .command('qa-dialogs')
    .description('Generate Russian QA test dialogs (scripts + contacts). Not for production.')
    .option('-c, --count <n>', 'Number of dialogs', (v) => parseInt(String(v), 10), 10)
    .option('--dry-run', 'Write JSON only, do not touch MongoDB')
    .option('-o, --out <path>', 'Optional JSON output path')
    .action(async (opts) => {
      const result = await seedQaDialogs({
        count: Number.isFinite(opts.count) ? opts.count : 10,
        dryRun: Boolean(opts.dryRun),
        outFile: opts.out ? String(opts.out) : undefined,
      });
      logger.info(
        {
          count: result.dialogs.length,
          scriptsCreated: result.scriptsCreated,
          contactsUpserted: result.contactsUpserted,
          outFile: result.outFile,
        },
        'seed: qa-dialogs done',
      );
      if (opts.dryRun) {
        console.log(JSON.stringify(result.dialogs, null, 2));
      }
    });
}
