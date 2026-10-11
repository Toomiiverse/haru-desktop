import {corePolicySync} from './core-policy-sync';
// Her name, said to get her attention — and what she says back.
//
// The phone's ears are Whisper on this machine, so the wake phrase is checked
// on a transcript, not on a waveform: "Hey Haru", "Haru," or, as Whisper
// tends to hear it, "Hey Harry". Whatever follows the name in the same breath
// is the message; the name alone earns a word from her and an open ear.

import type { EmotionName } from './emotion';

/** Group 1 is what came after the name, if anything. */
export const WAKE_PATTERN = /^[\s"'“”.,!?-]*(?:(?:hey|hi|hay|ok|okay|yo|oi|hello|hiya)[,\s]+)?(?:haru|haroo|harew|harue|halu|hallu|hulu|harry|hara)\b[\s,.!?:;"'“”-]*([\s\S]*)$/i;

export function wakePhraseIn(text: string): { woke: boolean; rest: string } {
  return corePolicySync('wake.wakePhraseIn',[text]);
}

/**
 * Her word when it was only her name. A pool rather than a model call because
 * a wake word answered two seconds later is a wake word that did not work; in
 * character because she would not say "how can I help".
 */
export const WAKE_ACKS: { line: string; emotion: EmotionName }[] = [
  { line: 'What.', emotion: 'annoyed' },
  { line: 'Yes?', emotion: 'neutral' },
  { line: 'I heard you. Go on.', emotion: 'neutral' },
  { line: 'This had better be good.', emotion: 'bored' },
  { line: 'Speak.', emotion: 'smug' },
  { line: 'Mm?', emotion: 'curious' },
  { line: 'You have my attention. Briefly.', emotion: 'smug' },
  { line: 'I’m here. Obviously.', emotion: 'annoyed' },
  { line: 'Well?', emotion: 'curious' },
];

export function wakeAck(random: () => number = Math.random): { line: string; emotion: EmotionName } {
  return corePolicySync('wake.wakeAck',[random()]);
}

/** An audio interruption is a turn boundary, not evidence of disrespect. */
export const INTERRUPTED_ASIDE = 'They started speaking during your reply. Treat this as ordinary conversational turn-taking. Keep the same warmth, mood and speaking style unless their actual words call for a change. Requests to wait or finish speaking, clarifications and corrections are normal; acknowledge them plainly without a defensive preface or a new irritated delivery. Answer what they just said directly, continuing the topic when appropriate. Do not scold, guilt them, become curt, or comment on being interrupted. A report that you sounded annoyed is feedback on delivery, not a claim about your feelings. Acknowledge how it sounded to them; never deny annoyance or dismiss it as your normal voice. Do not assume they heard the unfinished part of your reply.';
