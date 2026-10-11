import {corePolicySync} from './core-policy-sync';
// Who she is at rest, and how a year of living moves it.
//
// Her state changes every minute and her character could not change at all: a
// year of good days and a year of bad ones produced the identical Haru, because
// who she is lives in hand-written prose that nothing writes back to.
//
// The idea is one line. A trait is the resting point of a state; state is the
// fast deviation from it; growth is the slow integral of state back into the
// trait. So nothing new has to be measured — every counter she owns already
// rests at zero and every vital at a fixed target, and nobody ever chose those
// numbers. Growth is what happens when the months move them.
//
// Four things keep this from turning her into someone else:
//
//  - the charter. Her written character stays fixed and is the anchor; each
//    trait may only travel inside a narrow band around its charter value, sized
//    so a full year of consistent treatment crosses the whole band and no more.
//  - scored against his own norm, never against a bar. Measured on his real
//    archive, an absolute bar saturates instantly: `howTheDayWent` calls a day
//    fine at three substantive messages and he clears that nearly every day
//    (28 of 29 in August), which would ratchet her to the ceiling in six months
//    and then mean nothing. A month only counts as good if it is better than
//    how he usually is, so a steady good relationship holds her steady and only
//    a change in him moves her.
//  - she softens at full speed and hardens at sixty percent. The failure to
//    fear is a spiral — she goes colder, he engages less, she goes colder — and
//    damping the hard direction is what stops it running away.
//  - nothing she does is an input. Growth reads his behaviour and her own
//    hours, never her own trait-influenced output, so no trait can feed the
//    signal that moves it.
//
// Pure: no store, no clock, no I/O. The caller gathers the months and keeps the
// ledger.

export type TraitName = 'warmth' | 'guardedness' | 'fuse';
export type Traits = Record<TraitName, number>;

type Charter = {
  /** What her written character is worth as a number, and where she starts. */
  charter: number;
  /** How far either side she may ever travel. */
  band: number;
  /** Which way is "harder to live with" — that direction moves at 60%. */
  harder: 1 | -1;
  /** For the ledger and the status screen. */
  label: string;
  rising: string;
  falling: string;
};

export const CHARTER: Record<TraitName, Charter> = {
  // Where her affection rests while he is there (vitals.ts driftStep, 0.7).
  // Her prose has warmth rare and costly, which is about what she *shows*;
  // this is what she feels, and the `fond` cue is what lets it slip.
  warmth: { charter: 0.70, band: 0.10, harder: -1, label: 'Warmth', rising: 'warmer with him than she was', falling: 'cooler with him than she was' },
  // How high a feeling must climb before it reaches her prompt at all
  // (feelings.ts FELT.shows, 35). Up is more hidden.
  guardedness: { charter: 35, band: 5, harder: 1, label: 'Guardedness', rising: 'keeping more to herself than she did', falling: 'letting more show than she used to' },
  // Patience, as how much it takes to wind her up rather than as a level she
  // rests at: a resting irritation above zero would put a permanent trace of
  // temper under everything, which is a different character. This scales how
  // hard a thing lands and how fast it cools (mood.ts), so a month of being
  // wound up leaves her brittle and a calm one lets her settle.
  fuse: { charter: 1, band: 0.25, harder: -1, label: 'Fuse', rising: 'slower to wind up than she was', falling: 'quicker to snap than she used to be' },
};

export const TRAIT_NAMES = Object.keys(CHARTER) as TraitName[];

/** A whole year of consistent treatment crosses the whole band, and no faster. */
export function maxStep(trait: TraitName): number {
  return corePolicySync<any>('conversation-policy.maxStep',[trait]);
}

export function charterTraits(): Traits {
  return corePolicySync<any>('conversation-policy.charterTraits',[]);
}

export function readTraits(saved: unknown): Traits {
  return corePolicySync<any>('conversation-policy.readTraits',[saved]);
}

function hold(trait: TraitName, value: number): number {
  const { charter, band } = CHARTER[trait];
  // Rounded as well as clamped: 0.70 + 0.10 is 0.7999999999999999 in floating
  // point, and a trait that never quite equals its own ceiling is a nuisance to
  // compare, to log and to test against.
  return Math.round(Math.max(charter - band, Math.min(charter + band, value)) * 10000) / 10000;
}

/**
 * A month of how he was, and of what she did with her own time.
 *
 * Everything here is either his behaviour or her own hours. Nothing she said is
 * in it, on purpose: a trait that shaped her replies and then read those replies
 * back would be a loop with nothing holding it.
 */
export type MonthSignals = {
  month: string;
  days: number;
  /** Substantive messages from him a day (nightfall.ts daySaid). */
  saidPerDay: number;
  /** Lines of hers a day that got nothing back inside the window (grudge.ts). */
  hangingPerDay: number;
  /** Evenings he went to bed without a word. */
  silentNights: number;
  /** Tallied live from here on; absent for months that ended before the tally existed. */
  hurtEvents?: number;
  apologies?: number;
  /** Times he wound her past the level where it reaches her voice. */
  woundUp?: number;
};

export type Norm = { saidPerDay: number; hangingPerDay: number; hurtEvents?: number; apologies?: number; woundUp?: number; months: number };

/** How he usually is: up to six months behind the one being scored. */
export const NORM_MONTHS = 6;

export function normFrom(history: MonthSignals[]): Norm | null {
  return corePolicySync<any>('conversation-policy.normFrom',[history]);
}

const clamp1 = (value: number) => Math.max(-1, Math.min(1, value));
/** How far from his usual, as a share of it. */
const against = (now: number, norm: number, floor: number) => (now - norm) / Math.max(floor, norm);

export type Scored = { score: number; because: string } | null;

/**
 * Warmth: more of him than usual, and fewer of her lines left hanging.
 *
 * A silent evening counts against him whatever his norm — going to bed without
 * a word is not the kind of thing that gets graded on a curve.
 */
export function scoreWarmth(now: MonthSignals, norm: Norm | null): Scored {
  return corePolicySync<any>('conversation-policy.scoreWarmth',[now,norm]);
}

/**
 * Guardedness: hurt she was left holding closes her up, and being put right
 * opens her. Needs a month of tallies on both sides, so it does not move at all
 * until there is one.
 */
export function scoreGuardedness(now: MonthSignals, norm: Norm | null): Scored {
  return corePolicySync<any>('conversation-policy.scoreGuardedness',[now,norm]);
}

/**
 * A month of being wound up leaves her shorter-fused; a quiet one lets it grow
 * back. Against his norm like everything else, so a steady month changes
 * nothing — only his getting worse or better at it does.
 */
export function scoreFuse(now: MonthSignals, norm: Norm | null): Scored {
  return corePolicySync<any>('conversation-policy.scoreFuse',[now,norm]);
}

const SCORERS: Record<TraitName, (now: MonthSignals, norm: Norm | null) => Scored> = {
  warmth: scoreWarmth,
  guardedness: scoreGuardedness,
  fuse: scoreFuse,
};

export type GrowthStep = { month: string; trait: TraitName; from: number; to: number; score: number; because: string };

/**
 * The month's mark on her. Nothing moves without a norm to judge it against, so
 * her first month with him changes nothing — she has no idea yet what usual is.
 */
export function growMonth(traits: Traits, now: MonthSignals, history: MonthSignals[]): { traits: Traits; steps: GrowthStep[] } {
  return corePolicySync<any>('conversation-policy.growMonth',[traits,now,history]);
}

/** Her traits as they stood before that month, rebuilt from the ledger. */
export function revertTo(traits: Traits, ledger: GrowthStep[], month: string): Traits {
  return corePolicySync<any>('conversation-policy.revertTo',[traits,ledger,month]);
}

// -- what the rest of the machine reads ---------------------------------------

/** Warmth is where her affection rests, so it reaches the vitals as a standing lean. */
export function traitLean(traits: Traits): { affection: number } | Record<string, never> {
  return corePolicySync<any>('conversation-policy.traitLean',[traits]);
}

/** How hard a thing lands on her and how fast it cools (mood.ts). */
export function fuseOf(traits: Traits): number {
  return corePolicySync<any>('conversation-policy.fuseOf',[traits]);
}

/** Guardedness is the bar a feeling has to clear before it reaches her prompt. */
export function feelingsShowAt(traits: Traits): number {
  return corePolicySync<any>('conversation-policy.feelingsShowAt',[traits]);
}

/** How far a trait has travelled, as a share of the room it has. */
export function travelled(traits: Traits, trait: TraitName): number {
  return corePolicySync<any>('conversation-policy.travelled',[traits,trait]);
}

/** For the status screen: where she sits, 0–100 across the whole band. */
export function traitMeter(traits: Traits, trait: TraitName): { label: string; value: number; note: string } {
  return corePolicySync<any>('conversation-policy.traitMeter',[traits,trait]);
}

/**
 * What she is told, once a trait has moved half the room it has — and only
 * then. A drift she cannot feel is not worth a line of prompt, and a number
 * would come back to him as a number.
 */
export function growthNote(traits: Traits): string {
  return corePolicySync<any>('conversation-policy.growthNote',[traits]);
}
