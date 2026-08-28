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
