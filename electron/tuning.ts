// What was wrong with a reply of hers, and what he would rather she had said.
//
// The thumb is hers. It lands on her mood, it is quoted into her next prompt,
// and she answers it back — that is the short loop, and it is in feedback.ts.
// This is not that. These notes are written *about* her, for whoever is tuning
// her: read at the end of a day, or handed to an agent to read. She never sees
// one, which is the whole point — a critique written for the tuner ("too long,
// stop opening with 'ugh'") quoted back into her prompt is a correction she
// starts performing rather than a fault that gets fixed.
//
// Two files, on purpose. The .jsonl is the record: one object a line, appended
// and never rewritten, which is what an agent should read. Beside it, one
// markdown page a day, because the other reader is a person at the end of a
// day and JSON is not reading.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { repliedTo, type Reaction, type Stored } from './feedback';

export type TuningNote = {
  at: string;
  /** The local day it belongs to (YYYY-MM-DD), so a day's notes group without redoing timezone math on the way out. */
  day: string;
  source: 'phone' | 'desktop';
  /** The stored message's id, so two notes on one reply can be told apart from two replies. */
  id: string;
  /** What was wrong with it. */
  wrong: string | null;
  /** What she should have said instead — the half of this that is a training pair. */
  rather: string | null;
  /** The thumb already on the reply, if any. Never given here: a tuning note is not a rating. */
  reaction: Reaction | null;
  /** What they said that she was answering, or null when she spoke first. */
  prompt: string | null;
  reply: string;
  model: string;
};

const WRONG_MAX = 1000;
const RATHER_MAX = 4000;

/** What was wrong, as one line: trimmed, bounded, and absent when empty. */
export function cleanWrong(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  return text.replace(/\s+/g, ' ').trim().slice(0, WRONG_MAX) || null;
}

/**
 * The rewrite, kept as written.
 *
 * Line breaks survive here where they do not in `wrong`: her replies paint as
 * one bubble a paragraph, so a rewrite with paragraphs in it is a rewrite that
 * says how many bubbles it should have been. Runs of blank lines are still
 * flattened to one — that much is typing, not intent.
 */
export function cleanRather(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, RATHER_MAX) || null;
}

/**
 * One note's worth, or nothing — when the id is not a reply of hers, or when
 * neither field has anything in it. An empty note is a mis-tap, and a log of
 * mis-taps is a log nobody trusts.
 */
export function tuningNote(
  history: Stored[],
  about: { id: string; wrong?: unknown; rather?: unknown; source: 'phone' | 'desktop'; model: string; at: string; day: string },
): TuningNote | null {
  const said = repliedTo(history, about.id);
  if (!said) return null;
  const wrong = cleanWrong(about.wrong);
  const rather = cleanRather(about.rather);
  if (!wrong && !rather) return null;
  return {
    at: about.at,
    day: about.day,
    source: about.source,
    id: about.id,
    wrong,
    rather,
    reaction: said.reaction,
    prompt: said.prompt,
    reply: said.reply,
    model: about.model,
  };
}

/** Appended, one JSON object per line. Throws if the disk says no; the caller logs it. */
export function recordTuning(file: string, note: TuningNote): void {
  appendFileSync(file, JSON.stringify(note) + '\n', 'utf8');
}

/** The clock on a note, in the day's own hours. */
function clock(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? '??:??' : at.slice(11, 16);
}

/** Quoted so a reply with its own markdown in it cannot restyle the page. */
function quoted(text: string): string {
  return text.split('\n').map(line => line ? '> ' + line : '>').join('\n');
}

/** One note as a person reads it. */
export function tuningPage(note: TuningNote): string {
  const worn = note.reaction === 'up' ? ' 👍' : note.reaction === 'down' ? ' 👎' : '';
  const lines = [`### ${clock(note.at)}${worn}`, ''];
  if (note.prompt) lines.push('**He said**', quoted(note.prompt), '');
  lines.push('**She said**', quoted(note.reply), '');
  if (note.wrong) lines.push(`**Wrong:** ${note.wrong}`, '');
  if (note.rather) lines.push('**Rather**', quoted(note.rather), '');
  lines.push(`<sub>${note.source} · ${note.model || 'model unknown'} · ${note.id}</sub>`, '');
  return lines.join('\n');
}

/**
 * The note on the day's page, made if it is not there yet.
 *
 * Appended rather than rebuilt from the jsonl: a page that is rewritten whole
 * is a page that can be lost whole, and anything he scribbles into one by hand
 * while reading it survives the next note.
 */
export function appendTuningPage(dir: string, note: TuningNote): void {
  mkdirSync(dir, { recursive: true });
  const page = join(dir, `${note.day}.md`);
  const opening = existsSync(page) ? '' : `# What was wrong — ${note.day}\n\n`;
  appendFileSync(page, opening + tuningPage(note) + '\n', 'utf8');
}
