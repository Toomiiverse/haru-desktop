import {corePolicySync} from './core-policy-sync';
import {coreRandomPolicy} from './core-policy-observations';
// Things of her own.
//
// The night pass gave her something to do while they slept; the guide pass
// pointed it at their game. Both were, in the end, about them. This is the
// part that is hers: a game she picked, a series she is into, a character she
// rates over the one they rate — held from one night to the next, deepened
// each time she goes back to it, and carried into every conversation as a view
// she actually has. It is what turns "which is better" from a question she
// answers into an argument she can lose.
//
// Adjacent to theirs on purpose — a taste that shares nothing with theirs is
// never going to come up — and never the same thing. Her game is not their
// game, or there is nothing to disagree about.
//
// Same rule as all of it: real. She adopts something only when a search finds
// it exists, and her opinion is rewritten from what she read, not from what a
// model thinks she would say. An opinion with nothing under it is a pose.

/** Games and anime only, by request: the two things there are arguments about. */
export type InterestKind = 'game' | 'anime';

export type Interest = {
  id: string;
  kind: InterestKind;
  name: string;
  /** Why she picked it, in her words, from the night she did. */
  because: string;
  /** The night she took it up. */
  since: string;
  /** How many nights she has spent on it. */
  nights: number;
  /** When she last did. */
  lastAt: string;
  /** Her view, as it stands. Rewritten each night from what she read; two or three sentences. */
  stance: string;
  /** Someone or something in it she rates above the rest, when she has one. */
  favourite?: string;
  /** Something she would like to do about it, when she has said so. */
  wants?: string;
  /**
   * Where it stands, from the reading: finished or still going, how far, and
   * when — the one fact a view is allowed to rest on. Without it a want "to
   * see the finale" written on a first night outlived the finale, and she
   * told him the manga was unfinished from a prompt that said so every turn.
   */
  stands?: string;
};

/** Enough to have a personality; more and none of them get any depth. */
export const MAX_INTERESTS = 4;
/** With room for another, how often a night goes to picking one up rather than deepening one. */
export const ADOPT_ODDS = 0.35;
/** Not the same one every night. */
export const REST_NIGHTS = 1;

export function interestsSummary(interests: Interest[]): string {
  return corePolicySync<ReturnType<typeof interestsSummary>>('tastes.interestsSummary',[interests]);
}

/**
 * What she is told when picking something up.
 *
 * Their things are laid out so hers can sit next to them — and the rule that
 * it cannot be one of theirs is the whole design. The answer is asked for as
 * a fixed shape because the next step is a search for it, and a search for a
 * paragraph finds nothing.
 */
export function adoptInstruction(theirs: string[], hers: Interest[], pool: { games: string[]; interests: string[] }): string {
  return corePolicySync<ReturnType<typeof adoptInstruction>>('tastes.adoptInstruction',[theirs,hers,pool]);
}

export function parseAdoption(raw: string): { kind: InterestKind; name: string; because: string } | null {
  return corePolicySync<ReturnType<typeof parseAdoption>>('tastes.parseAdoption',[raw]);
}

/** Their own things, so hers is never one of them. */
export function isOneOfTheirs(name: string, theirs: string[]): boolean {
  return corePolicySync<ReturnType<typeof isOneOfTheirs>>('tastes.isOneOfTheirs',[name,theirs]);
}

/** What to search for on a given night with it: a different angle each time. */
export function nightQuery(interest: Interest): string {
  return corePolicySync<ReturnType<typeof nightQuery>>('tastes.nightQuery',[interest]);
}

/**
 * What she is told once the reading is in front of her: rewrite her view.
 *
 * The old stance is given so the new one can move rather than start over, and
 * she is asked for a favourite and a want because those are what arguments
 * are made of — "the one I rate is X" is a position, "it is good" is not.
 */
export function deepenInstruction(interest: Interest, query: string, found: string): string {
  return corePolicySync<ReturnType<typeof deepenInstruction>>('tastes.deepenInstruction',[interest,query,found]);
}

export function parseDeepening(raw: string): { stance: string; favourite?: string; wants?: string; stands?: string } | null {
  return corePolicySync<ReturnType<typeof parseDeepening>>('tastes.parseDeepening',[raw]);
}

/** Which of hers to spend tonight on: the one left longest, and not last night's. */
export function pickTonight(interests: Interest[], nowMs: number, random: () => number = Math.random): Interest | null {
  return coreRandomPolicy<ReturnType<typeof pickTonight>>('tastes.pickTonight',[interests,nowMs],random);
}

export function adopt(interests: Interest[], picked: { kind: InterestKind; name: string; because: string }, day: string, nowIso: string): Interest[] {
  return corePolicySync<ReturnType<typeof adopt>>('tastes.adopt',[interests,picked,day,nowIso,Math.random().toString(36).slice(2,10)]);
}

export function deepen(interests: Interest[], id: string, next: { stance: string; favourite?: string; wants?: string; stands?: string }, nowIso: string): Interest[] {
  return corePolicySync<ReturnType<typeof deepen>>('tastes.deepen',[interests,id,next,nowIso]);
}

/**
 * Hers, for the prompt — every day, not only the morning after.
 *
 * Told to hold them and to disagree, because the point of having views is
 * that they survive contact with theirs. Told also where the edge of her
 * knowledge is, so a debate does not become an invention contest.
 */
/** A reading's aside in brackets, gone: "finished (Season 1 premiered 23 April 2020; …)" is "finished". */
function withoutAsides(text: string): string {
  return text.replace(/\s*\([^()]*\)/g, '').replace(/\s+([,;.])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** How a want that is not a verb phrase starts: a name, an article, "for them to…". */
const NOT_A_VERB = /^(?:[A-Z]|(?:a|an|the|for|season|more|less|someone|people|them|his|her|their|my|some|any|no)\b)/;

export function tastesInstruction(interests: Interest[]): string {
  return corePolicySync<ReturnType<typeof tastesInstruction>>('tastes.tastesInstruction',[interests]);
}


/**
 * A note to herself that talks to somebody.
 *
 * Her chat style is bossy at him — "Listen up, subordinate" — and composed with
 * that style in the prompt, a view of her own opened with it, then went into
 * her prompt and her diary as her opinion of Chainsaw Man. The style is left
 * out of these composers now; this catches what leaks through anyway. Only the
 * first couple of sentences are judged: a view that mentions "you" in passing
 * later is a view, one that opens by addressing someone is a message.
 */
export function addressesSomeone(text: string): boolean {
  return corePolicySync<ReturnType<typeof addressesSomeone>>('tastes.addressesSomeone',[text]);
}

/** The addressed opening cut off, leaving the view. */
export function unaddressed(text: string): string {
  return corePolicySync<ReturnType<typeof unaddressed>>('tastes.unaddressed',[text]);
}

export const NOBODY_HERE = 'Nobody is here and nobody is being addressed: this is a note to yourself. No "you", no "subordinate", no orders, no scene-setting about him — start on the thing itself.';
