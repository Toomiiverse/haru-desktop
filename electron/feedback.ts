// What they thought of a reply, written down where it can be learned from.
//
// A thumb already lands on the stored message and shapes her next prompt (see
// feedbackSummary). That is the short loop. This is the long one: every rating,
// from the phone or the desk, appended as one line of JSON to a file that is
// nothing but ratings — the reply, what prompted it, which model wrote it, and
// what they said about it. A day of those is a preference dataset; a month is
// enough to tune on. Kept out of config.json on purpose: that file is rewritten
// whole by the app, and a log wants appending to, never rewriting.

import { appendFileSync } from 'node:fs';

export type Reaction = 'up' | 'down';

export type FeedbackEntry = {
  at: string;
  source: 'phone' | 'desktop';
  /** The stored message's id, so a later note can be matched to the thumb. */
  id: string;
  reaction: Reaction | null;
  note: string | null;
  /** An emoji put on the reply, when that is what the rating was. */
  emoji: string | null;
  /** What they said that she was answering, or null when she spoke first. */
  prompt: string | null;
  reply: string;
  model: string;
};

type Stored = { id?: string; role: string; content?: string; reaction?: string };

const NOTE_MAX = 1000;

/** The note as it will be kept: trimmed, bounded, and absent when empty. */
export function cleanNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const clean = note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  return clean || null;
}

/**
 * One line's worth, or nothing when the id is not a reply of hers.
 *
 * The prompt is the nearest thing they said before the reply, which is how the
 * conversation is actually shaped — a reply answers the message above it, and
 * one she volunteered answers nothing. A reaction that is not given falls back
 * to the one already on the message, so a note added after a thumb still
 * records the thumb.
 */
export function feedbackEntry(
  history: Stored[],
  about: { id: string; reaction?: Reaction | null; note?: unknown; emoji?: string; source: 'phone' | 'desktop'; model: string; at: string },
): FeedbackEntry | null {
  const index = history.findIndex(message => message.id === about.id);
  if (index < 0 || history[index].role !== 'assistant') return null;
  const before = history.slice(0, index).reverse().find(message => message.role === 'user');
  const given = about.reaction ?? (history[index].reaction === 'up' || history[index].reaction === 'down' ? history[index].reaction as Reaction : null);
  return {
    at: about.at,
    source: about.source,
    id: about.id,
    reaction: given,
    note: cleanNote(about.note),
    emoji: typeof about.emoji === 'string' && about.emoji.trim() ? about.emoji.trim().slice(0, 16) : null,
    prompt: before?.content ?? null,
    reply: history[index].content ?? '',
    model: about.model,
  };
}

/** Appended, one JSON object per line. Throws if the disk says no; the caller logs it. */
export function recordFeedback(file: string, entry: FeedbackEntry): void {
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}
