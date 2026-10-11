import {corePolicySync} from './core-policy-sync';
import { readTone, isHeated } from './tone';
import { IRRITATION, EGO } from './mood';

// The emotion engine. The model reports what it meant by a reply; the behaviour
// engine turns that into movement. Semantic labels rather than animation names,
// so the same reading works on any model.
//
// Classification runs as its own call, not folded into the chat one: the chat
// call carries the tool schema for reminders and memory, and asking for forced
// JSON alongside tools tends to cost one or the other. Keeping them apart means
// the reply is never delayed or degraded by this.

// Two of these were added because the voice material called for them. Asked to
// label recordings, the answer came back as "energetic, determined, motivated"
// and "neutral, worried" — none of which had anywhere to go. Those are not
// exotic states for her: driving somebody at a task and being anxious about
// them are most of what she does, and neither was expressible.
export const CORE_EMOTIONS = ['neutral', 'happy', 'curious', 'smug', 'annoyed', 'bored', 'sleepy', 'surprised', 'affectionate', 'embarrassed', 'determined', 'worried'] as const;
// Voice styles: labels she can put on a sentence that the voice performs in their own way. They sit beside the
// twelve rather than replacing any of them, and the classifier below never produces one.
export const STYLES = ['shy', 'seductive', 'teasing', 'sexy', 'direct', 'whispering', 'breathless', 'challenging', 'coy', 'knowing', 'commanding', 'possessive'] as const;
export const EMOTIONS = [...CORE_EMOTIONS, ...STYLES] as const;
export const INTENTS = ['listen', 'explain', 'tease', 'dismiss', 'celebrate', 'soothe'] as const;
export const FOCUSES = ['user', 'self', 'task', 'away'] as const;

export type EmotionName = typeof EMOTIONS[number];

/**
 * The face she pulls, chosen from what a model actually ships.
 *
 * Written out per emotion rather than matched on name hints, which is how the
 * desktop does it. Hints are the right tool when a model carries a full set of
 * emotional expressions and the names vary; they are the wrong one for a model
 * that carries five faces and seventeen wardrobe toggles. Against the real
 * model here they picked "Blush 2" for happy, affectionate and embarrassed
 * alike, found nothing for surprised even though a "scare" face exists, and
 * matched "hat off on" for nothing at all — better by luck than by design.
 *
 * Several emotions have no entry. That is the honest answer for a model with no
 * face for them: leaving the last one up would be a lie, and forcing a nearby
 * one makes her smirk when she is bored.
 */
const FACES: Partial<Record<EmotionName, RegExp[]>> = {
  annoyed: [/^angry$/i, /angry|mad|upset/i],
  worried: [/^cry$/i, /cry|sad|tear/i],
  surprised: [/^scare$/i, /scare|shock|surprise/i],
  affectionate: [/^blush$/i, /^blush(?! ?2)/i],
  embarrassed: [/^full blush$/i, /full ?blush/i, /blush ?2/i],
  happy: [/blush ?2/i, /smile|happy|joy|grin/i],
};

/**
 * Which of a model's expressions to use, or nothing.
 *
 * `available` is whatever the model declares, so this works the same for a model
 * with five expressions and one with fifty.
 */
export function faceForEmotion(emotion: EmotionName, available: string[]): string | null {
  return corePolicySync<any>('conversation-policy.faceForEmotion',[emotion,available]);
}
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

/**
 * The mood of a line, read from the line itself — no model call.
 *
 * The classifier answers "what did she mean", which is a model's job; this
 * answers "which voice clip and face", which a handful of signals can do well
 * enough: how hot the line is (tone.ts), the emoji she reached for, and the
 * words that carry the state. It exists so a phone can start speaking the
 * reply while it is still being written, where waiting a round trip for the
 * classifier would defeat the point. Anything it cannot read stays neutral,
 * which every voice and face can fall back to.
 */
export function localEmotion(text: string): EmotionName {
  return corePolicySync<any>('conversation-policy.localEmotion',[text]);
}

// Handed to Ollama as `format`, which constrains generation to match — far more
// reliable than asking for JSON in the prompt and hoping.
export const EMOTION_SCHEMA = {
  type: 'object',
  properties: {
    emotion: { type: 'string', enum: [...CORE_EMOTIONS] },
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
  return corePolicySync<any>('conversation-policy.parseEmotion',[raw]);
}

// What each reading does to how she feels. Scaled by confidence, so a hedged
// classification barely moves her and a certain one moves her properly.
// Her reading no longer moves her vitals. It used to, through emotionToVitals
// and a table of per-emotion shifts, and that made her own prose the thing that
// set her mood — see broadcastBeat in main.ts for the measurement that ended it.
// Her mood moves on events now (vitals.ts applyEvent); this file only says how
// a line was said.

// The labels are spelled out because leaving them to the model's own reading
// went wrong in a specific way: it treated low energy as sleepiness, calling a
// line about missing someone "sleepy" and a line about nodding off "neutral".
// Sleepiness is a physical state, not a volume level, and that has to be said.
const EMOTION_GLOSSES = [
  'determined: resolute, committed to acting or persisting through difficulty',
  'worried: concerned, anxious that something may be wrong',
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
  return corePolicySync<any>('conversation-policy.classificationPrompt',[mood]);
}
