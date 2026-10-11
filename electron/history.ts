import {corePolicySync} from './core-policy-sync';
// Telling old messages from new ones.
//
// Every message in the store carried `time: "now"` — the literal string, on all
// of them, for ever. It is what the bubble prints, and nothing anywhere recorded
// when anything was actually said. So the conversation handed to the model is a
// flat wall of text in which a line from last Tuesday at midnight sits flush
// against one from thirty seconds ago, indistinguishable.
//
// That is the mechanism behind a whole family of complaints, not one bug. Her
// own past assertions never expire: a marketing campaign she invented once was
// still "the campaign I was talking about earlier" two days later, and a remark
// framed for eleven at night reads as current at breakfast. She is not
// misremembering. She is reading something with no date on it and correctly
// concluding it is now.
//
// The fix is not to hide the old messages — the history is worth having — but to
// say plainly where the seams are.

import { zonedNow } from './dates';

export type Dated = { role: string; content: string; at?: string };

/** Below this a gap is just someone thinking, and marking it would be noise. */
export const GAP_MINUTES = 90;

const MINUTE = 60_000;

/**
 * Both instants read in the user's zone before anything is compared.
 *
 * "The next morning" is a statement about their day, and their day happens
 * somewhere. Read with the machine's own getters instead — which is what this
 * did — a night that ran from 20:00 to 06:00 Perth is 12:00 to 22:00 on a UTC
 * server: one calendar day, ten hours apart, and she was told an overnight
 * silence was an afternoon lull. The hour test misread the same way, calling
 * eight in the evening "the next afternoon".
 */
function inZone(at: Date, timeZone: string): Date {
  return zonedNow(timeZone, at);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * How to describe a gap, from the later message's point of view.
 *
 * Relative rather than absolute — "the next morning" is what a person would say,
 * and a bare timestamp invites her to read it out. The one exception is a gap
 * long enough that "later" stops being meaningful.
 */
export function describeGap(before: Date, after: Date, timeZone: string): string {
  return corePolicySync<any>('conversation-policy.describeGap',[before.toISOString(),after.toISOString(),timeZone]);
}

/**
 * The same conversation with the seams named.
 *
 * A note goes in as a system message rather than being glued onto the next line,
 * so it cannot be mistaken for something either of them said — and so that a
 * model which ignores it is no worse off than before.
 *
 * Undated messages are passed through untouched. Everything already in the store
 * predates this and has no timestamp to reason from; guessing one would be worse
 * than the flatness being fixed.
 */
export function markTimeGaps<T extends Dated>(messages: T[], timeZone: string, gapMinutes = GAP_MINUTES): (T | { role: 'system'; content: string })[] {
  return corePolicySync<any>('conversation-policy.markTimeGaps',[messages,timeZone,gapMinutes]);
}

/**
 * How long ago the last thing was said, for the composers that speak first.
 *
 * She opens conversations, and an opening line written as though the last
 * exchange were still warm is the same failure seen from the other end.
 */
export function sinceLast(messages: Dated[], now: Date, timeZone: string): string {
  return corePolicySync<any>('conversation-policy.sinceLast',[messages,now.toISOString(),timeZone]);
}

/** Days of finished conversation put in front of today's. */
export const DAYS_OF_HISTORY = 3;
/**
 * What those days may take, in characters.
 *
 * The model's window is a million tokens and she was being handed six and a
 * half thousand, of which the conversation itself was one thousand — everything
 * said before this morning left the prompt at the five o'clock rollover and was
 * replaced by a one-line summary of the day. Thirty days and two and a half
 * thousand messages sat on disk unread.
 *
 * The ceiling is not the hosted model's window but the local one's, which
 * answers when the hosted route is down: twenty thousand tokens for everything,
 * so this takes about five and leaves room for the brief and for the day itself.
 */
export const HISTORY_BUDGET_CHARS = 20_000;

/**
 * The finished days before today, newest last, trimmed from the oldest end to
 * fit the budget. Whole exchanges only — half a conversation reads worse than
 * none — so the trim drops from the front and never mid-day.
 */
export function earlierTurns<T extends Dated>(archive: Record<string, T[]>, todayKey: string, days = DAYS_OF_HISTORY, budget = HISTORY_BUDGET_CHARS): T[] {
  return corePolicySync<any>('conversation-policy.earlierTurns',[archive,todayKey,days,budget]);
}

/** The one-line note a finished day was distilled into (summariseSession). */
export type DayNote = { day: string; summary: string };

/** A finished month, folded from its day notes (foldMonth). */
export type MonthNote = { month: string; summary: string; createdAt?: string };

/**
 * The finished days before today, from her own one-line notes — newest last.
 *
 * Each day is distilled once at the five o'clock roll, so a note exists for
 * every day that was actually over while she was running. They are compact,
 * byte-stable per day (which keeps the cached head stable), and written in
 * her voice, so the prompt can hold a week of them for a tenth of what three
 * days of raw turns cost.
 */
export function earlierDayNotes(sessions: DayNote[], todayKey: string, days = 7): DayNote[] {
  return corePolicySync<any>('conversation-policy.earlierDayNotes',[sessions,todayKey,days]);
}

/**
 * The finished months before the current one, from her own folds — newest
 * last. Each is the whole of a month in one line, so the prompt can hold six
 * of them for the price of a single day's raw turns.
 */
export function earlierMonthNotes(monthNotes: MonthNote[], todayKey: string, count = 6): MonthNote[] {
  return corePolicySync<any>('conversation-policy.earlierMonthNotes',[monthNotes,todayKey,count]);
}

/**
 * The earlier-days context for the chat prompt: her one-line notes for the
 * days that have them, her folded notes for the months before them, and raw
 * turns (via earlierTurns) for the days that have neither — a day is only
 * distilled once it is actually over, so yesterday can still be raw before the
 * roll, or raw for ever if the model was down that night. Notes become a
 * single system message in the prompt; raw turns flow through the same seams
 * as today's.
 */
export function earlierDaysContext(
  sessions: DayNote[],
  monthNotes: MonthNote[],
  archive: Record<string, unknown[]>,
  todayKey: string,
  opts: { days?: number; months?: number; budget?: number; turnsDays?: number } = {},
): { notes: string[]; turns: Dated[] } {
  return corePolicySync<any>('conversation-policy.earlierDaysContext',[sessions,monthNotes,archive,todayKey,opts]);
}

