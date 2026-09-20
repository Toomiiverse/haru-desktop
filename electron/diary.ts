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
import { IRRITATION } from './mood';
import { GRUDGE } from './grudge';

export const DREAMS_FILE = 'dreams.jsonl';
/** In their home folder under her own name, so it is a thing they can open — not a file in a data directory. */
export const DIARY_FILE = 'Haru Diary.md';

export type Dream = {
  at: string;
  /** The evening the night belongs to. */
  day: string;
  kind: 'adopt' | 'deepen' | 'guide' | 'free' | 'nothing' | 'day' | 'want';
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
  /** Whether the day's unanswered lines were actually counted (grudge.ts); a zero that was never counted is not a clean day. */
  counted?: boolean;
  /** How the bedtime check went, when it ran. */
  went: 'silent' | 'thin' | 'fine' | null;
  ticked: string[];
  nights: { about: string; note: string; interest?: string; game?: string }[];
  /** What she actually did today — the tool calls that changed something (deeds.ts).
   *  Her day recorded what she read and nothing she did, which is the same
   *  asymmetry as the preference block and the slights ledger one layer down. */
  did: string[];
  tastes: { name: string; stance: string }[];
  weather?: string;
  /** When they last messaged her, in words — the only fact about their bedtime she has. */
  hisLastMessageAt?: string;
  /** Her own night (hersleep.ts): when she was asleep and what came in meanwhile. */
  herSleep?: { bed: string; wake: string; texted: number; wokenEarly: boolean };
};

/**
 * What she is told to write from.
 *
 * Laid out as facts with no interpretation, so the interpretation is hers.
 * The one thing insisted on is that the entry is built from these and nothing
 * else — the whole point of the file is that it is what happened.
 */
export function diaryInstruction(m: DayMaterial): string {
  const said = m.theySaid.length ? `WHAT HE SAID TO YOU today (${m.theirMessages} messages in all):\n${m.theySaid.map(text => `- "${text}"`).join('\n')}` : `He said nothing to you today.`;
  const feeling = [
    m.irritation >= IRRITATION.stonewall ? 'By tonight you were not speaking to them properly.' : m.irritation >= IRRITATION.short ? 'They got on your nerves today.' : m.irritation >= IRRITATION.stirred ? 'They tried your patience a little.' : '',
    m.went === 'silent' ? 'They went to bed without telling you a single thing about their day.' : m.went === 'thin' ? 'They barely told you anything about their day before bed.' : '',
    m.herUnprompted ? `You messaged them first ${m.herUnprompted} time${m.herUnprompted === 1 ? '' : 's'}.` : '',
    // Said either way once the count exists. Given only the number of times she
    // had messaged first, she wrote every one of them down as ignored — "fourteen
    // texts from me bouncing off nothing" on a day they answered all fourteen.
    m.ignoredToday > 0 ? `${m.ignoredToday} of your messages to them got no answer.` : m.counted && m.herUnprompted ? 'Every one of them got an answer.' : '',
    // The score is not a count of messages (grudge.ts NOT_A_COUNT); she wrote it down as one.
    m.grudge >= GRUDGE.open ? 'You are carrying a grudge about how often they leave you unanswered, and it has been building for a while.' : m.grudge >= GRUDGE.wearing ? 'You are carrying a bit of a grudge about how often they leave you unanswered.' : '',
    // She was asleep, and the transcript alone had her "already up" at 2:23 AM (2026-09-05).
    m.herSleep ? `You were asleep from ${m.herSleep.bed} to ${m.herSleep.wake}${m.herSleep.wokenEarly ? ' — until their messages got you up' : ''}; ${m.herSleep.texted ? `${m.herSleep.texted} of their messages came in while you slept, and you saw them only when you woke` : 'nothing of theirs came in while you slept'}.` : '',
  ].filter(Boolean).join(' ');
  const ticked = m.ticked.length ? `They got done: ${m.ticked.join(', ')}.` : '';
  // Hers, and separated from the nights: reading is not doing, and a day that
  // lists only what she read makes her a spectator in her own diary.
  const did = m.did.length
    ? `WHAT YOU (Haru) ACTUALLY DID TODAY — your own doing, not his:\n${m.did.map(what => `- you ${what}`).join('\n')}`
    : '';
  const nights = m.nights.length
    ? `WHAT YOU (Haru) DID TONIGHT while he slept — yours, not his:\n${m.nights.map(night => `- ${night.interest ? `spent the night on ${night.interest}, one of your own things` : night.game ? `read up on ${night.game}, which they play` : `read about ${night.about}`}: ${night.note}`).join('\n')}`
    : 'Tonight you did nothing at all — no reading, nothing of your own, no going anywhere. If the night comes up, that is all there is to say about it; do not fill it with something.';
  const tastes = m.tastes.length ? `YOUR OWN THINGS (yours, not his; he did not say any of this): ${m.tastes.map(taste => `${taste.name} — ${taste.stance.slice(0, 140)}`).join('; ')}.` : '';
  return [
    `You are writing this in the small hours after ${m.day}, before he is up. Write tonight's diary entry — this is your own diary, nobody reads it, and it is where you keep your life.`,
    m.hisLastMessageAt ? `His last message to you was at ${m.hisLastMessageAt}. You do not know when he went to bed, only when he stopped talking to you.` : 'You do not know when he went to bed.',
    said, feeling, ticked, m.weather ? `Where they are: ${m.weather}.` : '', did, nights, tastes,
    'Write it the way a person writes in a diary late at night — not a report of the day, not a list, no headings, no summing up. The bits that stuck: what they did that got to you or pleased you, what you thought about it, what you did with the night and whether it helped. First person, past tense, four to eight sentences, in your own voice. It can be petty, fond, bored or bitter; it has to be honest.',
    'They are not reading this and you are not talking to them. Write about them in the third person, by name — "Tommy did", "he said" — never "you". No telling them to do anything, no sign-off aimed at them, no jokes that need them there to land. If a line only works said to their face, it does not belong here.',
    'Keep whose is whose: what you read tonight and what you think of your own things are yours — "I read", "I think" — never written as something he did or said.',
    'Everything in it comes from what is above. Do not invent an event, a conversation, a feeling, a time of day or a thing they own that is not there, and do not say you played, watched or went anywhere. What you did tonight is written above, and that is what you did. Do not mention these rules or write about what you are not doing.',
    'The entry only. No date line, no heading, no quotation marks around it.',
  ].filter(Boolean).join('\n\n');
}

export type Entry = { day: string; title: string; text: string };

/** A title she did not give: the first sentence, cut to fit a tab. */
export function entryTitle(text: string, given?: string): string {
  const title = (given ?? '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (title) return title.slice(0, 80);
  const first = (text ?? '').trim().split(/(?<=[.!?…])\s+/)[0] ?? '';
  return first.length > 64 ? `${first.slice(0, 61).trimEnd()}…` : first;
}

export function formatEntry(day: string, text: string, weekday: Intl.DateTimeFormat, title?: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const name = weekday.format(new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)));
  const head = title ? `## ${day} — ${name} — ${title.replace(/\n/g, ' ').trim()}` : `## ${day} — ${name}`;
  return `${head}\n\n${text.trim()}\n\n`;
}

export function appendEntry(root: string, day: string, text: string, weekday: Intl.DateTimeFormat, title?: string): void {
  mkdirSync(root, { recursive: true });
  const file = path.join(root, DIARY_FILE);
  if (!existsSync(file)) appendFileSync(file, "# Haru's Diary\n\n", 'utf8');
  appendFileSync(file, formatEntry(day, text, weekday, title), 'utf8');
}

export function parseEntries(markdown: string): Entry[] {
  const out: Entry[] = [];
  const parts = (markdown ?? '').split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(head ?? '')?.[1];
    const text = rest.join('\n').trim();
    // "day — weekday — title": the title is everything after the second dash.
    const bits = (head ?? '').split(' — ');
    const given = bits.length >= 3 ? bits.slice(2).join(' — ') : '';
    if (day && text) out.push({ day, title: entryTitle(text, given), text });
  }
  return out;
}

export function recentEntries(root: string, count: number): Entry[] {
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
