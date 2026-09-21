// Which line of hers a message of his is answering.
//
// A phone conversation is one long line, so everything he sends reads as a
// reply to her latest message. Answer something she said three messages back —
// "I wasn't stalling, I was checking on you" — and she reads it as a response to
// whatever she said last, and answers that instead. The phone now names the
// line it means; this is where the name is checked against what she actually
// said, and where the answer is put in front of her.
//
// Pure. The resolving happens where the message comes in (main.ts's sayStream),
// and the telling happens where the conversation goes to her brain (ollamaChat).

/** A line of the conversation, as the store and the day's asides both hold it. */
export type Line = { id?: string; role: string; content: string };

/**
 * A message of his that answers a particular line of hers. The desk's own shape
 * (src/types.ts Message.replyTo), which it has stored and drawn since before the
 * brain ever read it — so there is one reference, whichever body it came from.
 */
export type ReplyRef = { id: string; excerpt: string };

/** Long enough to identify the line, and no longer — the rule her thumb notes already follow. */
export const QUOTE_CHARS = 140;

/** The part of a line of hers worth quoting back: its first sentence, or a clean cut. */
export function quoteOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= QUOTE_CHARS) return flat;
  // A whole first sentence reads as her; half of one reads as a glitch.
  const end = flat.slice(0, QUOTE_CHARS).search(/[.!?…](?=\s|$)[^.!?…]*$/);
  if (end >= 40) return flat.slice(0, end + 1);
  const cut = flat.slice(0, QUOTE_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The line he named, resolved against hers — or nothing, and the message goes
 * as an ordinary one.
 *
 * An id the history handed out wins. The quoted text is only a fallback for a
 * reply of hers the phone has not been given an id for yet — one it has just
 * streamed — and even then it has to match one of her real lines: what gets
 * quoted to her is always the server's copy of the line, never the page's text.
 */
export function resolveReply(ask: { replyTo?: unknown; quoted?: unknown }, lines: Line[]): ReplyRef | null {
  const hers = lines.filter(line => line.role === 'assistant' && typeof line.content === 'string' && line.content.trim() && line.id);
  if (typeof ask.replyTo === 'string' && ask.replyTo) {
    const named = hers.find(line => line.id === ask.replyTo);
    if (named) return { id: named.id!, excerpt: quoteOf(named.content) };
  }
  if (typeof ask.quoted === 'string' && flat(ask.quoted).length >= 8) {
    // The phone quotes the start of the line; a start that long is not shared by
    // two of her lines by accident. Newest first, so a line she has said twice
    // resolves to the one he can actually see.
    const start = flat(ask.quoted).replace(/…$/, '').slice(0, 60);
    const matched = [...hers].reverse().find(line => flat(line.content).startsWith(start));
    if (matched) return { id: matched.id!, excerpt: quoteOf(matched.content) };
  }
  return null;
}

/**
 * What she reads: his words, told which line of hers they answer.
 *
 * Applied when the conversation is handed to her brain, never to what is stored.
 * The day's memory formation reads the stored transcript, and her own line inside
 * his turn would otherwise be filed as a thing he said — the exact confusion the
 * fact graph refuses ("something new has to be in his words").
 */
export function withReplyContext<T extends { role: string; content: string; replyTo?: { excerpt?: string } }>(messages: T[]): T[] {
  const quoted = (message: T) => (message.role === 'user' ? message.replyTo?.excerpt?.trim() : '') || '';
  if (!messages.some(quoted)) return messages;
  return messages.map(message => {
    const line = quoted(message);
    return line ? { ...message, content: `(Replying to this earlier line of yours: "${line}")\n${message.content}` } : message;
  });
}
