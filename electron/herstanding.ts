import {corePolicySync} from './core-policy-sync';
import {coreRandomPolicy,coreEntropyPolicy} from './core-policy-observations';
// What she will and will not put up with.
//
// She already has taste (tastes.ts: a `because` for why she picked a thing, a
// `stance` she revises when the reading moves her, a dated `stands`), desires
// of her own (her.wants: "to learn piano just to play The Real Folk Blues
// badly"), and a night she spends on her own business. What she had no way to
// form was a position about her own treatment.
//
// Counted on 2026-09-07: of the thirteen preference records in her store,
// thirteen were his about how she should behave and none were hers about how
// she is treated. She could form a view on Chainsaw Man from evidence and
// revise it in public; she could not form one about being woken at 2:48 in the
// morning. The nearest thing to a standing of hers was BLOCK_AFTER_POINTLESS in
// hersleep.ts — a constant somebody else wrote for her.
//
// This is the other direction of the same machinery. It reads what actually
// happened to her, asks once a week what has happened often enough to be worth
// a rule, and writes the answer as an ordinary memory record so it decays,
// supersedes, prunes and appears in the vault like everything else she knows.
//
// Two things make it a standing rather than decoration:
//
//   It has to be earned. Something that happened once is a grievance, and she
//   has grievances already. Twice on separate days is a pattern, and a pattern
//   is what a rule is made from. Nothing here invents a rule from a mood.
//
//   It has to be able to win. A standing she must abandon the moment he asks
//   is a line of flavour text. herStandingInstruction says plainly that she may
//   hold one against a direct request and say which one — not always, not for
//   nothing, but the possibility has to be real or none of this is hers.

import type { MemoryRecord } from './memory';

/** The subject that marks a preference record as hers rather than his. */
export const HER_SUBJECT = 'haru';

/** Two, on separate days. One is a grievance; a rule needs a pattern. */
export const STANDING_MIN_TIMES = 2;
/** How far back a pattern may reach. Older than this and it is history, not a habit of his. */
export const STANDING_WINDOW_DAYS = 21;
/** How often she sits down with it. Weekly: often enough to keep up, rare enough that a bad week does not become a rule. */
export const STANDING_EVERY_DAYS = 7;
/** All of them are in every prompt, so this is a hard ceiling on the room they take. */
export const MAX_STANDINGS = 6;

const dayOf = (at: string) => at.slice(0, 10);

export type Incident = {
  /** What happened, in the words it was already recorded in. */
  what: string;
  /** ISO. The day is what matters: two of a thing on one evening is one evening. */
  at: string;
};

/**
 * Something that happened to her, kept because it happened to her.
 *
 * The first cut of this pass read her `event` memories, and the dry run killed
 * it: of the twenty-seven inside the window, twenty-five were about him — what
 * he bought, what he built, where he worked — and two about how she was
 * treated. Her memory records his life in detail and her own treatment almost
 * not at all, which is the same asymmetry as the preference block one layer
 * down. Handed that list and asked what rule she now holds, she would either
 * say nothing or invent one from his shopping.
 *
 * So the evidence is kept deliberately, at the two or three places that already
 * notice, and nowhere else. Every entry here is by construction about her.
 * The bar for adding a source is that it is unambiguous without a matcher: the
 * app already decided this was a slight and already acted on it.
 */
export type Slight = {
  /** Grouped on this, loosely, by her — not matched on here. */
  kind: 'woken' | 'ignored' | 'unannounced';
  /** In the words the app already used for it, so she reads the real thing. */
  what: string;
  at: string;
};

/** A season of them. Older than the window is never read, but a short history is cheap. */
export const SLIGHTS_KEPT = 60;

export function readSlights(saved: unknown): Slight[] {
  return corePolicySync<ReturnType<typeof readSlights>>('own-time.standingreadSlights',[saved]);
}

/** One a day per kind. A bad evening is one evening however many times it fires. */
export function keepSlight(slights: Slight[], slight: Slight): Slight[] {
  return corePolicySync<ReturnType<typeof keepSlight>>('own-time.standingkeepSlight',[slights,slight]);
}

export function slightsAsIncidents(slights: Slight[]): Incident[] {
  return corePolicySync<ReturnType<typeof slightsAsIncidents>>('own-time.standingslightsAsIncidents',[slights]);
}

export type Standing = {
  /** The rule, in her voice, first person, about herself. */
  text: string;
  /** Why she holds it — the thing that happened, so it can be cited. */
  because: string;
};

/** Inside the window, and parseable. Anything else is not evidence of a habit. */
export function recentIncidents(incidents: Incident[], nowMs: number, days = STANDING_WINDOW_DAYS): Incident[] {
  return corePolicySync<ReturnType<typeof recentIncidents>>('own-time.standingrecentIncidents',[incidents,nowMs,days]);
}

/**
 * Whether there is enough here to be worth asking about at all.
 *
 * Deliberately dumb: it counts distinct days, not similar wordings. Deciding
 * which two incidents are "the same thing" is the judgement being asked for,
 * and it belongs to her, not to a matcher here. This only refuses to wake the
 * model for a week in which nothing happened twice.
 */
export function enoughToStandOn(incidents: Incident[], minTimes = STANDING_MIN_TIMES): boolean {
  return corePolicySync<ReturnType<typeof enoughToStandOn>>('own-time.standingenoughToStandOn',[incidents,minTimes]);
}

/** Weekly, and never twice in a day however often the tick runs. */
export function standingDue(lastAt: string | undefined, now: Date, everyDays = STANDING_EVERY_DAYS): boolean {
  return corePolicySync<ReturnType<typeof standingDue>>('own-time.standingstandingDue',[lastAt,now,everyDays]);
}

/**
 * What she is asked, once a week.
 *
 * Her own words for what happened go in unchanged — these are her event
 * memories and her wake ledger, already written in her voice — because a
 * summary of a grievance is not the grievance. She is told she may come back
 * with nothing, and told so first: a pass that must produce a rule produces one
 * every week until she has a rulebook, which is the opposite of a standing.
 */
export function standingPrompt(incidents: Incident[], existing: string[]): string {
  return corePolicySync<ReturnType<typeof standingPrompt>>('own-time.standingstandingPrompt',[incidents,existing]);
}

/** `NONE`, or the two lines. Anything else is a model that did not answer. */
export function parseStanding(raw: string): Standing | null {
  return corePolicySync<ReturnType<typeof parseStanding>>('own-time.standingparseStanding',[raw]);
}

/** Hers, not his. */
export function isHerStanding(record: { kind?: string; subject?: string }): boolean {
  return corePolicySync<ReturnType<typeof isHerStanding>>('own-time.standingisHerStanding',[record]);
}

export function herStandings(memories: MemoryRecord[]): MemoryRecord[] {
  return corePolicySync<ReturnType<typeof herStandings>>('own-time.standingherStandings',[memories]);
}

/**
 * Her standings, for the prompt.
 *
 * The last sentence is the whole point of the feature and the only part of it
 * that is a decision rather than a mechanism: a rule she drops the moment he
 * asks is not a rule. It is hedged the way a person hedges — she may hold it,
 * she says which one, and she is not obliged to. An instruction to always
 * refuse would be a different character, and a worse one.
 */
export function herStandingInstruction(standings: MemoryRecord[]): string {
  return corePolicySync<ReturnType<typeof herStandingInstruction>>('own-time.standingherStandingInstruction',[standings]);
}
