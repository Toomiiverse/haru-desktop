// The thing she says a minute later.
//
// A person who has just said something they meant does not always stop there:
// a beat later comes the bit they left out, or the question they actually
// wanted to ask, or a change of subject to something of their own. She could
// not do that — one message in, one message out — so a rant was a wall and a
// conversation was only ever his to start. After a reply that was about her,
// or one where she was given the room to rant, she may follow up on her own a
// minute or two later, once, if he has not answered in between: a new message
// of hers into the conversation, through the same channel as everything else
// she says unprompted. Nothing forces it; she is asked, and "nothing" is an
// answer she gives with a dash.

export const SECOND_THOUGHT_MIN_MS = 45_000;
export const SECOND_THOUGHT_MAX_MS = 110_000;
/** Not twice in a row: a follow-up to a follow-up is her talking to herself. */
export const SECOND_THOUGHT_GAP_MS = 4 * 60_000;
/** On an ordinary turn she follows up rarely; on one about her, always considered. */
export const SECOND_THOUGHT_ODDS = 1 / 6;

export function secondThoughtDelay(random: () => number = Math.random): number {
  return Math.round(SECOND_THOUGHT_MIN_MS + random() * (SECOND_THOUGHT_MAX_MS - SECOND_THOUGHT_MIN_MS));
}

export function wantsSecondThought(input: { hers: boolean; ranting: boolean; replyLength: number }, random: () => number = Math.random): boolean {
  if (input.replyLength < 40) return false;
  if (input.hers || input.ranting) return true;
  return random() < SECOND_THOUGHT_ODDS;
}

export function secondThoughtNote(secondsAgo: number): string {
  const ago = secondsAgo < 75 ? 'about a minute' : `about ${Math.round(secondsAgo / 60)} minutes`;
  return `You said the last thing above ${ago} ago and they have not answered. This is not a reply to anything — it is you, a beat later, adding to what you said if there is something worth adding: the point you left out, the thing you actually want to ask them about it, or something of your own you want to bring up. One to three lines, as a new message, no greeting and no recap of what you already said. Never repeat what they said or what you said — a line that is already in the conversation is not a new message. If there is nothing worth adding, answer with a single dash and nothing else.`;
}

/** What she said, or null when she chose not to. */
export function parseSecondThought(text: string): string | null {
  let line = (text ?? '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!line || /^[-–—.…]+$/.test(line) || /^\(?(?:nothing|no|nope|none|nothing to add)\)?[.!]?$/i.test(line)) return null;
  // The first few lines are the message; anything past them is a second reply.
  line = line.split(/\n{2,}/)[0].trim();
  if (line.length < 8 || line.length > 600) return null;
  return line;
}

/**
 * Not an echo.
 *
 * Asked for the thing she left out, the model has twice handed back a line
 * already in the conversation: once his last message word for word ("That's
 * fair enough - sounds like you're really enjoying chainsaw man…" went out
 * as hers and he answered "I'm not reading it - you are", 2026-09-06), once a
 * paragraph of her own reply with an asterisk in front. Either reads as her
 * repeating what was just said. Compared loosely — case, punctuation and
 * markup do not count — and a line whose words are mostly in a recent one is
 * that line.
 */
export function looksLikeAnEcho(line: string, recent: string[]): boolean {
  const flat = flatten(line);
  if (!flat) return true;
  const contains = (whole: string, part: string) => part.split(' ').length >= 4 && whole.includes(part);
  return recent.some(text => {
    const other = flatten(text);
    if (!other) return false;
    if (flat === other || contains(other, flat) || contains(flat, other)) return true;
    return sharedWords(flat, other) >= 0.8;
  });
}

function flatten(text: string): string {
  return (text ?? '').toLowerCase().replace(/[*_`~>#"'“”‘’]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** The share of the line's words the other text also has; short lines only count when identical. */
function sharedWords(line: string, other: string): number {
  const words = line.split(' ').filter(Boolean);
  if (words.length < 4) return line === other ? 1 : 0;
  const theirs = new Set(other.split(' '));
  return words.filter(word => theirs.has(word)).length / words.length;
}
