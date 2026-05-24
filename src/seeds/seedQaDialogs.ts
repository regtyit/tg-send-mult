import fs from 'fs';
import path from 'path';
import { connectMongo } from '../db';
import { ContactModel, DialogScriptModel } from '../db/models';
import { assertNotProduction } from './assertDevOnly';
import { generateDialogs, type Dialog } from './dialog-generator';

export interface SeedQaDialogsOptions {
  count?: number;
  /** Write JSON file only (no Mongo). */
  dryRun?: boolean;
  outFile?: string;
}

export interface SeedQaDialogsResult {
  dialogs: Dialog[];
  scriptsCreated: number;
  contactsUpserted: number;
  outFile?: string;
}

function dialogToScript(doc: Dialog) {
  const [p1] = doc.participants;
  return {
    name: doc.id,
    mode: 'turns' as const,
    turns: doc.messages.map((m) => ({
      side: m.from === p1.id ? ('a' as const) : ('b' as const),
      text: m.text,
      delaySecMin: 35,
      delaySecMax: 55,
    })),
    defaultDelaySecMin: 35,
    defaultDelaySecMax: 55,
    typingSec: 2,
    notes: 'QA seed fixture — not for production traffic',
  };
}

/**
 * Persist QA contacts + dialog scripts, or export JSON only.
 */
export async function seedQaDialogs(opts: SeedQaDialogsOptions = {}): Promise<SeedQaDialogsResult> {
  assertNotProduction('seedQaDialogs');
  const count = Math.max(1, Math.min(500, Math.floor(opts.count ?? 10)));
  const dialogs = generateDialogs(count);

  if (opts.dryRun) {
    const outFile = opts.outFile ?? path.join(process.cwd(), 'seeds', 'qa-dialogs.json');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(dialogs, null, 2), 'utf8');
    return { dialogs, scriptsCreated: 0, contactsUpserted: 0, outFile };
  }

  await connectMongo();
  let scriptsCreated = 0;
  let contactsUpserted = 0;

  for (const d of dialogs) {
    const [, p2] = d.participants;
    const contactRes = await ContactModel.updateOne(
      { userId: p2.id },
      {
        $set: {
          userId: p2.id,
          username: p2.id,
          firstName: 'QA',
          lastName: `Dialog ${d.index}`,
          tags: ['qa_dialog', 'test_fixture'],
          status: 'new',
          importedFrom: 'seed:qa-dialogs',
        },
      },
      { upsert: true },
    );
    if (contactRes.upsertedCount) contactsUpserted += 1;

    const script = dialogToScript(d);
    const existing = await DialogScriptModel.findOne({ name: script.name });
    if (existing) {
      await DialogScriptModel.updateOne({ _id: existing._id }, { $set: script });
    } else {
      await DialogScriptModel.create(script);
      scriptsCreated += 1;
    }
  }

  let outFile: string | undefined;
  if (opts.outFile) {
    outFile = opts.outFile;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(dialogs, null, 2), 'utf8');
  }

  return { dialogs, scriptsCreated, contactsUpserted, outFile };
}
