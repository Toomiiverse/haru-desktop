// Her face on the phone: the supplied Haru artwork, one SVG per emotion.
//
// The mood engine (emotion.ts) speaks in its own twelve words; the artwork
// has additional authored faces. This is the seam between them — the union the avatar
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
  'unimpressed', 'skeptical', 'determined', 'wink', 'concerned',
  'attentive', 'shy', 'content', 'playful', 'startled', 'disappointed', 'relieved', 'drowsy',
  'pain', 'scared', 'serious', 'silly', 'flirty', 'nervous', 'disbelief', 'rage', 'disgusted', 'confident', 'drunk', 'pouty', 'sick', 'laughing', 'snooty', 'cold', 'crying', 'devious', 'pensive', 'triumph',
] as const;

export type HaruEmotion = typeof HARU_EMOTIONS[number];

/** How a face arrives. Only a fade exists today; the engine reads it, so a new kind is an entry here and a branch there. */
export type EmotionTransition = 'fade' | 'cut';

/**
 * How she moves while wearing a face: a slow float (bob, in px at the default
 * size), a sway (degrees), a breath (scale), on a period. Excited is quick and
 * bouncy, sleepy slow and droopy, sad barely moves. Read by the engine's
 * idle(t) and by the page's CSS alike, so what a test samples is what shows.
 */
export type IdleMotion = { periodMs: number; bobPx: number; swayDeg: number; breath: number };

/**
 * How far her eyes may travel, as a share of the full range: sleepy eyes are
 * closed and should barely move; surprised has no separable eyes at all and
 * gets nothing whatever this says. Zero switches it off for a face.
 */
export type GazeRange = number;

export type EmotionEntry = {
  /** The file under the emotions folder, served as-is. */
  file: string;
  /** What a screen reader says the avatar is. */
  label: string;
  transition: EmotionTransition;
  idle: IdleMotion;
  gaze: GazeRange;
  /** Whether her eyes blink wearing this face: not with no eyes to close, not with them already closed, not with hearts for eyes. */
  blink: boolean;
  /**
   * How she holds herself: the most she cocks her head (degrees), how far she
   * roams from home (a fraction of her own size), and a lean she carries all
   * the while — sleepy and sad droop, the rest sit straight.
   */
  pose: { tiltDeg: number; roam: number; leanDeg: number };
};

export const emotionConfig: Record<HaruEmotion, EmotionEntry> = {
  neutral:     { file: 'neutral.svg',     label: 'Haru feeling neutral', transition: 'fade', idle: { periodMs: 4000, bobPx: 4, swayDeg: 1.2, breath: 0.015 }, gaze: 1, blink: true, pose: { tiltDeg: 7, roam: 0.06, leanDeg: 0 } },
  happy:       { file: 'happy.svg',       label: 'Haru feeling happy', transition: 'fade', idle: { periodMs: 3000, bobPx: 5, swayDeg: 1.6, breath: 0.02 }, gaze: 0.8, blink: true, pose: { tiltDeg: 8, roam: 0.08, leanDeg: 0 } },
  excited:     { file: 'excited.svg',     label: 'Haru feeling excited', transition: 'fade', idle: { periodMs: 2200, bobPx: 6, swayDeg: 2.2, breath: 0.03 }, gaze: 1, blink: true, pose: { tiltDeg: 10, roam: 0.12, leanDeg: 0 } },
  sad:         { file: 'sad.svg',         label: 'Haru feeling sad', transition: 'fade', idle: { periodMs: 5500, bobPx: 2, swayDeg: 0.6, breath: 0.01 }, gaze: 0.5, blink: true, pose: { tiltDeg: 4, roam: 0.03, leanDeg: 3 } },
  angry:       { file: 'angry.svg',       label: 'Haru feeling angry', transition: 'fade', idle: { periodMs: 2600, bobPx: 2, swayDeg: 1.8, breath: 0.02 }, gaze: 0.7, blink: true, pose: { tiltDeg: 6, roam: 0.05, leanDeg: -1 } },
  annoyed:     { file: 'annoyed.svg',     label: 'Haru feeling annoyed', transition: 'fade', idle: { periodMs: 3400, bobPx: 2, swayDeg: 0.9, breath: 0.012 }, gaze: 0.9, blink: true, pose: { tiltDeg: 6, roam: 0.04, leanDeg: 0 } },
  surprised:   { file: 'surprised.svg',   label: 'Haru feeling surprised', transition: 'fade', idle: { periodMs: 2400, bobPx: 5, swayDeg: 1.2, breath: 0.025 }, gaze: 0, blink: false, pose: { tiltDeg: 5, roam: 0.05, leanDeg: 0 } },
  confused:    { file: 'confused.svg',    label: 'Haru feeling confused', transition: 'fade', idle: { periodMs: 3600, bobPx: 3, swayDeg: 2.6, breath: 0.015 }, gaze: 1, blink: true, pose: { tiltDeg: 12, roam: 0.06, leanDeg: 0 } },
  curious:     { file: 'curious.svg',     label: 'Haru feeling curious', transition: 'fade', idle: { periodMs: 3200, bobPx: 4, swayDeg: 2.4, breath: 0.018 }, gaze: 1, blink: true, pose: { tiltDeg: 12, roam: 0.08, leanDeg: 0 } },
  embarrassed: { file: 'embarrassed.svg', label: 'Haru feeling embarrassed', transition: 'fade', idle: { periodMs: 3800, bobPx: 3, swayDeg: 1.0, breath: 0.014 }, gaze: 0.6, blink: true, pose: { tiltDeg: 6, roam: 0.05, leanDeg: 2 } },
  sleepy:      { file: 'sleepy.svg',      label: 'Haru feeling sleepy', transition: 'fade', idle: { periodMs: 6500, bobPx: 5, swayDeg: 1.0, breath: 0.02 }, gaze: 0.15, blink: false, pose: { tiltDeg: 5, roam: 0.03, leanDeg: 5 } },
  // Thinking is still: a faint float, no sway to speak of, no roaming, a slight
  // held tilt — absorbed, not bobbing about. Her gaze is up and away meanwhile.
  thinking:    { file: 'thinking.svg',    label: 'Haru thinking', transition: 'fade', idle: { periodMs: 5200, bobPx: 1.5, swayDeg: 0.4, breath: 0.01 }, gaze: 1, blink: true, pose: { tiltDeg: 4, roam: 0, leanDeg: 0 } },
  smug:        { file: 'smug.svg',        label: 'Haru feeling smug', transition: 'fade', idle: { periodMs: 3800, bobPx: 3, swayDeg: 1.5, breath: 0.015 }, gaze: 0.8, blink: true, pose: { tiltDeg: 7, roam: 0.06, leanDeg: -2 } },
  love:        { file: 'love.svg',        label: 'Haru feeling loved up', transition: 'fade', idle: { periodMs: 3400, bobPx: 5, swayDeg: 1.6, breath: 0.022 }, gaze: 0.6, blink: false, pose: { tiltDeg: 8, roam: 0.07, leanDeg: 1 } },
  unimpressed: { file: 'unimpressed.svg', label: 'Haru feeling unimpressed', transition: 'fade', idle: { periodMs: 4800, bobPx: 2, swayDeg: 0.5, breath: 0.01 }, gaze: 0.4, blink: true, pose: { tiltDeg: 3, roam: 0.02, leanDeg: 0 } },
  skeptical:   { file: 'skeptical.svg', label: 'Haru feeling skeptical', transition: 'fade', idle: { periodMs: 4200, bobPx: 2, swayDeg: 0.8, breath: 0.012 }, gaze: 0.6, blink: true, pose: { tiltDeg: 5, roam: 0.02, leanDeg: -3 } },
  determined:  { file: 'determined.svg', label: 'Haru feeling determined', transition: 'fade', idle: { periodMs: 3200, bobPx: 2, swayDeg: 0.6, breath: 0.018 }, gaze: 0.5, blink: true, pose: { tiltDeg: 3, roam: 0.02, leanDeg: -1 } },
  wink:        { file: 'wink.svg', label: 'Haru winking', transition: 'fade', idle: { periodMs: 3200, bobPx: 4, swayDeg: 1.2, breath: 0.018 }, gaze: 0.5, blink: true, pose: { tiltDeg: 5, roam: 0.03, leanDeg: 2 } },
  concerned:   { file: 'concerned.svg', label: 'Haru showing soft concern', transition: 'fade', idle: { periodMs: 5200, bobPx: 1.5, swayDeg: 0.5, breath: 0.01 }, gaze: 0.5, blink: true, pose: { tiltDeg: 4, roam: 0.01, leanDeg: 2 } },
  attentive:   { file: 'attentive.svg', label: 'Haru listening attentively', transition: 'fade', idle: { periodMs: 4300, bobPx: 1.5, swayDeg: .4, breath: .012 }, gaze: .7, blink: true, pose: { tiltDeg: 3, roam: .015, leanDeg: 0 } },
  shy:         { file: 'shy.svg', label: 'Haru feeling shy', transition: 'fade', idle: { periodMs: 4800, bobPx: 2, swayDeg: .6, breath: .012 }, gaze: .45, blink: true, pose: { tiltDeg: 4, roam: .015, leanDeg: 2 } },
  content:     { file: 'content.svg', label: 'Haru feeling content', transition: 'fade', idle: { periodMs: 5400, bobPx: 1.5, swayDeg: .5, breath: .016 }, gaze: .35, blink: true, pose: { tiltDeg: 3, roam: .01, leanDeg: 0 } },
  playful:     { file: 'playful.svg', label: 'Haru feeling playful', transition: 'fade', idle: { periodMs: 3200, bobPx: 3, swayDeg: 1.2, breath: .018 }, gaze: .8, blink: true, pose: { tiltDeg: 7, roam: .035, leanDeg: -2 } },
  startled:    { file: 'startled.svg', label: 'Haru feeling startled', transition: 'fade', idle: { periodMs: 2700, bobPx: 1.5, swayDeg: .3, breath: .02 }, gaze: .2, blink: true, pose: { tiltDeg: 2, roam: .01, leanDeg: 0 } },
  disappointed:{ file: 'disappointed.svg', label: 'Haru feeling disappointed', transition: 'fade', idle: { periodMs: 5800, bobPx: 1, swayDeg: .3, breath: .01 }, gaze: .3, blink: true, pose: { tiltDeg: 3, roam: .01, leanDeg: 3 } },
  relieved:    { file: 'relieved.svg', label: 'Haru feeling relieved', transition: 'fade', idle: { periodMs: 5500, bobPx: 1.5, swayDeg: .4, breath: .018 }, gaze: .2, blink: false, pose: { tiltDeg: 3, roam: .01, leanDeg: 1 } },
  drowsy:      { file: 'drowsy.svg', label: 'Haru feeling drowsy', transition: 'fade', idle: { periodMs: 7000, bobPx: 1, swayDeg: .4, breath: .014 }, gaze: .15, blink: true, pose: { tiltDeg: 3, roam: .008, leanDeg: 4 } },
  pain:   { file: 'pain.svg', label: 'Haru feeling pain', transition: 'fade', idle: { periodMs: 5200, bobPx: 1.5, swayDeg: 0.5, breath: 0.01 }, gaze: 0.5, blink: true, pose: { tiltDeg: 4, roam: 0.01, leanDeg: 2 } },
  scared:    { file: 'scared.svg', label: 'Haru feeling scared', transition: 'fade', idle: { periodMs: 2700, bobPx: 1.5, swayDeg: .3, breath: .02 }, gaze: .2, blink: true, pose: { tiltDeg: 2, roam: .01, leanDeg: 0 } },
  serious:  { file: 'serious.svg', label: 'Haru feeling serious', transition: 'fade', idle: { periodMs: 3200, bobPx: 2, swayDeg: 0.6, breath: 0.018 }, gaze: 0.5, blink: true, pose: { tiltDeg: 3, roam: 0.02, leanDeg: -1 } },
  silly:     { file: 'silly.svg', label: 'Haru feeling silly', transition: 'fade', idle: { periodMs: 3200, bobPx: 3, swayDeg: 1.2, breath: .018 }, gaze: .8, blink: true, pose: { tiltDeg: 7, roam: .035, leanDeg: -2 } },
  flirty:     { file: 'flirty.svg', label: 'Haru feeling flirty', transition: 'fade', idle: { periodMs: 3200, bobPx: 3, swayDeg: 1.2, breath: .018 }, gaze: .8, blink: true, pose: { tiltDeg: 7, roam: .035, leanDeg: -2 } },
  nervous:   { file: 'nervous.svg', label: 'Haru feeling nervous', transition: 'fade', idle: { periodMs: 5200, bobPx: 1.5, swayDeg: 0.5, breath: 0.01 }, gaze: 0.5, blink: true, pose: { tiltDeg: 4, roam: 0.01, leanDeg: 2 } },
  disbelief:    { file: 'disbelief.svg', label: 'Haru feeling disbelief', transition: 'fade', idle: { periodMs: 2700, bobPx: 1.5, swayDeg: .3, breath: .02 }, gaze: .2, blink: true, pose: { tiltDeg: 2, roam: .01, leanDeg: 0 } },
  rage:       { file: 'rage.svg',       label: 'Haru feeling rage', transition: 'fade', idle: { periodMs: 2600, bobPx: 2, swayDeg: 1.8, breath: 0.02 }, gaze: 0.7, blink: true, pose: { tiltDeg: 6, roam: 0.05, leanDeg: -1 } },
  disgusted:   { file: 'disgusted.svg', label: 'Haru feeling disgusted', transition: 'fade', idle: { periodMs: 4200, bobPx: 2, swayDeg: 0.8, breath: 0.012 }, gaze: 0.6, blink: true, pose: { tiltDeg: 5, roam: 0.02, leanDeg: -3 } },
  confident:        { file: 'confident.svg',        label: 'Haru feeling confident', transition: 'fade', idle: { periodMs: 3800, bobPx: 3, swayDeg: 1.5, breath: 0.015 }, gaze: 0.8, blink: false, pose: { tiltDeg: 7, roam: 0.06, leanDeg: -2 } },
  drunk:      { file: 'drunk.svg', label: 'Haru feeling drunk', transition: 'fade', idle: { periodMs: 7000, bobPx: 1, swayDeg: .4, breath: .014 }, gaze: .15, blink: false, pose: { tiltDeg: 3, roam: .008, leanDeg: 4 } },
  pouty:{ file: 'pouty.svg', label: 'Haru feeling pouty', transition: 'fade', idle: { periodMs: 5800, bobPx: 1, swayDeg: .3, breath: .01 }, gaze: .3, blink: true, pose: { tiltDeg: 3, roam: .01, leanDeg: 3 } },
  sick:      { file: 'sick.svg', label: 'Haru feeling sick', transition: 'fade', idle: { periodMs: 7000, bobPx: 1, swayDeg: .4, breath: .014 }, gaze: .15, blink: true, pose: { tiltDeg: 3, roam: .008, leanDeg: 4 } },
  laughing:       { file: 'laughing.svg',       label: 'Haru feeling laughing', transition: 'fade', idle: { periodMs: 3000, bobPx: 5, swayDeg: 1.6, breath: 0.02 }, gaze: 0.8, blink: false, pose: { tiltDeg: 8, roam: 0.08, leanDeg: 0 } },
  snooty:        { file: 'snooty.svg',        label: 'Haru feeling snooty', transition: 'fade', idle: { periodMs: 3800, bobPx: 3, swayDeg: 1.5, breath: 0.015 }, gaze: 0.8, blink: true, pose: { tiltDeg: 7, roam: 0.06, leanDeg: -2 } },
  cold:   { file: 'cold.svg', label: 'Haru feeling cold', transition: 'fade', idle: { periodMs: 5200, bobPx: 1.5, swayDeg: 0.5, breath: 0.01 }, gaze: 0.5, blink: true, pose: { tiltDeg: 4, roam: 0.01, leanDeg: 2 } },
  crying:         { file: 'crying.svg',         label: 'Haru feeling crying', transition: 'fade', idle: { periodMs: 5500, bobPx: 2, swayDeg: 0.6, breath: 0.01 }, gaze: 0.5, blink: true, pose: { tiltDeg: 4, roam: 0.03, leanDeg: 3 } },
  devious:        { file: 'devious.svg',        label: 'Haru feeling devious', transition: 'fade', idle: { periodMs: 3800, bobPx: 3, swayDeg: 1.5, breath: 0.015 }, gaze: 0.8, blink: true, pose: { tiltDeg: 7, roam: 0.06, leanDeg: -2 } },
  pensive:    { file: 'pensive.svg',    label: 'Haru feeling pensive', transition: 'fade', idle: { periodMs: 5200, bobPx: 1.5, swayDeg: 0.4, breath: 0.01 }, gaze: 1, blink: true, pose: { tiltDeg: 4, roam: 0, leanDeg: 0 } },
  triumph:     { file: 'triumph.svg',     label: 'Haru feeling triumph', transition: 'fade', idle: { periodMs: 2200, bobPx: 6, swayDeg: 2.2, breath: 0.03 }, gaze: 1, blink: false, pose: { tiltDeg: 10, roam: 0.12, leanDeg: 0 } },
};

/**
 * The mood engine's word for it, and the face for that.
 *
 * Bored, determined and worried now have dedicated artwork.
 */
export const MOOD_TO_EMOTION: Record<EmotionName, HaruEmotion> = {
  neutral: 'neutral',
  happy: 'happy',
  curious: 'curious',
  smug: 'smug',
  annoyed: 'annoyed',
  bored: 'unimpressed',
  sleepy: 'sleepy',
  surprised: 'surprised',
  affectionate: 'love',
  embarrassed: 'embarrassed',
  determined: 'determined',
  worried: 'concerned',
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
