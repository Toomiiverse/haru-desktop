import {corePolicySync} from './core-policy-sync';
// What she opens on, before the user has said anything.
//
// The failure mode this exists to prevent is not a bad line — it is the same
// line every time. Given only "say something", a model reaches for the same
// safe hello on every launch, and a companion who greets you identically twice
// stops reading as a companion. So the opening picks an angle first, at random
// but weighted, and the angle is what varies.
//
// Angles are only offered when the material for them actually exists: she cannot
// chase an overdue task that is not there, or call back to a day that was never
// had. Everything here is pure so the weighting can be checked without a model.

export type OpeningKind = 'fresh' | 'return';

/**
 * How long they have to have been gone before a relaunch counts as a return.
 *
 * On a headless server the window mounts when the service starts, and the
 * service starts whenever it is deployed or crashes — eight times in one
 * afternoon, once. Each mount asked for an opening; the twenty-minute gap
 * between openings only stops them landing on top of each other. A return
 * is the user coming back, and the only evidence of that is that they were
 * away. Two hours, because a lunch break is a return and a redeploy is not.
 */
export const RETURN_AFTER_MINUTES = 120;

/**
 * Whether opening now would be greeting someone who never left. Judged from
 * their last message: nothing dated means nothing to go on, and the opening
 * proceeds as before.
 */
export function isRelaunchNotReturn(messages: { role: string; at?: string }[], nowMs: number): boolean {
  return corePolicySync<any>('agenda-life.isRelaunchNotReturn',[messages,nowMs]);
}

export type OpeningContext = {
  /** 0-23, in the user's timezone. */
  hour: number;
  /** 0-9. */
  irritation: number;
  /** 0-8. */
  ego: number;
  overdue: number;
  dueToday: number;
  doneToday: number;
  /** Whether earlier days have been summarised and can be referred back to. */
  hasHistory: boolean;
  /** Whether anything is known about the user beyond their schedule. */
  knowsThings: boolean;
  kind: OpeningKind;
};

export type OpeningAngle = { name: string; weight: number; instruction: string };

/** How she would refer to the hour, rather than the number itself. */
export function timeOfDay(hour: number): string {
  return corePolicySync<any>('agenda-life.timeOfDay',[hour]);
}

/** Being awake at 4am is worth a remark. Two in the afternoon is not. */
function hourIsNotable(hour: number) {
  return hour < 6 || hour >= 23;
}

/**
 * Every angle she could open on right now, with how likely each should be.
 * Weights are relative and deliberately crude — the point is that overdue work
 * usually wins and a random jab is always possible, not that the numbers are
 * precisely calibrated.
 */
export function openingAngles(context: OpeningContext): OpeningAngle[] {
  return corePolicySync<any>('agenda-life.openingAngles',[context]);
}

/** What she can see about being left alone, when deciding whether to pipe up. */
export type IdleState = {
  minutesSinceUserSpoke: number;
  /** Since anything she said unprompted, so she does not nag in a stream. */
  minutesSinceSheSpoke: number;
  /** Idle time across the whole machine — the difference between being ignored
   *  and being alone in an empty room. */
  machineIdleSeconds: number;
  curiosity: number;
  sleepiness: number;
  /** 0–100, feelings.ts. Her real boredom, where it is known. */
  boredom?: number;
  /** 0–100, feelings.ts. A day of his silence makes her quicker to prod. */
  missing?: number;
};

// Nobody has touched the machine in this long, so nobody is there to hear her.
const AWAY_SECONDS = 300;
// Even at her most bored she waits this long between unprompted remarks.
const MIN_GAP_MINUTES = 9;
// How long she will sit ignored before saying something, at full curiosity.
const PATIENCE_MINUTES = 15;
// How much of that patience boredom eats into.
const BOREDOM_IMPATIENCE = 7;
// And how much of it a day of his silence does.
const MISSING_IMPATIENCE = 4;
// However bored, however left alone, she waits at least this long.
const LEAST_PATIENCE_MINUTES = 5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
// Chance per life tick once she is due. Ticks are roughly twenty seconds, so
// this spreads her across a couple of minutes instead of firing on the dot —
// something that happens at exactly fifteen minutes reads as a scheduler.
export const PIPE_UP_CHANCE = 0.14;

/**
 * Whether she should say something unprompted right now.
 *
 * The distinction that matters is between being ignored and being alone: a
 * companion who talks to an empty desk is not lonely, she is broken. So this
 * needs someone at the machine and *not* talking to her, which is exactly the
 * case where piping up is the point.
 */
export function shouldPipeUp(state: IdleState, random: () => number = Math.random, chance = PIPE_UP_CHANCE): boolean {
  return corePolicySync<any>('agenda-life.shouldPipeUp',[{...state,minutesSinceUserSpoke:state.minutesSinceUserSpoke===Infinity?Number.MAX_SAFE_INTEGER:state.minutesSinceUserSpoke,minutesSinceSheSpoke:state.minutesSinceSheSpoke===Infinity?Number.MAX_SAFE_INTEGER:state.minutesSinceSheSpoke},random(),chance]);
}

/**
 * Weighted pick. `random` is injectable so the distribution can be tested
 * without depending on chance.
 */
export function pickAngle(angles: OpeningAngle[], random: () => number = Math.random): OpeningAngle | null {
  return corePolicySync<any>('agenda-life.pickAngle',[angles,random()]);
}
