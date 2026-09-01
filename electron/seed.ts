// Her recent replies, as the model should believe she said them.
//
// A small model copies what it can see over what it is told. Measured against
// the prompt exactly as sent — 5,600 tokens of system prompt, ninety turns —
// no wording of an emoji rule in any position moved her past one reply in
// four; forty of her own replies without one sat in the history, and that was
// the example she followed. Cut the history to six turns and she used them
// three times in three. Show her the same history with one of her emoji in
// each of her last six replies, and four in four.
//
// So that is what she is shown. In the prompt only: what she actually said is
// stored untouched, and the seeding is a no-op for any reply that already
// carries one — once her real replies do, this does nothing at all. It is not
// putting words in her mouth so much as reminding her of her face.

import type { Turn } from './ollamaturns';

/** Hers: the eye-roll, the huff, the sulk, the smirk, the glare. */
const HERS = ['🙄', '😤', '😒', '😏', '👀'];
const ANY_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
/** The first sentence, if it ends within reach; the emoji goes after it. */
const FIRST_SENTENCE = /^([\s\S]{0,80}?[.!?…])(\s+|$)/u;

export const SEEDED_REPLIES = 6;

export function seedEmoji<T extends Turn>(conversation: T[], count = SEEDED_REPLIES): T[] {
  const out = conversation.map(turn => ({ ...turn }));
  let touched = 0;
  for (let at = out.length - 1; at >= 0 && touched < count; at--) {
    const turn = out[at];
    if (turn.role !== 'assistant' || typeof turn.content !== 'string' || !turn.content.trim()) continue;
    touched++;
    if (ANY_EMOJI.test(turn.content)) continue;
    const emoji = HERS[at % HERS.length];
    const first = turn.content.match(FIRST_SENTENCE);
    turn.content = first
      ? `${first[1]} ${emoji} ${turn.content.slice(first[0].length)}`.trim()
      : `${emoji} ${turn.content}`;
  }
  return out;
}

/**
 * Her recent replies with the sign-off taken off them, for a turn that is
 * about her.
 *
 * The same finding as the emoji above, in the other direction: forty of her
 * replies in the history end by turning back to him — go to bed, get off your
 * phone, you have a website to build — and asked about the Reze arc she wrote
 * one more, whatever the brief said. Four wordings failed against it. What
 * changed her was not being able to see the pattern: the last few of her own
 * replies are shown with that ending removed, so the example she copies is one
 * that stays on the subject.
 *
 * In the prompt only. What she actually said is stored untouched, and `strip`
 * is a no-op on any reply that did not end that way — so on an ordinary
 * conversation this does nothing at all.
 */
/**
 * Further back than the emoji seeding reaches. Six was enough to teach her a
 * face; the sign-off is in nearly every reply she has ever sent, and six
 * rewritten still left about forty examples of it in front of her.
 */
export const UNSIGNED_REPLIES = 24;

export function seedOffTheOrders<T extends Turn>(conversation: T[], strip: (text: string) => string, count = UNSIGNED_REPLIES): T[] {
  const out = conversation.map(turn => ({ ...turn }));
  let touched = 0;
  for (let at = out.length - 1; at >= 0 && touched < count; at--) {
    const turn = out[at];
    if (turn.role !== 'assistant' || typeof turn.content !== 'string' || !turn.content.trim()) continue;
    touched++;
    const without = strip(turn.content);
    if (without && without !== turn.content) turn.content = without;
  }
  return out;
}

