// 4530: what her replies were looked up from, carried with them.
//
// Saved history kept her words but not her searches, so the turn after one
// ("where did you get that?") had no sign she had searched: the checking-claim
// check refused the true answer and she said no search ran (2026-10-19 03:10).
// Each phone reply now keeps the lookups behind it; the model sees them as a
// note on that reply, and the check accepts the reply's own earlier reads.
import type {ToolReceipt} from './tool-receipt';

export type Lookup = {tool: string; about: string};
const NOTE = /\n*\[lookups behind this reply: [^\]\n]*\]\s*$/;
const TOOL = /\b[a-z]+(?:_[a-z]+)+\b/g;

/** A read that succeeded, as kept with the reply; anything else is nothing. */
export function lookupOf(receipt: ToolReceipt): Lookup | null {
  if (receipt.outcome !== 'succeeded' || (receipt.access !== 'read' && receipt.tool !== 'browser_control')) return null;
  const s = receipt.scope, about = [s.query, s.url, s.title, s.topic].find(v => typeof v === 'string' && v.trim()) as string | undefined;
  return {tool: receipt.tool, about: (about ?? '').replace(/[\[\]"\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)};
}

export function lookupNote(lookups: Lookup[]): string {
  return `[lookups behind this reply: ${lookups.slice(0, 6).map(l => l.about ? `${l.tool} "${l.about}"` : l.tool).join('; ')}]`;
}

/** Her replies as the model is shown them: each with the note of what it was looked up from. */
export function withLookupNotes<T extends {role: string; content: string; lookups?: Lookup[]}>(messages: T[]): T[] {
  return messages.map(m => m.role === 'assistant' && m.lookups?.length && typeof m.content === 'string' ? {...m, content: `${m.content}\n\n${lookupNote(m.lookups)}`} : m);
}

/** A note she copied onto a new reply is not hers to say. */
export function dropLookupNote(reply: string): string {
  return reply.replace(NOTE, '');
}

/** The tools behind her last few replies, read off their notes in the conversation she was given. */
export function priorLookups(conversation: {role: string; content?: unknown}[], replies = 3): string[] {
  // A refused draft of this turn sits among them on a retry; it carries no note, so it only uses up one of the few.
  const notes = conversation.filter(m => m.role === 'assistant').slice(-replies - 1)
    .map(m => typeof m.content === 'string' ? m.content.match(NOTE)?.[0] ?? '' : '');
  return [...new Set(notes.join(' ').replace(/"[^"]*"/g, '').match(TOOL) ?? [])];
}
