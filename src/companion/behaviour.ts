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
  /** A gesture currently playing, if any. */
  gesture?: Gesture | null;
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
  // A stare outweighs everything else on purpose — it is the one behaviour whose
  // whole point is that she is looking straight at you and not at the pointer.
  if (state.gesture) {
    const target = gestureGaze(state.gesture);
    if (target) layers.push({ target, weight: 4 });
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

// Where each behaviour sends her eyes. The face itself is handled by the pose
// layer; this is only the gaze half, which is why several entries hold still.
export const ACTION_SHAPES: Record<string, ActionShape> = {
  glance: { gaze: 'wander', durationMs: 2200, expressionMood: 'curious' },
  tilt: { gaze: 'wander', durationMs: 2400, expressionMood: 'curious' },
  fidget: { gaze: 'wander', durationMs: 1600, expressionMood: 'neutral' },
  yawn: { gaze: 'down', durationMs: 2600, expressionMood: 'sleepy' },
  sigh: { gaze: 'down', durationMs: 2000, expressionMood: 'neutral' },
  settle: { gaze: 'down', durationMs: 3000, expressionMood: 'neutral' },
  doze: { gaze: 'down', durationMs: 6000, expressionMood: 'sleepy' },
  stretch: { gaze: 'up', durationMs: 2400, expressionMood: 'neutral' },
  think: { gaze: 'up', durationMs: 3000, expressionMood: 'curious' },
  // These read on the face rather than in the eyes, so the gaze carries on
  // doing whatever it was doing.
  blink: { gaze: 'hold', durationMs: 420, expressionMood: 'neutral' },
  smile: { gaze: 'hold', durationMs: 2600, expressionMood: 'happy' },
  sparkle: { gaze: 'hold', durationMs: 1800, expressionMood: 'happy' },
  'lean-in': { gaze: 'hold', durationMs: 2400, expressionMood: 'happy' },
};

export function gazeForAction(shape: ActionShape, random: () => number = Math.random): Gaze | null {
  if (shape.gaze === 'hold') return null;
  if (shape.gaze === 'down') return { x: (random() - 0.5) * 0.3, y: -0.75 };
  if (shape.gaze === 'up') return { x: (random() - 0.5) * 0.4, y: 0.6 };
  return randomWanderTarget(random);
}

// Models ship plenty of expressions that are wardrobe, not feeling — colour
// swaps, chibi mode, tail and arm toggles. Playing one of those as a reaction is
// worse than playing nothing, so they are excluded outright.
const COSMETIC = /(colou?r|chibi|on ?off|toggle|outfit|costume|hair \d|arm |tail )/i;

// A folder grouping expressions by feeling is the author saying which ones are
// reactions. Those win over an equally good match sitting loose in the root.
const CURATED = /(^|\/)(emotion|emotions|expression|expressions|face|faces|mood|moods)\//i;

// Ordered best-guess first. Matched against whatever the model actually ships,
// so nothing assumes a naming convention.
const EXPRESSION_HINTS: Record<ActionShape['expressionMood'], RegExp[]> = {
  happy: [/heart/i, /(smile|happy|joy|glad|grin|laugh|excite)/i, /blush/i],
  sleepy: [/(sleep|tired|doze|drowsy|closed? ?eyes)/i, /(rest|calm)/i],
  // No fallback to hearts: on a model with no curiosity expression that landed
  // on "heart eyes", making an idle glance read as lovestruck. Playing nothing
  // is better than playing the wrong feeling.
  curious: [/(curious|question|wonder|think|interest)/i, /(surprise|shock)/i],
  neutral: [/(neutral|normal|default|idle)/i],
};

function selectExpression(patterns: RegExp[], available: string[]): string | null {
  const usable = available.filter(name => !COSMETIC.test(name));
  if (!usable.length) return null;
  // Each pattern is tried against the curated set before the loose one, so a
  // rough match in Emotions/ beats an exact match among the wardrobe files.
  const curated = usable.filter(name => CURATED.test(name));
  const rest = usable.filter(name => !CURATED.test(name));
  for (const pattern of patterns) {
    const hit = curated.find(name => pattern.test(name)) ?? rest.find(name => pattern.test(name));
    if (hit) return hit;
  }
  return null;
}

export function pickExpression(mood: ActionShape['expressionMood'], available: string[]): string | null {
  return selectExpression(EXPRESSION_HINTS[mood] ?? [], available);
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

// Each label gets its own ordered candidates rather than being squeezed through
// the four idle moods first — going via those threw away most of the detail,
// leaving annoyed and bored both asking for a neutral face.
const EMOTION_HINTS: Record<EmotionName, RegExp[]> = {
  neutral: [/(neutral|normal|default|idle)/i],
  happy: [/heart/i, /(smile|happy|joy|grin|glad|laugh)/i, /blush/i],
  curious: [/(curious|question|wonder|think|interest)/i, /(surprise|shock)/i],
  smug: [/(smug|smirk|proud)/i, /(squeez|squint)/i],
  annoyed: [/(upset|angry|annoy|mad|cross|irritat|pout)/i, /(squeez|squint|frown)/i],
  bored: [/(bored|blank|empty|dead|unimpress)/i, /(squeez|squint)/i],
  sleepy: [/(sleep|tired|doze|drowsy|closed? ?eyes)/i],
  surprised: [/(surprise|shock|startle|scared|fright)/i, /(empty|wide)/i],
  affectionate: [/heart/i, /(love|blush|shy|fond)/i, /(smile|happy)/i],
  embarrassed: [/(blush|shy|flust|embarrass)/i, /(squeez|squint|cry)/i],
};

// Neutral resolves to nothing on purpose: with no explicit neutral expression to
// return to, leaving the current one alone reads better than forcing an
// unrelated face on every level-headed reply.
export function expressionForEmotion(emotion: Emotion, available: string[]): string | null {
  return selectExpression(EMOTION_HINTS[emotion.emotion] ?? [], available);
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

// --- gesture layer ---------------------------------------------------------
// Short, deliberate head movements laid over whatever else is happening. Kept as
// curves over normalised time rather than keyframed animations, so they work on
// any model that has the standard angle parameters.

export type Gesture = 'nod' | 'shake' | 'stare';

export const GESTURE_DURATION_MS: Record<Gesture, number> = { nod: 1100, shake: 900, stare: 2600 };

/** Degrees to add to head pitch (Y) and yaw (X) at this point through a gesture. */
export function gestureOffset(gesture: Gesture, progress: number): { pitch: number; yaw: number } {
  const t = Math.min(1, Math.max(0, progress));
  // Tapers at both ends so a gesture starts and finishes from rest rather than
  // snapping into place.
  const envelope = Math.sin(t * Math.PI);
  if (gesture === 'nod') return { pitch: -Math.sin(t * Math.PI * 4) * 14 * envelope, yaw: 0 };
  if (gesture === 'shake') return { pitch: 0, yaw: Math.sin(t * Math.PI * 4) * 12 * envelope };
  return { pitch: 0, yaw: 0 };
}

// A stare fixes her gaze forward rather than on the cursor — being looked at
// directly is the point, so the pointer must not drag her eyes away.
export function gestureGaze(gesture: Gesture): Gaze | null {
  return gesture === 'stare' ? { x: 0, y: 0.08 } : null;
}

// How the reaction buttons read as feeling. Praise alternates so repeated
// thumbs-ups do not produce the same face twice running.
export function reactionBeat(reaction: 'up' | 'down', previousWasSmug: boolean): { emotion: EmotionName; gesture: Gesture; energy: number } {
  if (reaction === 'down') return { emotion: 'annoyed', gesture: 'stare', energy: 0.45 };
  return previousWasSmug
    ? { emotion: 'happy', gesture: 'nod', energy: 0.8 }
    : { emotion: 'smug', gesture: 'nod', energy: 0.65 };
}
