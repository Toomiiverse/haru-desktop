import {corePolicySync} from './core-policy-sync';
// The journal.
//
// One entry a day, written either because she asked or because you sat down and
// wrote it. Kept apart from her memory on purpose: memories are things she knows
// about you and reads back into every conversation, whereas this is yours. She
// can be told to look at it; she does not carry it around.
//
// The ratings are self-report, the way a paper mood diary is — a number you pick
// because it feels right today. They are not a screening test and nothing here
// scores or interprets them. What makes them worth keeping is the shape over
// weeks, which is exactly the thing that is impossible to recall accurately and
// genuinely useful to put in front of someone you see once a month.

/** 0–10, the scale people already use out loud: "about a four today". */
export const SCALE_MAX = 10;

export type JournalEntry = {
  id: string;
  /** YYYY-MM-DD. One entry per day — a second save on the same day edits it. */
  date: string;
  createdAt: string;
  updatedAt?: string;
  text: string;
  mood?: number;
  anxiety?: number;
  energy?: number;
  sleep?: number;
  /** True when she prompted it, false when it was written unprompted. Worth
   *  knowing later: entries dragged out of you read differently from ones you sat
   *  down to write. */
  prompted: boolean;
};

export type JournalConfig = {
  enabled: boolean;
  /** Hour of the evening she may ask, 0–23. Before this she leaves it alone. */
  askHour: number;
  /** Whether she raises it at all, or waits to be come to. */
  askUnprompted: boolean;
};

export const DEFAULT_JOURNAL: JournalConfig = { enabled: false, askHour: 20, askUnprompted: true };

export function readJournalConfig(saved: unknown): JournalConfig {
  return corePolicySync<JournalConfig>('user-records.readConfig',[saved]);
}

/** Clamped and rounded, or dropped entirely. A rating is optional — an entry with
 *  words and no numbers is still an entry, and a half-filled slider should not
 *  become a 0, which on these scales means something specific. */
export function readRating(value: unknown): number | undefined {
  return corePolicySync<number|null>('user-records.rating',[value])??undefined;
}

export function readEntries(saved: unknown): JournalEntry[] {
  return corePolicySync<JournalEntry[]>('user-records.readEntries',[saved,new Date().toISOString()]);
}

/** Today's entry, if there is one. The whole once-a-day rule rests on this. */
export function entryFor(entries: JournalEntry[], date: string) {
  return corePolicySync<JournalEntry|null>('user-records.entryFor',[entries,date])??undefined;
}

/**
 * Writes an entry, replacing the day's existing one rather than stacking a
 * second. Ratings left undefined keep whatever was already there, so she can add
 * a mood to something you typed earlier without wiping the words.
 */
export function upsertEntry(entries: JournalEntry[], entry: Omit<JournalEntry, 'id' | 'createdAt'> & { id?: string }): JournalEntry[] {
  return corePolicySync<JournalEntry[]>('user-records.upsert',[entries,entry,new Date().toISOString()]);
}

/**
 * Whether she should raise it now. Deliberately conservative — she gets one run
 * at it per day, in the evening, and only if nothing is written yet. A journal
 * she nags about is one you stop keeping.
 */
export function shouldAsk(config: JournalConfig, entries: JournalEntry[], now: Date, today: string, askedToday: string | undefined) {
  return corePolicySync<boolean>('user-records.shouldAsk',[config,entries,now.getHours(),today,askedToday]);
}

const RATING_WORDS = ['flat on the floor', 'awful', 'bad', 'low', 'below par', 'middling', 'alright', 'good', 'really good', 'great', 'the best it gets'];

/** A number said as a person would say it, for lines she speaks aloud. */
export function describeRating(value: number | undefined) {
  return corePolicySync<string>('user-records.describeRating',[value]);
}

export type Trend = { days: number; mood?: number; anxiety?: number; entries: number };

/**
 * The last fortnight in one shape. Averages only, and only over days that
 * actually carry a rating — a fortnight with three entries should read as three
 * entries, not as eleven days of zero.
 */
export function recentTrend(entries: JournalEntry[], today: string, days = 14): Trend {
  return corePolicySync<Trend>('user-records.trend',[entries,today,days]);
}

// Where a rating stops being unremarkable. Deliberately near the ends: she
// should change how she treats you when a day is genuinely bad, not tune herself
// against every wobble. A 5 is a Tuesday.
const LOW = 3;
const HIGH = 7;

/**
 * How the last entry should change the way she behaves.
 *
 * Only today's or yesterday's — a rough Monday should not still be softening her
 * on Thursday, and sleep in particular is rated at night about the night before,
 * so it has to carry over one day to be any use at all.
 *
 * Every line here modulates her rather than replacing her. Told plainly to be
 * kind she stops being Haru, and a companion who turns into a different person
 * the moment you admit to a bad day is one you stop telling about bad days.
 */
export function journalStance(entries: JournalEntry[], today: string): string {
  return corePolicySync<string>('user-records.stance',[entries,today]);
}

export type RangeName = 'week' | 'fortnight' | 'month';
export const RANGE_DAYS: Record<RangeName, number> = { week: 7, fortnight: 14, month: 30 };

export type FieldName = 'mood' | 'anxiety' | 'energy' | 'sleep';
export const FIELDS: FieldName[] = ['mood', 'anxiety', 'energy', 'sleep'];

export type FieldStats = { average?: number; lowest?: number; highest?: number; rated: number; change?: number };
export type RangeStats = {
  days: number;
  /** Days in the window that have an entry at all. */
  written: number;
  /** Days running up to today with an entry — the number people actually care about. */
  streak: number;
  fields: Record<FieldName, FieldStats>;
  /** One point per day in the window, oldest first, so a chart needs no date maths. */
  series: { date: string; mood?: number; anxiety?: number; energy?: number; sleep?: number; written: boolean }[];
};

/**
 * A window of days, with a point for every day rather than only the written
 * ones. A chart drawn from entries alone silently closes the gaps and turns
 * three entries in a fortnight into an unbroken line, which is a lie about how
 * often someone wrote.
 */
export function rangeStats(entries: JournalEntry[], today: string, range: RangeName): RangeStats {
  return corePolicySync<RangeStats>('user-records.stats',[entries,today,range]);
}

/**
 * Consecutive days with an entry, counting back from today. Today not being
 * written yet does not break a streak — it is still early — so the count starts
 * from yesterday in that case rather than resetting to zero at every midnight.
 */
export function streakEndingToday(entries: JournalEntry[], today: string): number {
  return corePolicySync<number>('user-records.streak',[entries,today]);
}

/** Consecutive days ending today on which one particular thing was rated. */
export function fieldStreak(entries: JournalEntry[], today: string, field: FieldName): number {
  return corePolicySync<number>('user-records.streak',[entries,today,field]);
}

export type HaruNote = { tone: 'proud' | 'pleased' | 'watching' | 'grumpy'; text: string };

const FIELD_WORDS: Record<FieldName, string> = { mood: 'your mood', anxiety: 'your anxiety', energy: 'your energy', sleep: 'your sleep' };

/**
 * What she makes of your journalling, said in her own voice.
 *
 * Written here rather than generated, on purpose. This sits in a panel that has
 * to render the instant the page opens, it must say the same thing if you look
 * twice, and it is arithmetic about streaks — none of which wants a model. Her
 * voice lives in the wording, not in the sampling.
 */
export function haruNote(entries: JournalEntry[], today: string): HaruNote {
  return corePolicySync<HaruNote>('user-records.note',[entries,today]);
}

function shiftDays(dateKey: string, delta: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * What she is told about the journal, and it is deliberately thin. She gets
 * whether today is written and roughly how the fortnight has gone — enough to
 * ask a question that is not insultingly generic — and never the entries
 * themselves. What you wrote in a journal is not conversational material she
 * should be quoting back at you unprompted.
 */
export function journalPrompt(config: JournalConfig, entries: JournalEntry[], today: string): string {
  return corePolicySync<string>('user-records.prompt',[config,entries,today]);
}
