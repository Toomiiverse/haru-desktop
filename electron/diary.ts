import {corePolicySync} from './core-policy-sync';
import { coreStoreFor } from './core-store';
// Her life, written down.
//
// Two records, held in Core when primary storage is on and published to the
// vault by the app. The legacy backend uses the paths described below.
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
  const core = coreStoreFor(root);
  if (core) { core.set('dreams', core.get('dreams', '') + JSON.stringify(dream) + '\n'); return; }
  mkdirSync(root, { recursive: true });
  appendFileSync(path.join(root, DREAMS_FILE), `${JSON.stringify(dream)}\n`, 'utf8');
}

export function readDreams(root: string, day?: string): Dream[] {
  const file = path.join(root, DREAMS_FILE);
  const core = coreStoreFor(root);
  if (!core && !existsSync(file)) return [];
  return (core ? core.get('dreams', '') as string : readFileSync(file, 'utf8')).split('\n').filter(Boolean).map(line => {
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
  return corePolicySync('diary.dueFor',[now,prefs]);
}

export type DayMaterial = {
  day: string;
  /** Set when nothing has been written since the reset: this is page one (blankslate.ts). */
  firstAfterReset?: boolean;
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
  return corePolicySync('diary.instruction',[m]);
}

export type Entry = { day: string; title: string; text: string };

/** A title she did not give: the first sentence, cut to fit a tab. */
export function entryTitle(text: string, given?: string): string {
  return corePolicySync('diary.entryTitle',[text,given??null]);
}

export function formatEntry(day: string, text: string, weekday: Intl.DateTimeFormat, title?: string): string {
  return corePolicySync('diary.formatEntry',[day,text,title??null]);
}

export function appendEntry(root: string, day: string, text: string, weekday: Intl.DateTimeFormat, title?: string): void {
  mkdirSync(root, { recursive: true });
  const file = path.join(root, DIARY_FILE);
  const core = coreStoreFor(root);
  if (core) { core.set('diary', (core.get('diary', '') || "# Haru's Diary\n\n") + formatEntry(day, text, weekday, title)); return; }
  if (!existsSync(file)) appendFileSync(file, "# Haru's Diary\n\n", 'utf8');
  appendFileSync(file, formatEntry(day, text, weekday, title), 'utf8');
}

export function parseEntries(markdown: string): Entry[] {
  return corePolicySync('diary.parseEntries',[markdown]);
}

export function recentEntries(root: string, count: number): Entry[] {
  const file = path.join(root, DIARY_FILE);
  const core = coreStoreFor(root);
  if (core) return parseEntries(core.get('diary', '')).slice(-count);
  if (!existsSync(file)) return [];
  return parseEntries(readFileSync(file, 'utf8')).slice(-count);
}

/** The last couple of entries, for her prompt: what her days have been like lately. */
export function diaryContext(entries: { day: string; text: string }[]): string {
  return corePolicySync('diary.context',[entries]);
}
