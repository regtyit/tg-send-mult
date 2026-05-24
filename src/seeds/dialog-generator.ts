/**
 * QA test dialog generator (Russian). For dev/seed data only — not real user simulation.
 */

export interface Participant {
  id: string;
  displayName: string;
}

export interface Message {
  from: string;
  text: string;
  /** ISO-8601 timestamp (synthetic, for ordering in fixtures). */
  at: string;
}

export interface Dialog {
  id: string;
  index: number;
  participants: [Participant, Participant];
  messages: Message[];
  locale: 'ru';
  purpose: 'qa_fixture';
}

const greetings = [
  'Привет!',
  'Привет, как дела?',
  'Доброе утро!',
  'Добрый день!',
  'Здравствуйте!',
  'Привет, как настроение?',
] as const;

const moods = [
  'нормально, спасибо',
  'неплохо, немного устал',
  'отлично, сегодня продуктивный день',
  'так себе, много дел',
  'хорошо, наконец выдалась свободная минута',
  'бодро, много планов',
] as const;

const topics = [
  'сегодня плотный график на работе',
  'разгребал задачи с утра',
  'встречи и переписка заняли полдня',
  'хотел закончить отчёт до вечера',
  'планировал спорт, но не успел',
  'день прошёл спокойно, без сюрпризов',
] as const;

const followUps = [
  'А у тебя как прошёл день?',
  'Ты много успел сегодня?',
  'Надеюсь, вечером будет поспокойнее.',
  'Звучит знакомо, у меня похоже.',
  'Главное — не перегореть к концу недели.',
  'К вечеру обычно полегче становится.',
] as const;

const smallTalk = [
  'Кстати, погода сегодня странная — то солнце, то ветер.',
  'Я вчера нашёл нормальный кофе недалеко, рекомендую.',
  'Слушал подкаст по дороге — интересная тема про привычки.',
  'В обеденный перерыв гулял пятнадцать минут, помогло.',
  'Думаю на выходных выбраться за город, если получится.',
  'Недавно перечитал старую заметку — оказалось, многое ещё актуально.',
  'Мелочь, но приятно: наконец разобрал завалы на столе.',
  'Планирую пораньше лечь, чтобы завтра не валиться с ног.',
] as const;

const closings = [
  'Ладно, побегу по делам. Хорошего дня!',
  'На связи, если что — напиши.',
  'Давай позже продолжим, сейчас отвлекусь.',
  'Спасибо за разговор, было приятно.',
  'Удачи с задачами, держись!',
  'До встречи, хорошего вечера!',
] as const;

const p2Openers = ['Привет!', 'О, привет!', 'Здравствуй!', 'Привет, рад написать!'] as const;
const p2Agree = ['Согласен.', 'Да, кстати.', 'Точно.', 'Знаю, о чём ты.', 'В точку.'] as const;
const p1Lead = ['Да,', 'В целом,', 'Если коротко —', 'Скорее да —'] as const;
const p2Lead = ['Понимаю.', 'Ясно.', 'Нормально.', 'Логично.'] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function isoAt(dialogIndex: number, msgIndex: number): string {
  const base = Date.UTC(2026, 0, 15, 9, 0, 0);
  return new Date(base + dialogIndex * 86_400_000 + msgIndex * 45_000).toISOString();
}

type Side = '1' | '2';

interface TurnSpec {
  side: Side;
  text: string;
}

/**
 * One synthetic Russian QA dialog (14–18 messages, ~7–9 per side).
 */
export function generateDialog(index = 1): Dialog {
  const p1: Participant = {
    id: `test_user_${index}_1`,
    displayName: `QA участник ${index}.1`,
  };
  const p2: Participant = {
    id: `test_user_${index}_2`,
    displayName: `QA участник ${index}.2`,
  };

  const greeting = pick(greetings);
  const mood = pick(moods);
  const topic = pick(topics);
  const closing1 = pick(closings);
  let closing2 = pick(closings);
  while (closing2 === closing1) closing2 = pick(closings);

  const extraSmallPairs = 2 + Math.floor(Math.random() * 2);
  const smallLines = Array.from({ length: extraSmallPairs }, () => pick(smallTalk));

  const core: TurnSpec[] = [
    { side: '1', text: greeting },
    {
      side: '2',
      text: `${pick(p2Openers)} У меня ${mood}. ${pick(followUps)}`,
    },
    {
      side: '1',
      text: `${pick(p1Lead)} ${mood}. Сегодня ${topic}.`,
    },
    { side: '2', text: `${pick(p2Lead)} ${pick(followUps)}` },
    {
      side: '1',
      text: `${pick(p1Lead)} ${pick(topics)}. ${pick(followUps)}`,
    },
    { side: '2', text: pick(followUps) },
  ];

  for (const line of smallLines) {
    core.push({ side: '1', text: line });
    core.push({ side: '2', text: pick(p2Agree) });
  }

  core.push({ side: '1', text: closing1 });
  core.push({ side: '2', text: closing2 });

  let turns = core;
  while (turns.length < 14) {
    turns = [
      ...turns.slice(0, turns.length - 2),
      { side: '1', text: pick(smallTalk) },
      { side: '2', text: pick(p2Agree) },
      ...turns.slice(turns.length - 2),
    ];
  }
  if (turns.length > 18) {
    turns = turns.slice(0, 16);
    turns[turns.length - 2] = { side: '1', text: closing1 };
    turns[turns.length - 1] = { side: '2', text: closing2 };
  }

  const count1 = turns.filter((t) => t.side === '1').length;
  const count2 = turns.length - count1;
  if (count1 < 7 || count1 > 9 || count2 < 7 || count2 > 9) {
    return generateDialog(index);
  }

  const messages: Message[] = turns.map((t, msgIndex) => ({
    from: t.side === '1' ? p1.id : p2.id,
    text: t.text,
    at: isoAt(index, msgIndex),
  }));

  return {
    id: `qa_dialog_${index}`,
    index,
    participants: [p1, p2],
    messages,
    locale: 'ru',
    purpose: 'qa_fixture',
  };
}

export function generateDialogs(count: number): Dialog[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => generateDialog(i + 1));
}
