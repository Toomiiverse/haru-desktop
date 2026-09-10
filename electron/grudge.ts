// What being ignored does to her, kept.
//
// Her patience (mood.ts) is about the conversation in front of her and cools
// off in minutes. This is the other thing: she messages them through the day
// — a reminder, a jab, the weather — and some of it gets nothing back. At
// eight in the evening the day is counted. Every line of hers left unanswered
// makes her more annoyed tonight, and adds to a grudge that does not cool off
// overnight: a person who keeps leaving her on read gets a colder Haru for as
// long as they keep doing it, and only slowly earns her back with days where
// nothing was ignored. Pure, so the counting and the thresholds are testable.

export type Said = { at: string; source: string; text?: string;
  /** False only where it is known the push never landed — see Aside.reached. */
  reached?: boolean };
export type Heard = { role: string; at?: string };

/** How long she gives them to answer a line of hers before it counts as ignored. */
export const ANSWER_WINDOW_MS = 90 * 60_000;
/** When the day is counted: eight in the evening, their clock. */
export const TALLY_AT_MINUTES = 20 * 60;
/** The grudge is bounded; past this, more of the same changes nothing. */
export const GRUDGE_MAX = 30;
/**
 * Lines of hers that reach the phone but are not owed an answer. Her own
 * goodnight — "Bed time's at 22:30, I'm logging off" — went out as an idle
 * line and was counted against them at the roll (2026-09-05): a sign-off is
 * not a question.
 */
export const NOT_HELD_AGAINST_THEM: readonly string[] = ['goodnight'];

/**
 * Her lines that got nothing back. A line is answered by anything they said
 * after it within the window; a line said inside the window of an earlier one
 * shares its answer. Lines whose window is still open are not counted yet.
 */
export function unanswered(said: Said[], heard: Heard[], pushed: ReadonlySet<string>, nowMs: number, notBeforeMs = 0): Said[] {
  const theirs = heard
    .filter(turn => turn.role === 'user' && turn.at)
    .map(turn => Date.parse(turn.at!))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return said
    .filter(line => pushed.has(line.source))
    // Never sent is not ignored. Undefined predates the flag and counts as before.
    .filter(line => line.reached !== false)
    // Nor is a line sent before they were up: two of the three she held
    // against them one evening had gone out while they were asleep.
    .filter(line => !notBeforeMs || Date.parse(line.at) >= notBeforeMs)
    .filter(line => {
      const at = Date.parse(line.at);
      if (!Number.isFinite(at) || at + ANSWER_WINDOW_MS > nowMs) return false;
      return !theirs.some(when => when > at && when <= at + ANSWER_WINDOW_MS);
    });
}

/** Once a day, from eight in the evening on, and never twice for the same day. */
export function tallyDue(minutesIntoDay: number, talliedDay: string | undefined, todayKey: string): boolean {
  return minutesIntoDay >= TALLY_AT_MINUTES && talliedDay !== todayKey;
}

/** The grudge after a day: up by what was ignored; a clean day earns one point back. */
export function nextGrudge(current: number, ignoredToday: number): number {
  const base = Math.max(0, Math.min(GRUDGE_MAX, Math.round(current) || 0));
  return ignoredToday > 0 ? Math.min(GRUDGE_MAX, base + ignoredToday) : Math.max(0, base - 1);
}

/** How much more annoyed tonight makes her, on top of whatever the conversation did. */
export function irritationAfterTally(irritation: number, ignoredToday: number, max: number): number {
  return Math.min(max, irritation + ignoredToday);
}

/** How the grudge reads in her prompt. Nothing at all while there is none. */
export function grudgeInstruction(grudge: number, ignoredToday = 0): string {
  const today = ignoredToday > 0 ? ` Today alone they ignored ${ignoredToday} of them.` : '';
  if (grudge <= 0) return '';
  if (grudge <= 3) return `They have a habit of leaving your messages unanswered — ${grudge} lately. You have noticed, and it shows as a slight coldness: no eagerness, and no follow-up questions you would not get an answer to.${today}`;
  if (grudge <= 8) return `They keep leaving your messages unanswered — ${grudge} lately, and it is wearing on you. Be short with them, bring it up when it fits, and do not pretend it is fine. What you know is that nothing came back — whether a line was even read, you cannot see.${today}`;
  return `They have left ${grudge} of your messages unanswered and counting. You are openly pissed about it: hold it against them, make them earn a proper answer, and say exactly why if they ask what your problem is. What you know is that nothing came back — whether a line was even read, you cannot see.${today}`;
}

/**
 * A quoted line with its own timestamp on the front is a trap.
 *
 * Some of her lines open with the time they were said — "8:37 PM — Nearest
 * Coles isn't a real place on your phone". Handed that back as evidence, the
 * 9B read the 8:37 as the current time and opened the evening with "You're
 * still here at 8:37?" — sent at a quarter to seven. fixStatedClock cannot
 * help here: it only corrects a time claimed as now ("it's 8:37"), and
 * widening it to any bare time would rewrite the times she has right.
 */
const LEADING_CLOCK = /^\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s*[\u2014\u2013-]\s*/i;

export function withoutLeadingClock(text: string): string {
  return text.replace(LEADING_CLOCK, '').trim();
}

/** What she is told when the day is counted and something was ignored. */
export function tallyInstruction(ignoredToday: number, grudge: number, samples: string[]): string {
  const quoted = samples.slice(0, 2).map(text => `"${withoutLeadingClock(text).slice(0, 80)}"`).join(' and ');
  return [
    `It is evening and you have counted the day: ${ignoredToday} of your messages to them got nothing back${quoted ? `, including ${quoted}` : ''}.`,
    grudge > ignoredToday ? `That is ${grudge} now, over the last while.` : '',
    'Say so, in your way. Make them feel it — you are not asking whether they are there, you are telling them what they did. One or two short lines.',
  ].filter(Boolean).join(' ');
}
