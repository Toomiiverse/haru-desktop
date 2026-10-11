import {corePolicySync} from './core-policy-sync';
// How hot a line is, read from the line itself.
//
// The emotion classifier answers "what did she mean by this", which is a
// different question from "how hard did she say it". Asked to label a sentence
// with a swear word in it, a model will happily come back with neutral and a
// confidence of 0.9 — the intent really was neutral, the delivery was not. Her
// face should follow the delivery.
//
// Done in code rather than with a second model call because it has to be
// instant: the beat needs to land as she starts speaking, not a round trip later.

import type { Emotion } from './emotion';

export type Tone = { heat: number };

// Deliberately a small list of what she actually reaches for. This is not a
// filter and nothing is blocked or replaced — it only decides how hard her face
// works while she says it.
const PROFANITY = /\b(fuck\w*|shit\w*|bastard|bitch\w*|piss\w*|arse\w*|ass(hole)?|damn|dick\w*|prick|crap|bloody|bollocks|wank\w*|twat|hell)\b/gi;

// Turns of phrase that are aggressive without containing a swear word at all.
const HOSTILE = /\b(shut up|get lost|go away|leave me alone|drop dead|are you (serious|kidding|deaf)|what the|how many times|for once|i said|do it now|move it)\b/gi;

// Three or more capitals in a row, which is her shouting rather than an acronym
// at the length that matters.
const SHOUTED = /\b[A-Z]{3,}\b/g;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

export function readTone(line: string): Tone {
  return corePolicySync<any>('conversation-policy.readTone',[line]);
}

/** Below this a line is just talking, and her face should be left alone. */
export const HEAT_FLOOR = 0.18;

export function isHeated(tone: Tone): boolean {
  return corePolicySync<any>('conversation-policy.isHeated',[tone]);
}

/**
 * How narrowed and set her face should be. Scales with heat rather than being a
 * switch, so a muttered "bloody hell" is not the same face as being shouted at.
 */
export function tonePose(tone: Tone): 'seething' | 'narrow' | null {
  return corePolicySync<any>('conversation-policy.tonePose',[tone]);
}

/**
 * Whether she shakes her head on this one. Deliberately occasional: a head shake
 * on every sharp line stops reading as exasperation and starts reading as a tic,
 * so the odds rise with heat but never reach certainty.
 */
export function toneGesture(tone: Tone, random: () => number = Math.random): 'shake' | undefined {
  {const draw=corePolicySync<boolean>('conversation-policy.isHeated',[tone]);return corePolicySync<any>('conversation-policy.toneGesture',[tone,draw?random():null])??undefined;}
}

/**
 * Pulls a reading toward annoyance in proportion to how hard the line was said.
 * The classifier's label is kept when it already agrees; this only overrides the
 * placid readings that a swearing line should never have got.
 */
export function sharpen(reading: Emotion, tone: Tone): Emotion {
  return corePolicySync<any>('conversation-policy.sharpen',[reading,tone]);
}
