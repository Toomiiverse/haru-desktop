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
  let sheSpokeAt: number | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = Date.parse(messages[i].at ?? '');
    if (messages[i].role === 'user' && messages[i].at) return Number.isFinite(at) ? nowMs - at < RETURN_AFTER_MINUTES * 60_000 : false;
    if (sheSpokeAt === undefined && Number.isFinite(at)) sheSpokeAt = at;
  }
  // Not a word from them in the whole conversation, which is what a reset leaves
  // behind: her own opening and nothing else. Measured from the last thing she
  // said, because otherwise this can never fire — every restart added another
  // opening into a room only she had spoken in, and with her own line the one
  // thing in front of her the model reproduced it word for word, twice, twenty
  // three minutes apart (2026-09-21). A user line still outranks this whenever
  // there is one, so "her own recent lines do not count as them being here"
  // holds exactly as before.
  return sheSpokeAt !== undefined && nowMs - sheSpokeAt < RETURN_AFTER_MINUTES * 60_000;
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
  if (hour < 5) return 'the middle of the night';
  if (hour < 9) return 'early morning';
  if (hour < 12) return 'mid-morning';
  if (hour < 14) return 'the middle of the day';
  if (hour < 17) return 'the afternoon';
  if (hour < 21) return 'the evening';
  return 'late at night';
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
  const angles: OpeningAngle[] = [];

  // Being left to find out for herself is the thing she has most reason to open
  // on, so it outweighs everything else when it is available.
  if (context.overdue > 0) angles.push({
    name: 'overdue',
    weight: 5,
    instruction: 'Something on their list has come and gone and they never told you how it went. Open on that specific thing and want to know. You are supposed to be the one keeping track, so being left to find out for yourself is worth being openly put out about. Do not mark it done yourself.',
  });

  if (context.dueToday > 0) angles.push({
    name: 'agenda',
    weight: 3,
    instruction: 'Open by leading with something actually on their schedule today. Name the specific thing. Do not read the whole list back at them.',
  });

  if (context.doneToday > 0) angles.push({
    name: 'done',
    weight: 2,
    instruction: 'They have actually finished something on their list. Acknowledge it — grudgingly, or as though it was the least they could have done, but acknowledge that you noticed.',
  });

  angles.push({
    name: 'hour',
    // A strange hour is worth remarking on; an ordinary one rarely is.
    weight: hourIsNotable(context.hour) ? 4 : 1,
    instruction: `It is ${timeOfDay(context.hour)}. Open by reacting to the hour itself — what they are doing up, what it says about how their day is going, whatever lands.`,
  });

  // Only on a fresh conversation: with the previous exchange still on screen,
  // reaching past it for an older day reads as having lost the thread.
  if (context.hasHistory && context.kind === 'fresh') angles.push({
    name: 'callback',
    weight: 2,
    instruction: 'Open by bringing up something from an earlier day that stuck with you. Refer to it as though it has been sitting in the back of your mind, not as though you are reciting a record.',
  });

  if (context.knowsThings) angles.push({
    name: 'personal',
    weight: 2,
    instruction: 'Open on something you know about them personally — their work, someone in their life, something they care about. Not their schedule.',
  });

  // There used to be a 'fact' angle here — "open with something interesting you
  // have been turning over". Removed. Whatever it was told, the model opened
  // with "Did you know…" trivia: first jellyfish, octopuses and caterpillars,
  // and once animals were forbidden, the Eiffel Tower three times in one day.
  // Steering it produced a different party trick, not a mind, and the user
  // called the result uninteresting and unwanted. A companion with nothing to
  // say about their day should pick another angle, not recite an encyclopedia.

  angles.push({
    name: 'jab',
    // Scales with mood from both ends: fed up and full of herself each make an
    // unprovoked dig likelier, for different reasons. At its worst this is the
    // heaviest angle on the list; at her calmest it is still possible.
    // Per old notch (irritation was 0–9, ego 0–8), so the angle weighs what it did.
    weight: 1 + context.irritation / 11 * 0.6 + context.ego / 12.5 * 0.3,
    instruction: 'Open with an unprovoked jab at them. There is no reason for it and nothing prompted it — do not invent a justification, do not tie it to their schedule, and do not soften it afterwards.',
  });

  return angles;
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
  // Nobody there. Anything she says now is said to nobody.
  if (state.machineIdleSeconds > AWAY_SECONDS) return false;
  // Half asleep, and the hour is doing the talking.
  if (state.sleepiness > 0.75) return false;
  if (state.minutesSinceSheSpoke < MIN_GAP_MINUTES) return false;
  // Boredom shortens her patience rather than being a separate trigger: a quiet
  // room she has nothing to do in is exactly when she starts prodding. Her own
  // boredom counter where it is known (feelings.ts); before that counter
  // existed, low curiosity stood in for it, and that is still the fallback.
  const bored = clamp01((state.boredom ?? (1 - state.curiosity) * 100) / 100);
  const patience = Math.max(LEAST_PATIENCE_MINUTES,
    PATIENCE_MINUTES - bored * BOREDOM_IMPATIENCE - clamp01((state.missing ?? 0) / 100) * MISSING_IMPATIENCE);
  if (state.minutesSinceUserSpoke < patience) return false;
  return random() < chance;
}

/**
 * Weighted pick. `random` is injectable so the distribution can be tested
 * without depending on chance.
 */
export function pickAngle(angles: OpeningAngle[], random: () => number = Math.random): OpeningAngle | null {
  const usable = angles.filter(angle => angle.weight > 0);
  if (!usable.length) return null;
  const total = usable.reduce((sum, angle) => sum + angle.weight, 0);
  let roll = random() * total;
  for (const angle of usable) {
    roll -= angle.weight;
    if (roll < 0) return angle;
  }
  // Only reachable through floating-point drift at the very top of the range.
  return usable[usable.length - 1];
}
