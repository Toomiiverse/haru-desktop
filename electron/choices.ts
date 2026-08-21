// When she puts words in your mouth.
//
// A dialogue box with numbered replies is the oldest trick in the genre, and it
// works for the same reason it always did: it is faster than typing, and it
// tells you what kind of conversation you are in. Haru offering "[1] Fine, I'll
// do it now" and "[2] Get off my back" is her framing the exchange, which is
// more in character than a blank field ever is.
//
// Offered through a tool rather than parsed out of her reply. She could be asked
// to write "1." and "2." and usually would, and then one day she would write "-"
// or "Option A" or fold them into a sentence, and the parser would go quiet
// without anyone noticing. A tool call either happened or it did not.

import type { ChatTool } from './provider';

/** Four is the ceiling. Her box is narrow and a wall of options is a menu. */
export const MOST_CHOICES = 4;
/** Long enough for a real sentence, short enough to fit one line in her box. */
export const LONGEST_CHOICE = 64;

export const CHOICES_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'offer_choices',
    // Measured, and rewritten once. The first version led with when NOT to use
    // it and she barely used it at all: asked "should I do it now or tomorrow",
    // a question with its two options in the sentence, she offered choices in
    // none of three runs. She was already being told to be brief, and the
    // prohibitions on top of that read as "when in doubt, don't". Now the
    // invitation comes first and the warning is one clause at the end.
    description:
      "Offer the user two to four things they could say back, as buttons, so they can answer with a click. "
      + "Use it whenever their message has branches in it — a choice between two things, a decision they are putting off, "
      + "a question you just asked them, or any point where you can see the few ways this could go. "
      + "If you find yourself asking them something, offer the answers. "
      + "Write each one in THEIR voice, as the reply they would send you — \"Fine, I'll do it now\", not \"Agree to do it\" — "
      + "and keep each under a dozen words. Say your reply as normal as well; these sit underneath it. "
      + "Skip it only when the question is genuinely open and any answer at all would do.",
    parameters: {
      type: 'object',
      properties: {
        choices: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two to four short replies, written as the user would say them.',
        },
      },
      required: ['choices'],
    },
  },
};

/**
 * What she offered, made safe to render.
 *
 * She is a 14B model at the end of a tool call, so this cannot assume much: the
 * array might hold numbers, empty strings, duplicates, one item, or nine. The
 * box has room for four short lines and nothing else, and a choice that does not
 * fit is worse than no choice at all — it looks like the UI is broken rather
 * than like she said too much.
 */
export function readChoices(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    // Numbering she added herself: she is told these are buttons, but "1. Fine"
    // still turns up, and rendering it inside a numbered list gives "1. 1. Fine".
    const text = entry.trim().replace(/^\s*(?:\[\d+\]|\(?\d+[.)])\s*/, '').trim();
    if (!text) continue;
    if (text.length > LONGEST_CHOICE) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
    if (kept.length === MOST_CHOICES) break;
  }
  // One button is not a choice, it is a prompt with extra steps. Below two,
  // nothing is shown and the text box comes back.
  return kept.length >= 2 ? kept : [];
}
