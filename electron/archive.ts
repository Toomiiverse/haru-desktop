// Every day she has already had, kept out of the way.
//
// The transcripts used to live in config.json under `chat.archive`, which was
// fine when there were three days of them and wrong by the time there were
// ninety. electron-store serialises the whole file on every set, and the life
// loop sets `vitals` every twenty seconds — so the entire back catalogue was
// being rewritten to disk four thousand times a day to record that she had got
// slightly sleepier. Measured on the server: 820 KB rewritten every ~20s, on
// course for 2.5 MB once the ninety-day window filled.
//
// Splitting it out is not only about the bytes. config.json holds the persona,
// the API keys and the memories; the archive holds the raw past. One of those
// is rewritten constantly and one is appended to twice a day, and a file being
// rewritten constantly is the one you least want to be holding the keys when a
// write goes wrong.
//
// Written the same way as knowledge.json — temp file, rename, no partial
// states — because that is the only property that matters here.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Day key (`2026-08-29`) to the lines said that day. Line shape is the
 *  caller's business; this module only ever moves them around. */
export type Archive = Record<string, unknown[]>;

/**
 * What survives a read: string keys holding arrays, and nothing else. A day
 * whose value got mangled is dropped rather than handed on, on the grounds that
 * half a transcript in the wrong shape is worse downstream than no transcript.
 */
export function normalizeArchive(value: unknown): Archive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Archive = {};
  for (const [day, lines] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(lines)) out[day] = lines;
  }
  return out;
}

/** A missing file, an unparseable one, or one full of the wrong shapes all come
 *  back empty rather than throwing: no archive is a recoverable state, and a
 *  crash at startup is not. */
export function loadArchive(file: string): Archive {
  try {
    if (!existsSync(file)) return {};
    return normalizeArchive(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    console.warn(`[archive] could not read ${file}:`, error instanceof Error ? error.message : error);
    return {};
  }
}

export function saveArchive(file: string, archive: Archive): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, JSON.stringify(archive));
  renameSync(tmp, file);
}
