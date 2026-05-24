import { DialogScriptModel } from '../../db/models';

/** Turn row compatible with DialogScript `turns` after persistence. */
export interface HumanDialogTurnInput {
  side: 'a' | 'b';
  text: string;
  delaySecMin?: number;
  delaySecMax?: number;
  waitForText?: string;
}

export interface HumanDialogPreset {
  /** Stable id for API/CLI (kebab-case). */
  slug: string;
  /** Shown in UI and stored as script name. */
  name: string;
  /** Short blurb for the picker. */
  description: string;
  defaultDelaySecMin: number;
  defaultDelaySecMax: number;
  typingSec: number;
  notes: string;
  turns: HumanDialogTurnInput[];
}

const d = (min: number, max: number) => ({ delaySecMin: min, delaySecMax: max });

/**
 * Built-in dialog scripts with casual, human-like wording (EN + RU).
 * Sender A opens; peer B replies — natural pacing via per-turn delays.
 */
export const HUMAN_DIALOG_PRESETS: HumanDialogPreset[] = [
  {
    slug: 'coffee-catchup',
    name: 'Preset: casual coffee check-in',
    description: 'Friendly “want to grab coffee?” thread with light back-and-forth.',
    defaultDelaySecMin: 25,
    defaultDelaySecMax: 70,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hey — random thought, are you free for coffee sometime this week?', ...d(40, 95) },
      { side: 'b', text: 'oh hi! yeah maybe — thursday afternoon could work for me', ...d(35, 80) },
      { side: 'a', text: 'thursday works. want me to pick a place or do you have a favourite spot?', ...d(45, 100) },
      { side: 'b', text: 'there’s that little place near the station — quiet enough to actually talk', ...d(40, 90) },
      { side: 'a', text: 'perfect, I’ll grab us a table around 4 unless you hear otherwise', ...d(30, 75) },
    ],
  },
  {
    slug: 'work-handoff',
    name: 'Preset: polite work handoff',
    description: 'Short professional thread: context, file, thanks — sounds like real Slack/DM.',
    defaultDelaySecMin: 20,
    defaultDelaySecMax: 55,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hey, quick heads-up — I’m handing off the analytics export you asked for', ...d(25, 60) },
      { side: 'b', text: 'amazing, thanks. do you have a rough ETA or should I ping someone else?', ...d(20, 55) },
      { side: 'a', text: 'should be on the shared drive in ~20 min — I’ll drop the link here when it finishes', ...d(35, 75) },
      { side: 'b', text: 'got it, I’ll keep an eye out. appreciate you squeezing this in', ...d(25, 65) },
      { side: 'a', text: 'no worries at all — shout if anything looks off once you open it', ...d(30, 70) },
    ],
  },
  {
    slug: 'weekend-plans-ru',
    name: 'Preset: выходные (RU, неформально)',
    description: 'Русский бытовой диалог: спросить про выходные, ответ, договориться “на связи”.',
    defaultDelaySecMin: 22,
    defaultDelaySecMax: 65,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'привет) ты как, вообще есть планы на субботу или пока тишина?', ...d(35, 85) },
      { side: 'b', text: 'привет! да вроде ничего жёсткого, думал просто выспаться и в магазин сгонять', ...d(30, 75) },
      { side: 'a', text: 'я тоже без сверхидей — если захочешь, могли бы вечером мимо кофе зайти', ...d(40, 95) },
      { side: 'b', text: 'звучит нормально, напиши ближе к делу, как настроение будет', ...d(35, 80) },
      { side: 'a', text: 'ок, тогда на связи — без фанатизма, как получится', ...d(28, 70) },
    ],
  },
  {
    slug: 'running-late',
    name: 'Preset: running 10 minutes late',
    description: 'Apologize, ETA, other side is chill — very common real chat.',
    defaultDelaySecMin: 15,
    defaultDelaySecMax: 45,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'ugh I’m so sorry — I’m running like 8–10 min late, traffic turned weird', ...d(18, 40) },
      { side: 'b', text: 'all good, I’m already here with a book — take your time', ...d(15, 40) },
      { side: 'a', text: 'you’re the best, seriously. I’ll text when I’m at the door', ...d(20, 50) },
      { side: 'b', text: 'no stress, see you in a bit', ...d(15, 38) },
    ],
  },
  {
    slug: 'feedback-soft',
    name: 'Preset: gentle feedback (work)',
    description: 'Non-blaming wording, asks for perspective, closes warmly.',
    defaultDelaySecMin: 28,
    defaultDelaySecMax: 75,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hey, got a minute? I wanted to run something by you — zero drama, just clarity', ...d(40, 90) },
      { side: 'b', text: 'yeah of course, what’s up?', ...d(22, 55) },
      { side: 'a', text: 'on the last deck the numbers jumped a bit — I might’ve misread the sheet, can you sanity-check?', ...d(45, 100) },
      { side: 'b', text: 'oh good catch — I think I merged two tabs. I’ll fix and re-send before EOD', ...d(35, 85) },
      { side: 'a', text: 'legend, thank you. ping me if you want a second pair of eyes on the revision', ...d(30, 70) },
    ],
  },
  {
    slug: 'after-long-day',
    name: 'Preset: “long day” vent + support',
    description: 'Light venting, empathy, small concrete offer — reads like friends texting.',
    defaultDelaySecMin: 25,
    defaultDelaySecMax: 72,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'today was… a lot. back-to-back calls and my brain is basically oatmeal', ...d(38, 88) },
      { side: 'b', text: 'I feel that. want to vent for two minutes or do you need quiet?', ...d(30, 75) },
      { side: 'a', text: 'honestly both 😅 but venting helps — basically PM kept moving the goalposts', ...d(40, 95) },
      { side: 'b', text: 'that’s exhausting. if you want, we can do a super low-key dinner and not talk work at all', ...d(42, 100) },
      { side: 'a', text: 'that actually sounds perfect. I’ll owe you one', ...d(28, 65) },
      { side: 'b', text: 'you don’t owe me anything — just show up hungry', ...d(25, 60) },
    ],
  },
];

export function getHumanDialogPreset(slug: string): HumanDialogPreset | undefined {
  return HUMAN_DIALOG_PRESETS.find((p) => p.slug === slug);
}

export function humanDialogPresetSummary(p: HumanDialogPreset): {
  slug: string;
  name: string;
  description: string;
  turnCount: number;
  preview: string;
} {
  const first = p.turns[0]?.text ?? '';
  const preview = first.length > 90 ? `${first.slice(0, 90)}…` : first;
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    turnCount: p.turns.length,
    preview,
  };
}

type DialogScriptCreateShape = {
  name: string;
  mode: 'turns';
  turns: Array<{
    side: 'a' | 'b';
    text: string;
    waitForText?: string;
    delaySecMin: number;
    delaySecMax: number;
  }>;
  defaultDelaySecMin: number;
  defaultDelaySecMax: number;
  typingSec: number;
  notes: string;
};

function presetToCreateDoc(p: HumanDialogPreset): DialogScriptCreateShape {
  return {
    name: p.name,
    mode: 'turns',
    turns: p.turns.map((t) => ({
      side: t.side,
      text: t.text,
      ...(t.waitForText ? { waitForText: t.waitForText } : {}),
      delaySecMin: t.delaySecMin ?? p.defaultDelaySecMin,
      delaySecMax: t.delaySecMax ?? p.defaultDelaySecMax,
    })),
    defaultDelaySecMin: p.defaultDelaySecMin,
    defaultDelaySecMax: p.defaultDelaySecMax,
    typingSec: p.typingSec,
    notes: `${p.notes}\n__presetSlug:${p.slug}__`,
  };
}

export async function upsertHumanDialogPreset(
  slug: string,
  replace: boolean,
): Promise<{ created: boolean; id: string }> {
  const p = getHumanDialogPreset(slug);
  if (!p) throw new Error(`Unknown preset slug: ${slug}`);
  const docShape = presetToCreateDoc(p);
  const existing = await DialogScriptModel.findOne({ name: p.name }).lean();
  if (existing) {
    if (!replace) {
      return { created: false, id: String(existing._id) };
    }
    await DialogScriptModel.updateOne({ _id: existing._id }, { $set: docShape });
    return { created: false, id: String(existing._id) };
  }
  const created = await DialogScriptModel.create(docShape);
  return { created: true, id: String(created._id) };
}

export async function upsertAllHumanDialogPresets(
  replace: boolean,
): Promise<Array<{ slug: string; created: boolean; id: string }>> {
  const out: Array<{ slug: string; created: boolean; id: string }> = [];
  for (const preset of HUMAN_DIALOG_PRESETS) {
    const r = await upsertHumanDialogPreset(preset.slug, replace);
    out.push({ slug: preset.slug, created: r.created, id: r.id });
  }
  return out;
}
