// Her face on the phone: the supplied Haru artwork, one SVG per emotion.
//
// The mood engine (emotion.ts) speaks in its own twelve words; the artwork
// ships fourteen faces. This is the seam between them — the union the avatar
// understands, where each face lives, what it is called out loud, and how a
// mood-engine emotion becomes a face. The artwork itself is never touched:
// the files in build/emotions/ are served as they are, and nothing here
// draws, recolours or falls back to anything else.
//
// Extensible on purpose: a new face is one entry in emotionConfig and one file
// beside the others. The adapter only needs a line when the mood engine gains
// a word.

import type { EmotionName } from './emotion';

export const HARU_EMOTIONS = [
  'neutral', 'happy', 'excited', 'sad', 'angry', 'annoyed', 'surprised',
  'confused', 'curious', 'embarrassed', 'sleepy', 'thinking', 'smug', 'love',
] as const;

export type HaruEmotion = typeof HARU_EMOTIONS[number];

/** How a face arrives. Only a fade exists today; the engine reads it, so a new kind is an entry here and a branch there. */
export type EmotionTransition = 'fade' | 'cut';

export type EmotionEntry = {
  /** The file under the emotions folder, served as-is. */
  file: string;
  /** What a screen reader says the avatar is. */
  label: string;
  transition: EmotionTransition;
};

export const emotionConfig: Record<HaruEmotion, EmotionEntry> = {
  neutral:     { file: 'neutral.svg',     label: 'Haru feeling neutral', transition: 'fade' },
  happy:       { file: 'happy.svg',       label: 'Haru feeling happy', transition: 'fade' },
  excited:     { file: 'excited.svg',     label: 'Haru feeling excited', transition: 'fade' },
  sad:         { file: 'sad.svg',         label: 'Haru feeling sad', transition: 'fade' },
  angry:       { file: 'angry.svg',       label: 'Haru feeling angry', transition: 'fade' },
  annoyed:     { file: 'annoyed.svg',     label: 'Haru feeling annoyed', transition: 'fade' },
  surprised:   { file: 'surprised.svg',   label: 'Haru feeling surprised', transition: 'fade' },
  confused:    { file: 'confused.svg',    label: 'Haru feeling confused', transition: 'fade' },
  curious:     { file: 'curious.svg',     label: 'Haru feeling curious', transition: 'fade' },
  embarrassed: { file: 'embarrassed.svg', label: 'Haru feeling embarrassed', transition: 'fade' },
  sleepy:      { file: 'sleepy.svg',      label: 'Haru feeling sleepy', transition: 'fade' },
  thinking:    { file: 'thinking.svg',    label: 'Haru thinking', transition: 'fade' },
  smug:        { file: 'smug.svg',        label: 'Haru feeling smug', transition: 'fade' },
  love:        { file: 'love.svg',        label: 'Haru feeling loved up', transition: 'fade' },
};

/**
 * The mood engine's word for it, and the face for that.
 *
 * Most are the same word. The rest are judgement calls in her character: bored
 * is the eye-roll rather than the yawn, because being bored is something she
 * is annoyed about; determined is the excited face, the one with fire in it;
 * worried is sad, which is the nearest thing to it the artwork has.
 */
export const MOOD_TO_EMOTION: Record<EmotionName, HaruEmotion> = {
  neutral: 'neutral',
  happy: 'happy',
  curious: 'curious',
  smug: 'smug',
  annoyed: 'annoyed',
  bored: 'annoyed',
  sleepy: 'sleepy',
  surprised: 'surprised',
  affectionate: 'love',
  embarrassed: 'embarrassed',
  determined: 'excited',
  worried: 'sad',
};

export function isHaruEmotion(name: string): name is HaruEmotion {
  return (HARU_EMOTIONS as readonly string[]).includes(name);
}

/** A face for whatever the mood system says — its own words, a face's name, or nonsense. */
export function adaptEmotion(name: string | null | undefined): HaruEmotion {
  if (!name) return 'neutral';
  if (isHaruEmotion(name)) return name;
  return MOOD_TO_EMOTION[name as EmotionName] ?? 'neutral';
}

/** The file to serve for a name off the wire, or nothing — the allowlist the route stands on. */
export function emotionFile(name: string): string | null {
  return isHaruEmotion(name) ? emotionConfig[name].file : null;
}

/** How long a face takes to become the next one, unless the page says otherwise. 150–250ms reads as a change of face rather than a flicker or a dissolve. */
export const DEFAULT_TRANSITION_MS = 200;

/**
 * The engine's easing: cubic ease-out. Deterministic, no overshoot, and the
 * same curve the page hands CSS, so a frame the engine samples is the frame
 * the browser would have drawn.
 */
export const EASE_OUT_CSS = 'cubic-bezier(0.33, 1, 0.68, 1)';
