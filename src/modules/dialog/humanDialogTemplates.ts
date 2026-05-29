import { DialogScriptModel } from '../../db/models';

/** Turn row compatible with DialogScript `turns` after persistence. */
export interface HumanDialogTurnInput {
  side: 'a' | 'b';
  text: string;
  delaySecMin?: number;
  delaySecMax?: number;
  waitForText?: string;
}

export type HumanDialogPresetLang = 'en' | 'ru';
export type HumanDialogPresetCategory = 'social' | 'work' | 'support' | 'logistics';

export interface HumanDialogPreset {
  /** Stable id for API/CLI (kebab-case). */
  slug: string;
  /** Suggested ordinal for warm-up readiness (1st, 2nd, 3rd recommended dialog). */
  warmupSlot?: 1 | 2 | 3;
  /** Shown in UI and stored as script name. */
  name: string;
  /** Short blurb for the picker. */
  description: string;
  lang: HumanDialogPresetLang;
  category: HumanDialogPresetCategory;
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
    lang: 'en',
    category: 'social',
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
    lang: 'en',
    category: 'work',
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
    lang: 'ru',
    category: 'social',
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
    lang: 'en',
    category: 'logistics',
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
    lang: 'en',
    category: 'work',
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
    lang: 'en',
    category: 'support',
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
  {
    slug: 'walk-after-work',
    name: 'Preset: evening walk invite',
    description: 'Low-pressure invite to stretch legs after work — casual tone.',
    lang: 'en',
    category: 'social',
    defaultDelaySecMin: 20,
    defaultDelaySecMax: 60,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'if you’re not wiped out later — fancy a quick walk? weather finally cooperated', ...d(35, 80) },
      { side: 'b', text: 'I could use that actually. maybe 7-ish after I eat something?', ...d(28, 70) },
      { side: 'a', text: '7 works. I’ll ping when I’m heading out the door', ...d(30, 75) },
      { side: 'b', text: 'cool, see you then', ...d(18, 45) },
    ],
  },
  {
    slug: 'movie-pick',
    name: 'Preset: what should we watch?',
    description: 'Friends debating a film — opinions, compromise, no spoilers.',
    lang: 'en',
    category: 'social',
    defaultDelaySecMin: 22,
    defaultDelaySecMax: 65,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'ok serious question: comedy or something that pretends to be deep?', ...d(32, 75) },
      { side: 'b', text: 'comedy please, my brain is fried. nothing longer than 2 hours though', ...d(28, 68) },
      { side: 'a', text: 'there’s that one everyone keeps quoting — reviews say it’s dumb in a good way', ...d(38, 88) },
      { side: 'b', text: 'sold. you pick, I’ll bring snacks and zero commentary', ...d(25, 62) },
      { side: 'a', text: 'deal. starting in 20 unless you bail on me', ...d(22, 55) },
    ],
  },
  {
    slug: 'birthday-wish',
    name: 'Preset: birthday check-in',
    description: 'Warm birthday message and short reply thread.',
    lang: 'en',
    category: 'social',
    defaultDelaySecMin: 18,
    defaultDelaySecMax: 50,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'happy birthday!! hope today treats you gently and the cake is actually good', ...d(25, 60) },
      { side: 'b', text: 'aw thank you — very kind of you to remember', ...d(20, 50) },
      { side: 'a', text: 'of course. any fun plans or is it a quiet one?', ...d(28, 70) },
      { side: 'b', text: 'quiet dinner with family later. might nap first honestly', ...d(24, 58) },
      { side: 'a', text: 'nap is valid. enjoy your day', ...d(18, 42) },
    ],
  },
  {
    slug: 'reschedule-zoom',
    name: 'Preset: reschedule a call',
    description: 'Professional but human — conflict, propose slot, confirm.',
    lang: 'en',
    category: 'work',
    defaultDelaySecMin: 18,
    defaultDelaySecMax: 50,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hey — any chance we can bump our 3pm sync? something landed on my side', ...d(22, 55) },
      { side: 'b', text: 'no problem. tomorrow morning or thursday same time works for me', ...d(20, 52) },
      { side: 'a', text: 'thursday same time is perfect — I’ll update the invite', ...d(25, 60) },
      { side: 'b', text: 'thanks, talk then', ...d(15, 38) },
    ],
  },
  {
    slug: 'quick-status',
    name: 'Preset: “any update?” (work)',
    description: 'Polite nudge without sounding pushy.',
    lang: 'en',
    category: 'work',
    defaultDelaySecMin: 20,
    defaultDelaySecMax: 55,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hi! no rush at all — just checking if you had a chance to peek at the draft', ...d(30, 75) },
      { side: 'b', text: 'thanks for the ping — I skimmed it, sending comments in an hour', ...d(25, 65) },
      { side: 'a', text: 'perfect, that’s plenty. holler if anything’s unclear', ...d(22, 55) },
      { side: 'b', text: 'will do — appreciate the patience', ...d(18, 42) },
    ],
  },
  {
    slug: 'thanks-for-favor',
    name: 'Preset: thank you after a favor',
    description: 'Gratitude + reassurance — short and genuine.',
    lang: 'en',
    category: 'social',
    defaultDelaySecMin: 15,
    defaultDelaySecMax: 45,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'just wanted to say thanks again for covering for me yesterday — huge help', ...d(25, 60) },
      { side: 'b', text: 'anytime, seriously. hope everything’s calmer today', ...d(20, 50) },
      { side: 'a', text: 'way calmer. coffee’s on me next time', ...d(22, 55) },
      { side: 'b', text: 'I’ll hold you to that', ...d(15, 40) },
    ],
  },
  {
    slug: 'bad-news-soft',
    name: 'Preset: soft bad news',
    description: 'Deliver mild bad news with empathy and next step.',
    lang: 'en',
    category: 'support',
    defaultDelaySecMin: 28,
    defaultDelaySecMax: 75,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hey — I owe you a straight answer and I don’t want to leave you hanging', ...d(40, 95) },
      { side: 'b', text: 'all good, what’s going on?', ...d(22, 55) },
      { side: 'a', text: 'we have to push the launch a week — still on track, just tighter than we thought', ...d(45, 100) },
      { side: 'b', text: 'thanks for telling me early. what do you need from my side?', ...d(35, 85) },
      { side: 'a', text: 'just patience for now — I’ll send a revised timeline tonight', ...d(30, 72) },
    ],
  },
  {
    slug: 'congrats-promo',
    name: 'Preset: congrats on promotion',
    description: 'Celebrate a win — enthusiastic but not over the top.',
    lang: 'en',
    category: 'support',
    defaultDelaySecMin: 20,
    defaultDelaySecMax: 58,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'saw your news — congrats!! well deserved, seriously', ...d(28, 68) },
      { side: 'b', text: 'thank you, still feels surreal tbh', ...d(22, 55) },
      { side: 'a', text: 'you’ve been carrying that team for months. celebrate properly this weekend', ...d(32, 78) },
      { side: 'b', text: 'trying to. drinks soon?', ...d(25, 62) },
      { side: 'a', text: 'absolutely — I’ll find us a spot', ...d(22, 55) },
    ],
  },
  {
    slug: 'parcel-arrived',
    name: 'Preset: package / delivery (EN)',
    description: 'Courier at the door, neighbor helps — everyday logistics.',
    lang: 'en',
    category: 'logistics',
    defaultDelaySecMin: 12,
    defaultDelaySecMax: 40,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'hey sorry to bother — courier’s here for me but I’m stuck in a meeting', ...d(18, 42) },
      { side: 'b', text: 'want me to grab it and leave by your door?', ...d(15, 38) },
      { side: 'a', text: 'that would save me — it’s a small box, shouldn’t be heavy', ...d(20, 48) },
      { side: 'b', text: 'done, it’s outside your place', ...d(25, 55) },
      { side: 'a', text: 'you’re a lifesaver, thank you', ...d(15, 35) },
    ],
  },
  {
    slug: 'delivery-ru',
    name: 'Preset: курьер / доставка (RU)',
    description: 'Курьер у подъезда, уточнить код и время.',
    lang: 'ru',
    category: 'logistics',
    defaultDelaySecMin: 12,
    defaultDelaySecMax: 42,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'привет, курьер уже у дома — ты на месте? могу продиктовать код', ...d(18, 45) },
      { side: 'b', text: 'да, я внизу. код тот же что в прошлый раз?', ...d(15, 40) },
      { side: 'a', text: 'ага, 4521#. если что — я на связи, заказ на твоё имя', ...d(22, 55) },
      { side: 'b', text: 'забрал, всё ок, положу у двери', ...d(20, 50) },
      { side: 'a', text: 'спасибо большое', ...d(12, 32) },
    ],
  },
  {
    slug: 'docs-check-ru',
    name: 'Preset: документы / подпись (RU)',
    description: 'Рабочий тон: файл, вопрос, уточнение срока.',
    lang: 'ru',
    category: 'work',
    defaultDelaySecMin: 20,
    defaultDelaySecMax: 55,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'добрый день) скинул скан в общий чат — глянешь, когда будет минутка?', ...d(28, 70) },
      { side: 'b', text: 'привет, да, сегодня после обеда посмотрю', ...d(22, 58) },
      { side: 'a', text: 'супер. там важна только вторая страница и подпись внизу', ...d(30, 75) },
      { side: 'b', text: 'понял, если что — наберу, а так отпишусь текстом', ...d(25, 65) },
    ],
  },
  {
    slug: 'call-reschedule-ru',
    name: 'Preset: перенос созвона (RU)',
    description: 'Вежливо перенести звонок, предложить время.',
    lang: 'ru',
    category: 'work',
    defaultDelaySecMin: 18,
    defaultDelaySecMax: 50,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'привет! не успеваю на созвон в 15:00 — можно сдвинуть?', ...d(22, 55) },
      { side: 'b', text: 'без проблем. завтра утром или в пятницу в то же время?', ...d(20, 52) },
      { side: 'a', text: 'пятница в 15:00 отлично, спасибо', ...d(18, 45) },
      { side: 'b', text: 'ок, перенесу в календаре', ...d(15, 38) },
    ],
  },
  {
    slug: 'congrats-ru',
    name: 'Preset: поздравление (RU)',
    description: 'Тёплое поздравление и короткий ответ.',
    lang: 'ru',
    category: 'social',
    defaultDelaySecMin: 18,
    defaultDelaySecMax: 50,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'с днём рождения! пусть год будет спокойнее прошлого и с хорошими сюрпризами', ...d(25, 62) },
      { side: 'b', text: 'спасибо, очень приятно)', ...d(18, 45) },
      { side: 'a', text: 'как планируешь отмечать — дома или куда-то выбираешься?', ...d(28, 70) },
      { side: 'b', text: 'скорее дома с семьёй, без шума', ...d(22, 55) },
      { side: 'a', text: 'звучит идеально. хорошего дня!', ...d(18, 42) },
    ],
  },
  {
    slug: 'not-feeling-well-ru',
    name: 'Preset: плохо себя чувствую (RU)',
    description: 'Сообщить что заболел, коллега/друг поддерживает.',
    lang: 'ru',
    category: 'support',
    defaultDelaySecMin: 22,
    defaultDelaySecMax: 60,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'привет, сегодня выпадаю — температура подскочила, вряд ли буду полезен на звонках', ...d(35, 85) },
      { side: 'b', text: 'выздоравливай. перенесём всё, не парься', ...d(25, 65) },
      { side: 'a', text: 'спасибо. отпишусь завтра утром как самочувствие', ...d(28, 72) },
      { side: 'b', text: 'ок, отдыхай', ...d(15, 38) },
    ],
  },
  {
    slug: 'family-dinner-ru',
    name: 'Preset: ужин у родителей (RU)',
    description: 'Семейные планы, уточнить время и что принести.',
    lang: 'ru',
    category: 'social',
    defaultDelaySecMin: 22,
    defaultDelaySecMax: 62,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'мама зовёт в воскресенье на ужин — ты тоже идёшь?', ...d(30, 75) },
      { side: 'b', text: 'да, думаю да. во сколько они ждут?', ...d(25, 65) },
      { side: 'a', text: 'около 18:00. я возьму десерт, можешь взять что-нибудь к чаю если удобно', ...d(35, 82) },
      { side: 'b', text: 'ок, возьму печенье. до встречи)', ...d(22, 55) },
    ],
  },
  {
    slug: 'weather-smalltalk',
    name: 'Preset: weather small talk',
    description: 'Classic opener — rain, plans change, light humor.',
    lang: 'en',
    category: 'social',
    defaultDelaySecMin: 15,
    defaultDelaySecMax: 45,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'did you see the sky just give up? I’m soaked and my umbrella betrayed me', ...d(25, 60) },
      { side: 'b', text: 'same — I gave up and bought terrible coffee to wait it out', ...d(22, 55) },
      { side: 'a', text: 'solid strategy. want to reschedule our outdoor thing to indoors?', ...d(28, 70) },
      { side: 'b', text: 'yes please. your place or mine, either works', ...d(24, 58) },
    ],
  },
  {
    slug: 'pet-update',
    name: 'Preset: pet health update',
    description: 'Share news about a pet — worry, relief, thanks.',
    lang: 'en',
    category: 'support',
    defaultDelaySecMin: 25,
    defaultDelaySecMax: 70,
    typingSec: 3,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'vet said it’s just a mild infection — meds for a week and he should perk up', ...d(35, 85) },
      { side: 'b', text: 'oh I’m so glad it’s not worse. poor little guy', ...d(28, 72) },
      { side: 'a', text: 'yeah me too. he’s already giving me the “feed me” eyes', ...d(30, 75) },
      { side: 'b', text: 'classic. keep me posted, happy to cat-sit if you need a break', ...d(32, 78) },
      { side: 'a', text: 'might take you up on that — thank you', ...d(22, 55) },
    ],
  },
  {
    slug: 'lost-and-found',
    name: 'Preset: lost item found',
    description: 'Someone found your thing — coordinate pickup.',
    lang: 'en',
    category: 'logistics',
    defaultDelaySecMin: 15,
    defaultDelaySecMax: 42,
    typingSec: 2,
    notes: 'Built-in human-style preset.',
    turns: [
      { side: 'a', text: 'random question — did you leave a blue notebook in the kitchen yesterday?', ...d(22, 55) },
      { side: 'b', text: 'omg yes that’s mine. I’ve been searching everywhere', ...d(20, 50) },
      { side: 'a', text: 'it’s on my desk — grab it whenever, no rush', ...d(25, 60) },
      { side: 'b', text: 'you’re amazing, I’ll swing by after lunch', ...d(18, 45) },
    ],
  },
];

export function getHumanDialogPreset(slug: string): HumanDialogPreset | undefined {
  return HUMAN_DIALOG_PRESETS.find((p) => p.slug === slug);
}

export function filterHumanDialogPresets(filters: {
  lang?: string;
  category?: string;
}): HumanDialogPreset[] {
  let list = HUMAN_DIALOG_PRESETS;
  const lang = filters.lang?.trim().toLowerCase();
  const category = filters.category?.trim().toLowerCase();
  if (lang === 'en' || lang === 'ru') {
    list = list.filter((p) => p.lang === lang);
  }
  if (category === 'social' || category === 'work' || category === 'support' || category === 'logistics') {
    list = list.filter((p) => p.category === category);
  }
  return list;
}

export function humanDialogPresetDetail(p: HumanDialogPreset): {
  slug: string;
  name: string;
  description: string;
  lang: HumanDialogPresetLang;
  category: HumanDialogPresetCategory;
  turnCount: number;
  defaultDelaySecMin: number;
  defaultDelaySecMax: number;
  typingSec: number;
  turns: Array<{
    side: 'a' | 'b';
    text: string;
    waitForText: string;
    delaySecMin: number;
    delaySecMax: number;
  }>;
} {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    lang: p.lang,
    category: p.category,
    turnCount: p.turns.length,
    defaultDelaySecMin: p.defaultDelaySecMin,
    defaultDelaySecMax: p.defaultDelaySecMax,
    typingSec: p.typingSec,
    turns: p.turns.map((t) => ({
      side: t.side,
      text: t.text,
      waitForText: t.waitForText ?? '',
      delaySecMin: t.delaySecMin ?? p.defaultDelaySecMin,
      delaySecMax: t.delaySecMax ?? p.defaultDelaySecMax,
    })),
  };
}

export function warmupSlotForPreset(p: HumanDialogPreset, indexInList: number): 1 | 2 | 3 {
  if (p.warmupSlot) return p.warmupSlot;
  return (((indexInList % 3) + 1) as 1 | 2 | 3);
}

export function humanDialogPresetSummary(
  p: HumanDialogPreset,
  indexInList = 0,
): {
  slug: string;
  name: string;
  description: string;
  lang: HumanDialogPresetLang;
  category: HumanDialogPresetCategory;
  turnCount: number;
  preview: string;
  warmupSlot: 1 | 2 | 3;
} {
  const first = p.turns[0]?.text ?? '';
  const preview = first.length > 90 ? `${first.slice(0, 90)}…` : first;
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    lang: p.lang,
    category: p.category,
    turnCount: p.turns.length,
    preview,
    warmupSlot: warmupSlotForPreset(p, indexInList),
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
