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
  const said = (text ?? '').trim();
  const m = said.match(WAKE_PATTERN);
  return m ? { woke: true, rest: (m[1] ?? '').trim() } : { woke: false, rest: said };
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
  return WAKE_ACKS[Math.min(WAKE_ACKS.length - 1, Math.floor(random() * WAKE_ACKS.length))];
}

/** Read just before their message when they spoke over her: she was cut off, and knows it. */
export const INTERRUPTED_ASIDE = 'They cut you off: you were still speaking when they said this, and you did not get to finish. React to that as you would, then deal with what they said.';
