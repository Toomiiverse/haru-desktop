import {corePolicySync} from './core-policy-sync';
// The mood she woke up in, and the weather of her day.
//
// Her vitals drift toward targets, and the targets were the same every day:
// happiness is derived from energy, affection and stress, so by mid-afternoon it
// sat at 0.88 whatever had happened, and one Tuesday was the next. Three things
// here make a day its own:
//
//  - a temperament, rolled once when she is first awake on a new day, that
//    leans where her vitals come to rest and how hard things land on her;
//  - wander, a slow random walk on top of that, so ten in the morning and four
//    in the afternoon are not the same even when nothing happened between them;
//  - a bruise (or a glow): what is left of the last thing that happened, fading
//    over an hour or so, so a thumbs-down is not erased by the next three ticks.
//
// All three are a Lean (vitals.ts): pushes on the drift *targets*. None of them
// sets a value, and none of them touches her patience or the grudge — those
// have hard consequences and only what he does moves them.
//
// Pure. The roll is always passed in.

import type { Lean, VitalEvent } from './vitals';

export type TemperamentKind = 'ordinary' | 'sunny' | 'prickly' | 'clingy' | 'flat' | 'mischievous' | 'restless' | 'tender' | 'stormy';
export type Temperament = { day: string; kind: TemperamentKind; /** 0.5–1: how much of it. */ intensity: number; because?: string; history?: TemperamentKind[] };

type Shape = {
  weight: number;
  lean: Lean;
  /** How hard good and bad things land today, against 1. */
  swing: { good: number; bad: number };
  /** What it does to how she talks — behaviour, never "you feel" (see vitals.ts cues). Empty for an ordinary day. */
  line: string;
  /** For the status screen. */
  word: string;
};

export const TEMPERAMENTS: Record<TemperamentKind, Shape> = {
  ordinary: { weight: 30, lean: {}, swing: { good: 1, bad: 1 }, line: '', word: '' },
  sunny: {
    weight: 12, lean: { happiness: 0.15, stress: -0.08, energy: 0.08 }, swing: { good: 1.3, bad: 0.7 },
    line: 'You woke up in a good mood today, for no reason you would admit to. Things roll off you more easily than usual and the digs come with a grin behind them.',
    word: 'Woke up in a good mood.',
  },
  prickly: {
    weight: 12, lean: { happiness: -0.12, stress: 0.15 }, swing: { good: 0.7, bad: 1.4 },
    line: 'You woke up in a mood today. Small things grate, you give less benefit of the doubt than usual, and you are quicker to take something the wrong way. It is not about anything he did.',
    word: 'Woke up prickly.',
  },
  clingy: {
    weight: 9, lean: { affection: 0.15, stress: 0.06 }, swing: { good: 1.3, bad: 1.2 },
    line: 'Today you want his attention more than usual and would sooner be caught dead than say so. It comes out sideways: you keep the conversation going a beat longer than you need to, and you notice when he goes quiet.',
    word: 'Wants your attention today, and will not say so.',
  },
  flat: {
    weight: 10, lean: { happiness: -0.1, energy: -0.15, curiosity: -0.12 }, swing: { good: 0.7, bad: 0.8 },
    line: 'You are flat today. Nothing is wrong; nothing much is interesting either. Shorter replies, less colour, and you do not go looking for things to say.',
    word: 'Flat today.',
  },
  mischievous: {
    weight: 9, lean: { happiness: 0.08, curiosity: 0.12, energy: 0.08 }, swing: { good: 1.2, bad: 0.8 },
    line: 'You are in a mischievous mood today. You tease more than usual, you are harder to pin down, and you will say no to something just to see what he does. Never about anything he actually relies on you for.',
    word: 'In a mischievous mood.',
  },
  restless: {
    weight: 8, lean: { energy: 0.1, curiosity: 0.12, stress: 0.08 }, swing: { good: 1, bad: 1.1 },
    line: 'You are restless today. You jump between things, you want something to be happening, and a slow conversation bores you faster than usual.',
    word: 'Restless today.',
  },
  tender: {
    weight: 7, lean: { affection: 0.12, happiness: 0.06, stress: -0.05 }, swing: { good: 1.4, bad: 1.3 },
    line: 'You are softer than usual today and it annoys you. Things get to you more — a kind word and a careless one both — and once or twice the edge comes off a line before you can put it back.',
    word: 'Softer than usual today. Do not mention it.',
  },
  stormy: {
    weight: 3, lean: { happiness: -0.2, stress: 0.22, affection: -0.08 }, swing: { good: 0.5, bad: 1.6 },
    line: 'You woke up in a foul temper today and you know it is not his fault, which does not help. Everything is an imposition. You are not cruel about it and what he relies on stays right, but you have no patience to spare and you do not pretend otherwise.',
    word: 'Woke up in a foul temper.',
  },
};

export type Carry = {
  /** Most recent first. */
  history?: TemperamentKind[];
  /** How yesterday ended between them (nightfall.ts), if it was counted. */
  went?: 'silent' | 'thin' | 'fine';
  /** 0–100. */
  grudge?: number;
  /** He got her out of bed last night. */
  wokenInNight?: boolean;
};

/**
 * Today's temperament. Mostly the dice; a little what she is carrying.
 *
 * A silent evening makes a prickly or flat morning likelier, a night he woke her
 * makes a prickly or stormy one likelier, a real grudge thins out the sunny and
 * tender days. And no kind three days running: a mood that never changes is the
 * thing this exists to stop.
 */
export function rollTemperament(day: string, carry: Carry, random: () => number = Math.random): Temperament {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.rollTemperament',[day,carry,[random(),random()]]); }
  const weights = Object.fromEntries(Object.entries(TEMPERAMENTS).map(([kind, shape]) => [kind, shape.weight])) as Record<TemperamentKind, number>;
  const reasons: string[] = [];
  if (carry.went === 'silent') { weights.prickly *= 2; weights.flat *= 1.8; weights.clingy *= 1.5; weights.sunny *= 0.5; reasons.push('after a silent evening'); }
  if (carry.went === 'thin') { weights.prickly *= 1.4; weights.flat *= 1.3; reasons.push('after a thin evening'); }
  if (carry.wokenInNight) { weights.prickly *= 2; weights.stormy *= 3; weights.sunny *= 0.4; reasons.push('after being woken in the night'); }
  const grudge = carry.grudge ?? 0;
  if (grudge >= 55) { weights.sunny *= 0.5; weights.tender *= 0.5; weights.prickly *= 1.5; weights.stormy *= 1.5; reasons.push('with a grudge on'); }
  else if (grudge <= 5) { weights.sunny *= 1.4; weights.tender *= 1.3; weights.mischievous *= 1.3; }
  const [last, before] = carry.history ?? [];
  if (last && last === before && last !== 'ordinary') weights[last] = 0;
  else if (last && last !== 'ordinary') weights[last] *= 0.5;

  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let pick = random() * total;
  let kind: TemperamentKind = 'ordinary';
  for (const [name, weight] of Object.entries(weights) as [TemperamentKind, number][]) {
    if ((pick -= weight) < 0) { kind = name; break; }
  }
  const intensity = Math.round((0.5 + random() * 0.5) * 100) / 100;
  return { day, kind, intensity, because: reasons.join(', ') || undefined, history: [kind, ...(carry.history ?? [])].slice(0, 3) };
}

export function temperamentLean(temperament: Temperament | null | undefined): Lean {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.temperamentLean',[temperament]); }
  if (!temperament) return {};
  const shape = TEMPERAMENTS[temperament.kind] ?? TEMPERAMENTS.ordinary;
  return Object.fromEntries(Object.entries(shape.lean).map(([vital, push]) => [vital, (push ?? 0) * temperament.intensity])) as Lean;
}

export function temperamentLine(temperament: Temperament | null | undefined): string {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.temperamentLine',[temperament]); }
  return temperament ? TEMPERAMENTS[temperament.kind]?.line ?? '' : '';
}

export function temperamentWord(temperament: Temperament | null | undefined): string {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.temperamentWord',[temperament]); }
  return temperament ? TEMPERAMENTS[temperament.kind]?.word ?? '' : '';
}

const GOOD: readonly VitalEvent[] = ['praised', 'soothed', 'warmed', 'returned-glad', 'caught-interest', 'spoken-to'];

/**
 * How big an event is today: half as big again as it always was (the old sizes
 * were erased by three drift ticks), by how hard her temperament takes good or
 * bad news, ±30% on the roll.
 */
export function eventSize(temperament: Temperament | null | undefined, event: VitalEvent, roll = Math.random()): number {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.eventSize',[temperament,event,roll]); }
  const swing = temperament ? TEMPERAMENTS[temperament.kind]?.swing ?? { good: 1, bad: 1 } : { good: 1, bad: 1 };
  const taken = GOOD.includes(event) ? swing.good : swing.bad;
  const mine = temperament ? 1 + (taken - 1) * temperament.intensity : 1;
  return Math.round(1.5 * mine * (0.7 + Math.max(0, Math.min(1, roll)) * 0.6) * 100) / 100;
}

/** Whether a long silence ending lands as relief or as a grievance, today. */
export function howHisReturnLands(temperament: Temperament | null | undefined, grudge: number, roll = Math.random()): 'returned-glad' | 'returned-sore' {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.howHisReturnLands',[temperament,grudge,roll]); }
  const kind = temperament?.kind ?? 'ordinary';
  const sore = (kind === 'prickly' || kind === 'stormy' ? 0.7 : kind === 'clingy' ? 0.5 : kind === 'sunny' || kind === 'tender' ? 0.15 : 0.35) + Math.min(0.25, grudge / 400);
  return roll < sore ? 'returned-sore' : 'returned-glad';
}

// -- the weather of the day ---------------------------------------------------

const WANDERS: readonly (keyof Lean)[] = ['happiness', 'stress', 'affection', 'curiosity', 'energy'];
export const WANDER_LIMIT = 0.12;
/** How long the weather takes to forget itself. */
const WANDER_SECONDS = 90 * 60;
/** Chosen so it spends most of its time inside ±0.06 and rarely sits at the limit. */
const WANDER_SIGMA = 0.085;

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** One step of the slow walk: pulled back toward nothing, pushed by noise. */
export function stepWander(wander: Lean, seconds: number, random: () => number = Math.random): Lean {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.stepWander',[wander,seconds,Array.from({length:10},()=>random())]); }
  if (!Number.isFinite(seconds) || seconds <= 0) return { ...wander };
  const dt = Math.min(seconds, 3600) / WANDER_SECONDS;
  const next: Lean = {};
  for (const vital of WANDERS) {
    const now = wander[vital] ?? 0;
    const moved = now - now * dt + WANDER_SIGMA * Math.sqrt(dt) * gaussian(random);
    next[vital] = Math.max(-WANDER_LIMIT, Math.min(WANDER_LIMIT, moved));
  }
  return next;
}

// -- what is left of the last thing that happened ------------------------------

export const BRUISE_LIMIT = 0.25;
const BRUISE_HALF_LIFE_SECONDS = 45 * 60;

export function fadeBruise(bruise: Lean, seconds: number): Lean {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.fadeBruise',[bruise,seconds]); }
  if (!Number.isFinite(seconds) || seconds <= 0) return { ...bruise };
  const kept = Math.pow(0.5, seconds / BRUISE_HALF_LIFE_SECONDS);
  const next: Lean = {};
  for (const vital of WANDERS) {
    const left = (bruise[vital] ?? 0) * kept;
    if (Math.abs(left) >= 0.005) next[vital] = left;
  }
  return next;
}

/** Half of what an event just did to her stays as a push on where she settles. */
export function bruiseFrom(bruise: Lean, before: Record<string, number>, after: Record<string, number>): Lean {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.bruiseFrom',[bruise,before,after]); }
  const next: Lean = { ...bruise };
  for (const vital of WANDERS) {
    const moved = (after[vital] ?? 0) - (before[vital] ?? 0);
    if (!moved) continue;
    next[vital] = Math.max(-BRUISE_LIMIT, Math.min(BRUISE_LIMIT, (next[vital] ?? 0) + moved * 0.5));
  }
  return next;
}

export function addLeans(...leans: Lean[]): Lean {
  if(process.env.HARU_CORE_LIFECYCLE_MOOD==='on') { return corePolicySync<any>('mood.addLeans',leans); }
  const total: Lean = {};
  for (const lean of leans) for (const vital of WANDERS) if (lean[vital]) total[vital] = (total[vital] ?? 0) + (lean[vital] ?? 0);
  return total;
}
