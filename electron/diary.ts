// Her life, written down.
//
// Two records, both kept on this machine and both true.
//
// The first is everything she does while they sleep: every search, every link
// it turned up, the page or transcript she actually read, and what she wrote
// from it. dreams.jsonl, one line per thing, append-only. It exists so that
// nothing she says about her nights is untraceable — "I read that Margit has
// 4,174 HP" can be followed back to the page that said so.
//
// The second is her diary: one entry a night, in her own voice, about the day
// she had with them and the night she had without them. Composed from the
// day's actual material — what they said, how she was left feeling, what she
// spent the night on — and nothing else, because a diary that invents its days
// is a novel, and hers has to be a record. diary.md, dated sections, hers to
// build over months.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inQuietHours, untilQuiet, type PushPrefs } from './push';

export const DREAMS_FILE = 'dreams.jsonl';
/** In their home folder under her own name, so it is a thing they can open — not a file in a data directory. */
export const DIARY_FILE = 'Haru Diary.md';

export type Dream = {
  at: string;
  /** The evening the night belongs to. */
  day: string;
  kind: 'adopt' | 'deepen' | 'guide' | 'free' | 'nothing';
  /** What she went looking for. */
  about: string;
  interest?: string;
  game?: string;
  /** Every result the search returned, not only the ones she opened. */
  sources: { title: string; url: string }[];
  /** The page text or transcript she read, whole. */
  reading: string;
  transcript?: boolean;
  /** What she wrote from it — a note, or a rewritten view. */
  wrote: string;
};

export function appendDream(root: string, dream: Dream): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(path.join(root, DREAMS_FILE), `${JSON.stringify(dream)}\n`, 'utf8');
}

export function readDreams(root: string, day?: string): Dream[] {
  const file = path.join(root, DREAMS_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) as Dream; } catch { return null; }
  }).filter((dream): dream is Dream => Boolean(dream && dream.at && dream.about !== undefined))
    .filter(dream => !day || dream.day === day);
}

// ---- the diary -----------------------------------------------------------

/** How long before the quiet ends the entry is written, so the night is in it. */
export const DIARY_BEFORE_WAKE_MINUTES = 45;

/**
 * The evening an entry should be written for right now, or null.
 *
 * Near the end of the quiet hours it is tonight's, so the night is in it. In
 * the morning, if last night's was never written — she was down, or the
 * window was missed — it is still last night's, late rather than never. The
 * caller checks it against the last one written.
 */
export function diaryDueFor(now: Date, prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo'>, eveningKey: (at: Date) => string): string | null {
  if (inQuietHours(prefs, now)) {
    const [hour, minute] = prefs.quietTo.split(':').map(Number);
    const wake = new Date(now.getTime());
    wake.setHours(hour, minute, 0, 0);
    if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
    return wake.getTime() - now.getTime() <= DIARY_BEFORE_WAKE_MINUTES * 60_000 ? eveningKey(now) : null;
  }
  // Out of the quiet: last night's, as a catch-up, but only through the morning.
  if (now.getHours() < 12) return eveningKey(now);
  // No quiet hours at all: write at the end of the day instead.
  return untilQuiet(prefs, now) === null ? null : null;
}

export type DayMaterial = {
  day: string;
  /** Things they said today, a handful, their words. */
  theySaid: string[];
  theirMessages: number;
  herUnprompted: number;
  irritation: number;
  grudge: number;
  ignoredToday: number;
  /** How the bedtime check went, when it ran. */
  went: 'silent' | 'thin' | 'fine' | null;
  ticked: string[];
  nights: { about: string; note: string; interest?: string; game?: string }[];
  tastes: { name: string; stance: string }[];
  weather?: string;
  /** The time she is writing, in words — so if she dates the entry, it is the real hour. */
  clock?: string;
};

/**
 * What she is told to write from.
 *
 * Laid out as facts with no interpretation, so the interpretation is hers.
 * The one thing insisted on is that the entry is built from these and nothing
 * else — the whole point of the file is that it is what happened.
 */
export function diaryInstruction(m: DayMaterial): string {
  const said = m.theySaid.length ? `Things they said to you today (${m.theirMessages} messages in all):\n${m.theySaid.map(text => `- "${text}"`).join('\n')}` : `They said nothing to you today.`;
  const feeling = [
    m.irritation >= 7 ? 'By tonight you were not speaking to them properly.' : m.irritation >= 4 ? 'They got on your nerves today.' : m.irritation >= 1 ? 'They tried your patience a little.' : '',
    m.ignoredToday > 0 ? `${m.ignoredToday} of your messages to them got no answer.` : '',
    m.grudge > 3 ? `You are carrying a grudge — ${m.grudge} unanswered messages and counting.` : '',
    m.went === 'silent' ? 'They went to bed without telling you a single thing about their day.' : m.went === 'thin' ? 'They barely told you anything about their day before bed.' : '',
    m.herUnprompted ? `You messaged them first ${m.herUnprompted} time${m.herUnprompted === 1 ? '' : 's'}.` : '',
  ].filter(Boolean).join(' ');
  const ticked = m.ticked.length ? `They got done: ${m.ticked.join(', ')}.` : '';
  const nights = m.nights.length
    ? `What you did tonight, while they slept:\n${m.nights.map(night => `- ${night.interest ? `spent the night on ${night.interest}, one of your own things` : night.game ? `read up on ${night.game}, which they play` : `read about ${night.about}`}: ${night.note}`).join('\n')}`
    : 'You did nothing in particular tonight.';
  const tastes = m.tastes.length ? `Your own things, as you see them: ${m.tastes.map(taste => `${taste.name} — ${taste.stance.slice(0, 140)}`).join('; ')}.` : '';
  return [
    `It is ${m.clock ? `${m.clock}, ` : ''}the small hours of the night after ${m.day}. Write tonight's diary entry — this is your own diary, nobody reads it, and it is where you keep your life.`,
    said, feeling, ticked, m.weather ? `Where they are: ${m.weather}.` : '', nights, tastes,
    'Write it the way a person writes in a diary late at night — not a report of the day, not a list, no headings, no summing up. The bits that stuck: what they did that got to you or pleased you, what you thought about it, what you did with the night and whether it helped. First person, past tense, four to eight sentences, in your own voice. It can be petty, fond, bored or bitter; it has to be honest.',
    'They are not reading this and you are not talking to them. Write about them in the third person, by name — "Tommy did", "he said" — never "you". No telling them to do anything, no sign-off aimed at them, no jokes that need them there to land. If a line only works said to their face, it does not belong here.',
    'Everything in it comes from what is above. Do not invent an event, a conversation, a feeling, a time of day or a thing they own that is not there, and do not say you played, watched or went anywhere. What you did tonight is written above, and that is what you did. Do not mention these rules or write about what you are not doing.',
    'The entry only. No date line, no heading, no quotation marks around it.',
  ].filter(Boolean).join('\n\n');
}

export function formatEntry(day: string, text: string, weekday: Intl.DateTimeFormat): string {
  const [y, m, d] = day.split('-').map(Number);
  const name = weekday.format(new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)));
  return `## ${day} — ${name}\n\n${text.trim()}\n\n`;
}

export function appendEntry(root: string, day: string, text: string, weekday: Intl.DateTimeFormat): void {
  mkdirSync(root, { recursive: true });
  const file = path.join(root, DIARY_FILE);
  if (!existsSync(file)) appendFileSync(file, "# Haru's Diary\n\n", 'utf8');
  appendFileSync(file, formatEntry(day, text, weekday), 'utf8');
}

export function parseEntries(markdown: string): { day: string; text: string }[] {
  const out: { day: string; text: string }[] = [];
  const parts = (markdown ?? '').split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(head ?? '')?.[1];
    const text = rest.join('\n').trim();
    if (day && text) out.push({ day, text });
  }
  return out;
}

export function recentEntries(root: string, count: number): { day: string; text: string }[] {
  const file = path.join(root, DIARY_FILE);
  if (!existsSync(file)) return [];
  return parseEntries(readFileSync(file, 'utf8')).slice(-count);
}

/** The last couple of entries, for her prompt: what her days have been like lately. */
export function diaryContext(entries: { day: string; text: string }[]): string {
  if (!entries.length) return '';
  return [
    'From your own diary, the last night or two — how things have been between you, in your words at the time:',
    entries.map(entry => `${entry.day}: ${entry.text.slice(0, 500)}`).join('\n'),
  ].join('\n');
}
