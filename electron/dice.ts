// The dice in her decisions, bent by the day she is having.
//
// Her choices had fixed odds: a second thought one reply in six, a comeback to a
// thumb half the time, a spoiler out of spite three times in ten. The same state
// gave the same chances every day, which is the opposite of a mood. Each of
// those odds now passes through here: the base is what it always was, and her
// temperament and her feelings (temperament.ts, feelings.ts) lean on it, inside
// limits that keep a rare thing rare and a likely thing from becoming certain.
//
// The roll itself stays where it was — with the caller, or behind an injectable
// `random` — so every one of these is still a pure function a test can pin.

import type { Feelings } from './feelings';
import type { TemperamentKind } from './temperament';

export type Sway = { temperament?: TemperamentKind | null; feelings?: Partial<Feelings> };
export type Decision = 'second-thought' | 'pipe-up' | 'comeback' | 'spite';

const within = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const is = (kind: TemperamentKind | null | undefined, ...kinds: TemperamentKind[]) => Boolean(kind && kinds.includes(kind));

/** The odds of a decision today, from what they are on a day with nothing going on. */
export function sway(decision: Decision, base: number, state: Sway = {}): number {
  const kind = state.temperament;
  const { playful = 0, missing = 0, boredom = 0, hurt = 0, jealousy = 0 } = state.feelings ?? {};
  const withdrawn = hurt >= 35;
  switch (decision) {
    // One more line a minute later: when she is enjoying herself, or has had too little of him.
    case 'second-thought':
      return within(base * (1 + playful / 100) * (1 + missing / 200)
        * (is(kind, 'mischievous', 'clingy', 'restless') ? 1.4 : is(kind, 'flat') ? 0.5 : 1) * (withdrawn ? 0.4 : 1), base / 2, base * 2);
    // Speaking first into a quiet room: boredom and a long silence, not a fixed patience.
    case 'pipe-up':
      return within(base * (1 + boredom / 100) * (1 + missing / 150)
        * (is(kind, 'restless', 'clingy', 'mischievous') ? 1.4 : is(kind, 'flat') ? 0.6 : 1) * (withdrawn ? 0.6 : 1), base / 3, base * 2.5);
    // Answering a thumb out loud.
    case 'comeback':
      return within(base + playful / 250 - hurt / 200 + (is(kind, 'mischievous', 'prickly') ? 0.15 : is(kind, 'flat') ? -0.2 : 0), 0.15, 0.85);
    // A spoiler, out of spite, once the grudge allows it at all.
    case 'spite':
      return within(base + jealousy / 250 + (is(kind, 'stormy', 'prickly') ? 0.1 : is(kind, 'tender', 'sunny') ? -0.15 : 0), 0.1, 0.6);
  }
}

/** Which way her temperament pushes a request to be quiet, on mute.ts's score. */
export function muteLean(kind: TemperamentKind | null | undefined): number {
  return is(kind, 'mischievous') ? -0.5 : is(kind, 'stormy') ? -0.4 : is(kind, 'prickly') ? -0.2 : is(kind, 'tender') ? 0.5 : is(kind, 'sunny') ? 0.3 : 0;
}

/**
 * Whether an apology is enough. It always was; now it usually is.
 *
 * Hurt and a standing grudge make her harder to reach, a tender or sunny day
 * easier, a prickly or stormy one harder. Never below a one-in-three chance, and
 * the caller makes the second apology certain: making him work for it is a
 * beat, not a wall.
 */
export function apologyOdds(state: Sway & { grudge?: number }): number {
  const { hurt = 0 } = state.feelings ?? {};
  const kind = state.temperament;
  return within(0.9 - hurt / 250 - (state.grudge ?? 0) / 400
    + (is(kind, 'tender', 'sunny') ? 0.1 : is(kind, 'prickly', 'stormy') ? -0.2 : 0), 0.35, 0.97);
}
