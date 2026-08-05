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

// Events that move her outside the slow drift.
export function applyEvent(current: Vitals, event: 'praised' | 'criticised' | 'spoken-to' | 'ignored-user'): Vitals {
  const next = { ...current };
  if (event === 'praised') { next.happiness = clamp(next.happiness + 0.2); next.affection = clamp(next.affection + 0.15); next.energy = clamp(next.energy + 0.1); }
  if (event === 'criticised') { next.happiness = clamp(next.happiness - 0.25); next.stress = clamp(next.stress + 0.2); }
  if (event === 'spoken-to') { next.curiosity = clamp(next.curiosity + 0.2); next.affection = clamp(next.affection + 0.05); next.sleepiness = clamp(next.sleepiness - 0.05); }
  if (event === 'ignored-user') { next.stress = clamp(next.stress + 0.1); }
  return next;
}

export type IdleAction = 'glance' | 'yawn' | 'stretch' | 'shift' | 'perk-up' | 'settle' | 'doze';

// Weighted rather than scheduled: nothing is on a timer, so the same state can
// produce different behaviour and she never loops visibly. Most ticks are meant
// to come back null — stillness is what makes the movement read as deliberate.
export function idleActionWeights(vitals: Vitals, environment: Environment): Record<IdleAction | 'nothing', number> {
  const { sleepiness, energy, curiosity, focus } = vitals;
  const night = isNight(environment.hour);
  const alone = environment.idleSeconds > 300;
  return {
    // Stillness dominates, and more so when she is winding down.
    nothing: 6 + sleepiness * 6 + (alone ? 3 : 0),
    glance: curiosity * 5 + (environment.idleSeconds < 30 ? 2 : 0),
    yawn: sleepiness > 0.55 ? sleepiness * 4 : 0,
    stretch: sleepiness < 0.6 && energy < 0.5 ? 2 : 0.4,
    shift: 1.5 + (1 - focus) * 1.5,
    'perk-up': focus > 0.7 ? focus * 2.5 : 0,
    settle: sleepiness > 0.5 ? sleepiness * 2 : 0.2,
    doze: night && sleepiness > 0.8 && alone ? 4 : 0,
  };
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
