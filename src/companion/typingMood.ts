// Her face while you are still typing. A cheap read of the draft, no model call,
// so it can run on every keystroke. Returns null when nothing in the draft
// carries a feeling, which leaves whatever she was already doing alone.
import type { Beat, EmotionName, FocusTarget, Intent } from '../types';

// First match wins, so the more specific feelings sit above the broad ones:
// a compliment aimed at her is embarrassing before it is affectionate, and
// "ugh!!" is annoyed before it is surprised.
const RULES: [EmotionName, RegExp][] = [
  ['embarrassed', /\b(you'?re|ur|you are) (so |really |very )?(pretty|cute|beautiful|adorable|smart|amazing)\b/i],
  ['affectionate', /\b(love|adore|miss you|hugs?|kiss(es)?|cuddle)\b|<3|❤|🥰|😍/i],
  ['annoyed', /\b(ugh+|hate|stupid|annoying|wtf|damn|shut up|angry|mad|pissed)\b|😠|😡|🙄/i],
  ['worried', /\b(sad|sorry|scared|worried|anxious|hurts?|cry(ing)?|lonely|depressed)\b|:\(|😢|😭/i],
  ['sleepy', /\b(tired|sleepy|sleep|exhausted|good ?night|bed ?time)\b|😴|🥱/i],
  ['bored', /\b(bored|boring|meh)\b/i],
  ['smug', /\b(hehe+|heh|told you|obviously)\b|;\)|😏/i],
  ['happy', /\b(lol|lmao|ha(ha)+|yay|thanks?|thank you|great|awesome|nice|cool)\b|:\)|:D|😂|😊|😄/i],
  ['surprised', /!{2,}|\b(omg|wow|whoa|no way)\b|😮|😱/i],
  ['determined', /\b(let'?s go|let'?s do|we can|i will|i'?m gonna|come on)\b|💪/i],
  ['curious', /\?\s*$|^(who|what|why|how|when|where|which|do|does|did|can|could|is|are|will|would)\b/i],
];

const FOCUS: Partial<Record<EmotionName, FocusTarget>> = { embarrassed: 'away', sleepy: 'self', bored: 'away' };
const INTENT: Partial<Record<EmotionName, Intent>> = { smug: 'tease', worried: 'soothe', happy: 'celebrate' };

export function typingMood(draft: string): Beat | null {
  // Only the sentence being written counts, so "I'm sad. but I love you"
  // turns her around on the second half instead of sitting on the first.
  const tail = draft.trim().split(/(?<=[.!?…])\s+/).pop() ?? '';
  if (tail.length < 2) return null;
  const shouting = /[A-Z]{4,}/.test(tail) && tail === tail.toUpperCase();
  const match = RULES.find(([, pattern]) => pattern.test(tail));
  // Shouting outranks a mere question: "WHAT IS THIS" is not curiosity.
  const emotion: EmotionName | undefined = shouting && (!match || match[0] === 'curious') ? 'surprised' : match?.[0];
  if (!emotion) return null;
  const bangs = (tail.match(/!/g) ?? []).length;
  return {
    emotion: {
      emotion,
      // Softer than a reading of a finished reply: she is guessing at half a sentence.
      confidence: 0.6,
      energy: Math.min(1, 0.4 + bangs * 0.15 + (shouting ? 0.3 : 0)),
      intent: INTENT[emotion] ?? 'listen',
      focus: FOCUS[emotion] ?? 'user',
    },
  };
}
