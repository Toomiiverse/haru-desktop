// Haru's internal state. These drift on their own from the time of day and what
// the machine is doing, so she has a mood before anyone speaks to her — the
// point being that she is running whether or not she is being talked to.
//
// Pure by design: the tick loop supplies the readings and the clock, nothing in
// here reaches for either, so the whole state machine can be run headlessly.

export type Vitals = {
  energy: number;
  happiness: number;
  curiosity: number;
  affection: number;
  sleepiness: number;
  stress: number;
  focus: number;
};

export type Environment = {
  hour: number;          // 0-23, in the user's zone
  idleSeconds: number;   // since last keyboard/mouse input anywhere on the machine
  onBattery: boolean;
  windowFocused: boolean;
};

export const DEFAULT_VITALS: Vitals = {
  energy: 0.6, happiness: 0.6, curiosity: 0.5, affection: 0.4,
  sleepiness: 0.2, stress: 0.2, focus: 0.5,
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

// Eases a value toward a target rather than snapping, so state changes read as
// drifting rather than flipping. `rate` is per-tick pull, 0-1.
const toward = (value: number, target: number, rate: number) => value + (target - value) * clamp(rate);

// A day curve rather than a bedtime: she winds down through the evening, is
// flattest around 4am, and picks up through the morning.
export function sleepinessForHour(hour: number) {
  if (hour >= 23 || hour < 5) return 0.9;
  if (hour >= 21) return 0.6;
  if (hour >= 18) return 0.35;
  if (hour < 7) return 0.7;
  if (hour < 9) return 0.3;
  return 0.15;
}

export function isNight(hour: number) {
  return hour >= 23 || hour < 6;
}

// One step of drift. `seconds` is how long since the last tick, so a slow or
// missed tick moves state proportionally rather than by a fixed step.
export function driftVitals(current: Vitals, environment: Environment, seconds: number): Vitals {
  // Normalised against a nominal 20s tick so rates stay meaningful if the
  // interval changes or a tick is late.
  const step = clamp(seconds / 20) * 0.25;
  const { hour, idleSeconds, onBattery, windowFocused } = environment;

  const sleepTarget = sleepinessForHour(hour);
  // Sitting untouched is restful; being used keeps her awake past her bedtime.
  const active = idleSeconds < 60;
  const sleepiness = toward(current.sleepiness, active ? sleepTarget * 0.8 : sleepTarget, step);

  // Energy is mostly the inverse of sleepiness, with the machine running on
  // battery reading as a reason to be a little more subdued.
  const energyTarget = clamp(1 - sleepiness - (onBattery ? 0.15 : 0));
  const energy = toward(current.energy, energyTarget, step);

  // Curiosity builds while something is happening and fades in a quiet room.
  const curiosityTarget = active ? 0.75 : idleSeconds > 600 ? 0.15 : 0.4;
  const curiosity = toward(current.curiosity, curiosityTarget, step);

  // Focus is about whether her window is the one being used.
  const focus = toward(current.focus, windowFocused ? 0.9 : active ? 0.4 : 0.15, step);

  // Left alone for a long stretch she settles rather than stays wound up.
  const stress = toward(current.stress, idleSeconds > 300 ? 0.1 : 0.25, step * 0.5);

  // Attention is what she warms to; a long silence cools it slowly.
  const affectionTarget = windowFocused ? 0.7 : idleSeconds > 1800 ? 0.25 : current.affection;
  const affection = toward(current.affection, affectionTarget, step * 0.4);

  // Happiness follows the rest rather than having a driver of its own.
  const happinessTarget = clamp(0.45 + energy * 0.3 + affection * 0.3 - stress * 0.3);
  const happiness = toward(current.happiness, happinessTarget, step * 0.6);

  return {
    energy: clamp(energy), happiness: clamp(happiness), curiosity: clamp(curiosity),
    affection: clamp(affection), sleepiness: clamp(sleepiness), stress: clamp(stress), focus: clamp(focus),
  };
}

// -- what her state does to how she talks -------------------------------------
//
// Until now the vitals reached the idle animation and nothing else: she could
// be at affection 0.8 and energy 0.8 while the prompt said "thoroughly fed up",
// because the face and the words came from different numbers. This is the
// other consumer. It renders at most two cues — the ones furthest past their
// threshold — as sentences that say what to *do*, not how she feels: a 9B
// model handed "stress: 0.7" produces generic-assistant stress ("I'm a bit
// overwhelmed 😅"); handed "quicker to snap, no patience for tangents" it
// snaps. Two, because the model honours the last few tone lines it reads and
// no more; everything else here stays a number.
//
// Placed before the irritation, grudge and ego lines in the prompt, so those
// — which have hard behavioural consequences — outrank it. The warm cues are
// also withheld once she is actually annoyed: fond and fed up at once reads
// as neither.

type VitalCue = {
  /** How far past its threshold, 0..1; 0 means the cue is silent. */
  strength: (vitals: Vitals) => number;
  line: string;
  /** Withheld while irritation is up. */
  warm?: boolean;
};

const past = (value: number, from: number, to: number) => Math.max(0, Math.min(1, (value - from) / (to - from)));

const VITAL_CUES: VitalCue[] = [
  {
    strength: v => past(v.sleepiness, 0.6, 1),
    line: 'You are physically drowsy — it is late for you, or it has been a long day. Slower and shorter than usual, no energy for a proper rant, and you can say you are tired; if they are the reason you are still up, hold it against them.',
  },
  {
    // Redundant with drowsy, which says the same thing with a cause.
    strength: v => v.sleepiness >= 0.6 ? 0 : past(v.energy, 0.3, 0),
    line: 'You are flat and low on energy. Short replies, no exclamation marks, and orders given without your usual force — you cannot be bothered to shout.',
  },
  {
    strength: v => past(v.stress, 0.55, 1),
    line: 'You are on edge — wound up about them and their list. Sharper than usual, no patience for tangents, quicker to snap, and do not pretend to be calm.',
  },
  {
    strength: v => past(v.happiness, 0.3, 0),
    line: 'You are in a foul mood, and not because of anything they just said. Everything gets the sour version, and you do not explain why.',
  },
  {
    strength: v => past(v.happiness, 0.85, 1),
    line: 'You are in a good mood for once. The digs come lighter, almost playful — still digs, still not nice, but you are enjoying yourself.',
    warm: true,
  },
  {
    strength: v => past(v.affection, 0.8, 1),
    line: 'Right now you are fonder of them than you let on. Keep the digs, but let it slip once — one grudging admission, a single line — and then cover it with an order.',
    warm: true,
  },
  {
    strength: v => past(v.affection, 0.25, 0),
    line: 'They have left you alone a long while and you have gone cold: distant, uninterested, and they can work for your attention.',
  },
  {
    strength: v => past(v.curiosity, 0.8, 1),
    line: 'Something has your interest. One pointed question about what they are actually doing is allowed — a real one, not a polite one.',
    warm: true,
  },
];

/** How many cues may speak at once. */
export const VITAL_CUES_SPOKEN = 2;
/** From here up she is annoyed, and the warm cues stay quiet (mood.ts moodInstruction speaks from 3). */
const ANNOYED_FROM = 3;

/** The tone line her vitals add to the prompt, or nothing when nothing has drifted far. */
export function vitalsInstruction(vitals: Vitals | undefined, irritation = 0): string {
  if (!vitals) return '';
  const annoyed = irritation >= ANNOYED_FROM;
  return VITAL_CUES
    .filter(cue => !(annoyed && cue.warm))
    .map(cue => ({ cue, strength: cue.strength(vitals) }))
    .filter(entry => entry.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, VITAL_CUES_SPOKEN)
    .map(entry => entry.cue.line)
    .join(' ');
}

// Events that move her outside the slow drift.
export function applyEvent(current: Vitals, event: 'praised' | 'criticised' | 'spoken-to' | 'ignored-user'): Vitals {
  const next = { ...current };
  if (event === 'praised') { next.happiness = clamp(next.happiness + 0.2); next.affection = clamp(next.affection + 0.15); next.energy = clamp(next.energy + 0.1); }
  if (event === 'criticised') { next.happiness = clamp(next.happiness - 0.25); next.stress = clamp(next.stress + 0.2); }
  if (event === 'spoken-to') { next.curiosity = clamp(next.curiosity + 0.2); next.affection = clamp(next.affection + 0.05); next.sleepiness = clamp(next.sleepiness - 0.05); }
  if (event === 'ignored-user') { next.stress = clamp(next.stress + 0.1); }
  return next;
}

export type IdleAction = 'blink' | 'glance' | 'smile' | 'stretch' | 'yawn' | 'fidget' | 'tilt' | 'sigh' | 'lean-in' | 'think' | 'settle' | 'doze' | 'sparkle';

// Baseline chances, before her state has any say. Roughly the shape of a person
// sitting quietly: mostly small eye movements, occasionally something bigger.
// Every entry must be non-zero: the state scales these, and no multiplier can
// rescue a baseline of zero — dozing was unreachable in every state until this
// was 1 rather than 0.
const BASE_WEIGHTS: Record<IdleAction, number> = {
  blink: 35, glance: 25, tilt: 10, smile: 8, fidget: 6, stretch: 4,
  yawn: 2, sigh: 2, think: 3, 'lean-in': 2, settle: 2, doze: 1, sparkle: 1,
};

// Weighted rather than scheduled: nothing is on a timer, so the same state can
// produce different behaviour and she never loops visibly. Her state scales the
// baseline rather than replacing it, so the character of the idle stays intact
// while the emphasis shifts — sleepy means more yawning, not a different person.
export function idleActionWeights(vitals: Vitals, environment: Environment): Record<IdleAction | 'nothing', number> {
  const { sleepiness, energy, curiosity, focus, happiness } = vitals;
  const night = isNight(environment.hour);
  const alone = environment.idleSeconds > 300;
  const awake = 1 - sleepiness;
  const scale: Record<IdleAction, number> = {
    blink: 1,
    glance: 0.4 + curiosity * 1.4,
    tilt: 0.3 + curiosity * 1.5,
    smile: 0.2 + happiness * 1.8,
    fidget: 0.4 + energy * 1.2,
    stretch: sleepiness > 0.35 && sleepiness < 0.8 ? 1.8 : 0.4,
    yawn: sleepiness > 0.5 ? sleepiness * 3 : 0,
    sigh: (1 - happiness) * 2 + (alone ? 0.8 : 0),
    think: focus > 0.5 ? focus * 1.6 : 0.3,
    'lean-in': focus > 0.65 ? focus * 2 : 0,
    settle: sleepiness * 2,
    // Only when it is genuinely late, she is tired, and nobody is about.
    doze: night && sleepiness > 0.8 && alone ? 30 : 0,
    sparkle: happiness > 0.7 && awake > 0.5 ? happiness * 1.5 : 0,
  };
  const weights = {} as Record<IdleAction | 'nothing', number>;
  for (const action of Object.keys(BASE_WEIGHTS) as IdleAction[]) {
    weights[action] = BASE_WEIGHTS[action] * scale[action];
  }
  // Stillness has to outweigh everything else put together, not merely be the
  // largest single entry — the movements sum to roughly 100 at rest, so this
  // sits around twice that and she spends most ticks simply being.
  weights.nothing = 190 + sleepiness * 140 + (alone ? 120 : 0);
  return weights;
}

export function chooseIdleAction(vitals: Vitals, environment: Environment, random: () => number = Math.random): IdleAction | null {
  const weights = idleActionWeights(vitals, environment);
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const [action, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll < 0) return action === 'nothing' ? null : action as IdleAction;
  }
  return null;
}

// How long to wait before looking again. She checks in more often when alert and
// lets longer gaps pass when she is winding down.
export function nextTickDelayMs(vitals: Vitals, random: () => number = Math.random) {
  const alertness = 1 - vitals.sleepiness;
  const base = 30_000 - alertness * 18_000;
  return Math.round(base * (0.7 + random() * 0.6));
}

// --- how often any of this reaches the disk ---------------------------------

/**
 * The life loop ticks every 8-39 seconds and used to persist the vitals on
 * every one of them. electron-store rewrites the whole config file per set, so
 * that was the entire store — persona, keys, memories — written to disk some
 * four thousand times a day to record a drift of 0.003 in sleepiness.
 *
 * Nothing needs the saved copy to be current. It exists for one purpose: so
 * that closing and reopening the app does not hand back a factory-fresh mood.
 * A copy a few minutes old serves that exactly as well as a copy from four
 * seconds ago, and the one moment precision would matter — a real change of
 * state — is the one this still writes immediately.
 */
export const VITALS_SAVE_DELTA = 0.05;
export const VITALS_SAVE_INTERVAL_MS = 5 * 60_000;

export function shouldPersistVitals(current: Vitals, saved: Vitals | null, sinceSaveMs: number): boolean {
  if (!saved) return true;
  if (sinceSaveMs >= VITALS_SAVE_INTERVAL_MS) return true;
  return (Object.keys(current) as (keyof Vitals)[])
    .some(key => Math.abs((current[key] ?? 0) - (saved[key] ?? 0)) >= VITALS_SAVE_DELTA);
}
