import {corePolicySync} from './core-policy-sync';
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
  return corePolicySync('conversation-inputs.quote',[text]);
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
  return corePolicySync('conversation-inputs.resolveReply',[ask,lines]);
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
  return corePolicySync('conversation-inputs.replyContext',[messages]);
}
