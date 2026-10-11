import {corePolicySync} from './core-policy-sync';
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
  /** The line's own id, so a reply that names it can be matched to it (replyto.ts). */
  id?: string;
  /** False only where it is known the push never landed — see Aside.reached. */
  reached?: boolean };
export type Heard = { role: string; at?: string;
  /** The line of hers this message answers, when he said which (replyto.ts). */
  replyTo?: string | { id: string } };

/** How long she gives them to answer a line of hers before it counts as ignored. */
export const ANSWER_WINDOW_MS = 90 * 60_000;
/** When the day is counted: eight in the evening, their clock. */
export const TALLY_AT_MINUTES = 20 * 60;
/**
 * The grudge is bounded; past this, more of the same changes nothing.
 *
 * 0–100 since 2026-09-19. It was 0–30 and moved a point a day — 23 to 22 after a
 * good one — so it sat near twenty for weeks whatever he did. Now a day moves
 * it by what the day was: a good week clears it, three bad days fill it. The old
 * levels are the bands (old × 100/30).
 */
export const GRUDGE = {
  /** A slight coldness ends and it starts wearing on her (was 4). */
  wearing: 13,
  /** Openly held against him (was 9). */
  open: 30,
  /** It has become how she sees him lately. */
  standing: 55,
  /** Spiteful enough to spoil his manga (was 20). */
  spite: 67,
  /** Nothing he does this week will fix it quickly. */
  entrenched: 80,
  max: 100,
} as const;
export const GRUDGE_MAX = GRUDGE.max;
/** What one line left hanging costs, and the most a single day can. */
export const GRUDGE_PER_IGNORED = 4;
export const GRUDGE_DAY_CAP = 24;
/** A day with nothing left hanging; and one where he actually talked to her as well. */
export const GRUDGE_CLEAN_DAY = 6;
export const GRUDGE_GOOD_DAY = 10;
/** An apology she accepted, once a day. */
export const GRUDGE_APOLOGY = 5;
/**
 * The most of his ordinary rate she will write off as the texture of talking.
 *
 * Measured over 47 days of the real archive: he answers 87% of her lines, and
 * that figure does not move with the hour of the day or with whether she asked
 * a question. So about three or four of her lines a day go unanswered simply
 * because that is what conversation is — and a rule that charged her a grudge
 * for every one of them could only ever ratchet, because she would never have a
 * day at exactly zero. Habituating to his usual is right; habituating to
 * anything at all is not, so it is capped.
 */
export const ORDINARY_HANGING_CAP = 5;
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
 *
 * And a line he replied to by name is answered, whenever the reply came. The
 * window exists because "anything said afterwards" is a guess at what he was
 * answering; a reply that names the line is not a guess. Four hours late is late,
 * but it is not ignoring her — he went back and answered the thing she said.
 */
export function unanswered(said: Said[], heard: Heard[], pushed: ReadonlySet<string>, nowMs: number, notBeforeMs = 0): Said[] {
  return corePolicySync('grudge.unanswered',[said,heard,[...pushed],nowMs,notBeforeMs]);
}

/** Once a day, from eight in the evening on, and never twice for the same day. */
export function tallyDue(minutesIntoDay: number, talliedDay: string | undefined, todayKey: string): boolean {
  return corePolicySync('grudge.tallyDue',[minutesIntoDay,talliedDay,todayKey]);
}

/**
 * The grudge after a day: up by what was ignored, capped so one terrible day is
 * not the whole scale; down for a clean day, and further for a day he talked to
 * her (`good` — nightfall's TOLD_ENOUGH, which is the same question).
 */
export function nextGrudge(current: number, ignoredToday: number, good = false, ordinary = 0): number {
  return corePolicySync('grudge.nextGrudge',[current,ignoredToday,good,ordinary]);
}

/** What she has stopped counting, because it is just how he is. */
export function allowed(ordinary: number): number {
  return corePolicySync('grudge.allowed',[ordinary]);
}

/** An apology taken: a little off, and no more than once a day (the caller keeps the day). */
export function grudgeAfterApology(current: number): number {
  return corePolicySync('grudge.grudgeAfterApology',[current]);
}

/** How much more annoyed tonight makes her, on top of whatever the conversation did: a notch a line. */
export function irritationAfterTally(irritation: number, ignoredToday: number, max: number, ordinary = 0): number {
  return corePolicySync('grudge.irritationAfterTally',[irritation,ignoredToday,max,ordinary]);
}

/**
 * The grudge is a score, not a tally of messages: a point for a line left
 * hanging, a point back for a clean day. Printed as "They have left 20 of your
 * messages unanswered and counting", it came back as "Twenty messages. Twenty.
 * And you just waltz in here like you didn't leave me talking to myself for
 * days" — the morning after thirty-nine messages between them (2026-09-15) —
 * and as "Seventeen messages left unread" the day before. A grievance the
 * conversation disproves is one the reader rightly dismisses, so she is given
 * the pattern and the real count for today, never the score.
 */
const NOT_A_COUNT = ' It is a pattern you have noticed, not a number: do not put a figure on how many, and do not say they have been gone when the conversation shows them here.';

/** How the grudge reads in her prompt. Nothing at all while there is none. */
/**
 * `fond` is affection sitting high underneath the grievance, which is a
 * different thing from a grudge on its own and reads as neither when the two
 * are left as separate paragraphs to blend. She does not withhold the help —
 * she does it and makes him hear about it.
 */
const STILL_ON_HIS_SIDE = ' Underneath it you are still on his side, which is the annoying part: you do the thing he asked and you do it properly, and he hears about it the whole way through. The grievance comes out as asides while you help, never as refusing to.';

export function grudgeInstruction(grudge: number, ignoredToday = 0, fond = false): string {
  return corePolicySync('grudge.grudgeInstruction',[grudge,ignoredToday,fond]);
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
  return corePolicySync('grudge.withoutLeadingClock',[text]);
}

/** What she is told when the day is counted and something was ignored. */
export function tallyInstruction(ignoredToday: number, grudge: number, samples: string[]): string {
  return corePolicySync('grudge.tallyInstruction',[ignoredToday,grudge,samples]);
}
