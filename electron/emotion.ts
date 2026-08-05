// The emotion engine. The model reports what it meant by a reply; the behaviour
// engine turns that into movement. Semantic labels rather than animation names,
// so the same reading works on any model.
//
// Classification runs as its own call, not folded into the chat one: the chat
// call carries the tool schema for reminders and memory, and asking for forced
// JSON alongside tools tends to cost one or the other. Keeping them apart means
// the reply is never delayed or degraded by this.

export const EMOTIONS = ['neutral', 'happy', 'curious', 'smug', 'annoyed', 'bored', 'sleepy', 'surprised', 'affectionate', 'embarrassed'] as const;
export const INTENTS = ['listen', 'explain', 'tease', 'dismiss', 'celebrate', 'soothe'] as const;
export const FOCUSES = ['user', 'self', 'task', 'away'] as const;

export type EmotionName = typeof EMOTIONS[number];
export type Intent = typeof INTENTS[number];
export type FocusTarget = typeof FOCUSES[number];

export type Emotion = {
  emotion: EmotionName;
  confidence: number;
  energy: number;
  intent: Intent;
  focus: FocusTarget;
};

export const NEUTRAL_EMOTION: Emotion = { emotion: 'neutral', confidence: 0.5, energy: 0.5, intent: 'listen', focus: 'user' };

// Handed to Ollama as `format`, which constrains generation to match — far more
// reliable than asking for JSON in the prompt and hoping.
export const EMOTION_SCHEMA = {
  type: 'object',
  properties: {
    emotion: { type: 'string', enum: [...EMOTIONS] },
    confidence: { type: 'number' },
    energy: { type: 'number' },
    intent: { type: 'string', enum: [...INTENTS] },
    focus: { type: 'string', enum: [...FOCUSES] },
  },
  required: ['emotion', 'confidence', 'energy', 'intent', 'focus'],
};

const clamp01 = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
};

// Anything unrecognised falls back to the neutral reading rather than throwing.
// A bad classification should cost her an expression, never a reply.
export function parseEmotion(raw: unknown): Emotion | null {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const emotion = EMOTIONS.includes(record.emotion as EmotionName) ? record.emotion as EmotionName : null;
  if (!emotion) return null;
  return {
    emotion,
    confidence: clamp01(record.confidence, 0.5),
    energy: clamp01(record.energy, 0.5),
    intent: INTENTS.includes(record.intent as Intent) ? record.intent as Intent : 'listen',
    focus: FOCUSES.includes(record.focus as FocusTarget) ? record.focus as FocusTarget : 'user',
  };
}

// What each reading does to how she feels. Scaled by confidence, so a hedged
// classification barely moves her and a certain one moves her properly.
const VITAL_SHIFTS: Record<EmotionName, Partial<Record<'happiness' | 'curiosity' | 'affection' | 'stress' | 'sleepiness' | 'energy', number>>> = {
  neutral: {},
  happy: { happiness: 0.2, energy: 0.1 },
  curious: { curiosity: 0.25, energy: 0.05 },
  smug: { happiness: 0.12, affection: -0.05 },
  annoyed: { happiness: -0.18, stress: 0.15 },
  bored: { curiosity: -0.2, energy: -0.1 },
  sleepy: { sleepiness: 0.15, energy: -0.15 },
  surprised: { curiosity: 0.2, energy: 0.15 },
  affectionate: { affection: 0.2, happiness: 0.15 },
  embarrassed: { stress: 0.12, affection: 0.08 },
};

export function emotionToVitals<T extends Record<string, number>>(emotion: Emotion, vitals: T): T {
  const next = { ...vitals } as Record<string, number>;
  const shifts = VITAL_SHIFTS[emotion.emotion];
  for (const [key, amount] of Object.entries(shifts)) {
    if (typeof next[key] !== 'number') continue;
    next[key] = Math.min(1, Math.max(0, next[key] + amount * emotion.confidence));
  }
  // The reported energy pulls her own toward it rather than replacing it, so one
  // lively reply does not make her lively for the rest of the evening.
  if (typeof next.energy === 'number') {
    next.energy = Math.min(1, Math.max(0, next.energy + (emotion.energy - next.energy) * 0.3 * emotion.confidence));
  }
  return next as T;
}

// The labels are spelled out because leaving them to the model's own reading
// went wrong in a specific way: it treated low energy as sleepiness, calling a
// line about missing someone "sleepy" and a line about nodding off "neutral".
// Sleepiness is a physical state, not a volume level, and that has to be said.
const EMOTION_GLOSSES = [
  'neutral: matter-of-fact, nothing much felt',
  'happy: pleased or delighted',
  'curious: interested, wants to know more',
  'smug: self-satisfied, pleased at being right',
  'annoyed: irritated or impatient',
  'bored: uninterested, cannot be bothered',
  'sleepy: physically drowsy, nodding off, about to sleep — not merely quiet or low-energy',
  'surprised: caught off guard',
  'affectionate: warm toward the listener, fond of them, admitting they matter',
  'embarrassed: flustered or caught out, often while admitting something',
].join('; ');

export function classificationPrompt(mood: { irritation: number; ego: number }) {
  return [
    'You label the emotional state behind a line of dialogue for an animated character.',
    'Read the line and report what the speaker felt as they said it, not what the listener would feel.',
    `The labels mean: ${EMOTION_GLOSSES}.`,
    'A quiet or short line is not automatically sleepy — only pick sleepy when the words are about tiredness or sleep.',
    `For context she is currently ${mood.irritation >= 5 ? 'thoroughly fed up' : mood.irritation >= 3 ? 'impatient' : 'even-tempered'} and ${mood.ego >= 6 ? 'insufferably pleased with herself' : mood.ego >= 4 ? 'rather full of herself' : 'not especially smug'}.`,
    'confidence is how sure you are of the label. energy is how animated the delivery is, 0 flat and 1 bouncing.',
    'intent is what she was doing: listen, explain, tease, dismiss, celebrate or soothe.',
    'focus is where her attention sits: user, self, task or away.',
    'Reply with the JSON object only.',
  ].join(' ');
}
