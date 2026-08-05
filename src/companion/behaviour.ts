// Where Haru's gaze should sit, resolved every frame from independent layers
// rather than from a fixed animation. Each layer contributes a target and a
// weight and the result is blended, so an idle glance can bleed into cursor
// tracking instead of cutting between them.
//
// Coordinates are the model's own focus space: -1..1 on each axis, 0,0 straight
// ahead. Pure, so the blending can be checked without a canvas.

import type { Emotion, EmotionName, FocusTarget, Vitals } from '../types';

export type Gaze = { x: number; y: number };
export type Layer = { target: Gaze; weight: number };

export type BehaviourState = {
  /** Where the cursor is, in focus space. */
  cursor: Gaze;
  /** Set by an idle action: somewhere she has chosen to look instead. */
  wander: Gaze | null;
  /** 0-1, how far through the current idle action we are. */
  actionProgress: number;
  vitals: Vitals;
  /** Seconds of no input anywhere on the machine. */
  idleSeconds: number;
  /** The most recent reading from the model, if any. */
  emotion?: Emotion | null;
  /** 1 while the reading is fresh, easing to 0 as it fades. */
  emotionStrength: number;
};

export function blend(layers: Layer[]): Gaze {
  const total = layers.reduce((sum, layer) => sum + Math.max(0, layer.weight), 0);
  if (total <= 0) return { x: 0, y: 0 };
  return layers.reduce((gaze, layer) => {
    const weight = Math.max(0, layer.weight) / total;
    return { x: gaze.x + layer.target.x * weight, y: gaze.y + layer.target.y * weight };
  }, { x: 0, y: 0 });
}

// The attention layer: how strongly the cursor pulls her eyes. Strong when
// someone is plainly there, fading out once the mouse has been still, and
// suppressed when she is nearly asleep.
export function attentionWeight(state: BehaviourState) {
  const { idleSeconds, vitals } = state;
  const presence = idleSeconds < 3 ? 1 : idleSeconds < 20 ? 0.6 : idleSeconds < 90 ? 0.25 : 0.05;
  return presence * (1 - vitals.sleepiness * 0.8) * (0.4 + vitals.curiosity * 0.6);
}

// An idle glance takes over briefly, easing in and back out so it does not snap.
export function wanderWeight(state: BehaviourState) {
  if (!state.wander) return 0;
  const eased = Math.sin(Math.min(1, Math.max(0, state.actionProgress)) * Math.PI);
  return eased * 1.4;
}

// Where she settles when nothing else is pulling: straight ahead when alert,
// drifting downward as she gets sleepy.
export function restingGaze(vitals: Vitals): Gaze {
  return { x: 0, y: -vitals.sleepiness * 0.5 };
}

export function resolveGaze(state: BehaviourState): Gaze {
  const layers: Layer[] = [
    { target: restingGaze(state.vitals), weight: 0.5 },
    { target: state.cursor, weight: attentionWeight(state) },
    { target: state.wander ?? { x: 0, y: 0 }, weight: wanderWeight(state) },
  ];
  // The emotion layer sits alongside the others rather than replacing them, so
  // a reading pulls her gaze without ever freezing out the cursor entirely.
  if (state.emotion && state.emotionStrength > 0) {
    const target = focusGaze(state.emotion);
    if (target) layers.push({ target, weight: emotionWeight(state.emotion) * state.emotionStrength });
  }
  return blend(layers);
}

// Somewhere plausible to look for a glance: off to one side, roughly at eye
// level, never straight down.
export function randomWanderTarget(random: () => number = Math.random): Gaze {
  const side = random() < 0.5 ? -1 : 1;
  return { x: side * (0.35 + random() * 0.5), y: (random() - 0.35) * 0.5 };
}

// Idle actions are described, never hardcoded to a motion name: the companion
// picks whichever of the model's own expressions best fits, so this works on
// any model rather than only one with a known motion set.
export type ActionShape = { gaze: 'wander' | 'down' | 'up' | 'hold'; durationMs: number; expressionMood: 'neutral' | 'happy' | 'sleepy' | 'curious' };

export const ACTION_SHAPES: Record<string, ActionShape> = {
  glance: { gaze: 'wander', durationMs: 2200, expressionMood: 'curious' },
  yawn: { gaze: 'down', durationMs: 2600, expressionMood: 'sleepy' },
  stretch: { gaze: 'up', durationMs: 2400, expressionMood: 'neutral' },
  shift: { gaze: 'wander', durationMs: 1600, expressionMood: 'neutral' },
  'perk-up': { gaze: 'hold', durationMs: 1800, expressionMood: 'happy' },
  settle: { gaze: 'down', durationMs: 3000, expressionMood: 'neutral' },
  doze: { gaze: 'down', durationMs: 6000, expressionMood: 'sleepy' },
};

export function gazeForAction(shape: ActionShape, random: () => number = Math.random): Gaze | null {
  if (shape.gaze === 'hold') return null;
  if (shape.gaze === 'down') return { x: (random() - 0.5) * 0.3, y: -0.75 };
  if (shape.gaze === 'up') return { x: (random() - 0.5) * 0.4, y: 0.6 };
  return randomWanderTarget(random);
}

// Expression names differ per model, so the mood is matched against whatever the
// model actually ships rather than assuming a naming convention. Falls back to
// leaving the expression alone, which is always safe.
const EXPRESSION_HINTS: Record<ActionShape['expressionMood'], RegExp> = {
  happy: /(happy|smile|joy|glad|fun|laugh|excite)/i,
  sleepy: /(sleep|tired|doze|rest|close|calm|sad)/i,
  curious: /(curious|surprise|interest|question|think|wonder)/i,
  neutral: /(neutral|normal|default|idle)/i,
};

export function pickExpression(mood: ActionShape['expressionMood'], available: string[]): string | null {
  if (!available.length) return null;
  const hint = EXPRESSION_HINTS[mood];
  return available.find(name => hint.test(name)) ?? null;
}

// --- emotion layer ---------------------------------------------------------
// What the model reported feeling gets translated here, once, into the same
// vocabulary the idle layers already speak. Nothing downstream knows the names
// of emotions, so adding one never means touching the animation code.

const EMOTION_MOODS: Record<EmotionName, ActionShape['expressionMood']> = {
  neutral: 'neutral', happy: 'happy', curious: 'curious', smug: 'happy',
  annoyed: 'neutral', bored: 'neutral', sleepy: 'sleepy', surprised: 'curious',
  affectionate: 'happy', embarrassed: 'sleepy',
};

export function expressionMoodFor(emotion: Emotion): ActionShape['expressionMood'] {
  return EMOTION_MOODS[emotion.emotion] ?? 'neutral';
}

// Where the reported focus puts her eyes. Only 'user' keeps her looking out;
// the rest pull her gaze away, which is what sells thinking or dismissal.
const FOCUS_GAZE: Record<FocusTarget, Gaze | null> = {
  user: null,                 // null means "leave attention to the cursor"
  self: { x: 0, y: -0.45 },   // down, inward
  task: { x: -0.3, y: -0.35 },// off toward whatever she is doing
  away: { x: 0.55, y: 0.15 }, // pointedly elsewhere
};

export function focusGaze(emotion: Emotion): Gaze | null {
  return FOCUS_GAZE[emotion.focus] ?? null;
}

// How hard the emotion pulls, so a confident reading moves her and a hedged one
// leaves the idle layers in charge.
export function emotionWeight(emotion: Emotion) {
  return emotion.confidence * (emotion.focus === 'user' ? 0 : 0.9);
}

// An emotional beat should fade rather than latch: this is how long the reading
// stays fully applied before the idle layers take back over. Livelier readings
// hold longer, because a flat one has less to show.
export function emotionHoldMs(emotion: Emotion) {
  return 2500 + emotion.energy * 3500;
}
