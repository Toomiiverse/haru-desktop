// The screenshots themselves, kept on the server.
//
// screenshots.ts says the looking stays on this machine whatever the chat model
// is set to, and that is still true — the vision model that describes a
// screenshot is local and nothing here changes it. What changes is where the
// file rests afterwards: on the desk, and on one other machine on the same
// tailnet belonging to the same person, so that the half of her that answers the
// phone can see what the half at the desk saw.
//
// The name arrives over the network, which makes this the only module here that
// takes a caller's word for a filename. It does not: the name is reduced to its
// last segment, checked against a deliberately narrow allowlist, and required to
// end in an image extension. A name that cannot survive that is refused rather
// than repaired, because a repaired path is a path somebody worked out how to
// repair.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Day key (`2026-08-29`) to the screenshot names held for that day. */
export type HeldShots = Record<string, string[]>;

/** Bigger than any screenshot a desktop takes, small enough that a wrong guess
 *  about what is being uploaded does not fill a disk. */
export const MAX_SHOT_BYTES = 25 * 1024 * 1024;

/** Letters, digits, space, dash, underscore, dot. Nothing else survives — no
 *  separators, no colons, no leading dots, and so nothing that can climb. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}\.(png|jpe?g|webp)$/i;
const SAFE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The name this file may be written under, or null.
 *
 * path.basename first, so `../../etc/passwd.png` becomes `passwd.png` before
 * anything else looks at it, and a name that still contains a separator
 * afterwards — which no basename does — is refused outright rather than
 * stripped again.
 */
export function safeName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const base = path.basename(name.trim());
  if (!base || base !== name.trim()) return null;
  if (base.includes('/') || base.includes('\\') || base.includes('\0')) return null;
  if (!SAFE_NAME.test(base)) return null;
  return base;
}

/** A day key and nothing that could be one. */
export function safeDay(day: unknown): string | null {
  return typeof day === 'string' && SAFE_DAY.test(day) ? day : null;
}

/** What is already here, so the desk only sends what is missing. */
export function heldShots(root: string): HeldShots {
  const held: HeldShots = {};
  let days: string[];
  try { days = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { return {}; }
  for (const day of days) {
    if (!safeDay(day)) continue;
    try {
      const names = readdirSync(path.join(root, day)).filter(name => safeName(name));
      if (names.length) held[day] = names;
    } catch { /* a day that will not list is a day with nothing in it */ }
  }
  return held;
}

/**
 * Keep one. Returns the path written, or throws if the name or day is refused —
 * the caller turns that into a 400 rather than a 500, because it is the sender
 * that got it wrong.
 */
export function keepShot(root: string, day: unknown, name: unknown, bytes: Buffer): string {
  const onlyDay = safeDay(day);
  const onlyName = safeName(name);
  if (!onlyDay) throw new Error('that is not a day');
  if (!onlyName) throw new Error('that is not a name a screenshot can have');
  if (!bytes.length) throw new Error('the file was empty');
  if (bytes.length > MAX_SHOT_BYTES) throw new Error('that file is too big');
  const dir = path.join(root, onlyDay);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, onlyName);
  // Belt and braces: after joining, the result still has to be inside the root.
  // safeName already makes this impossible; it is here because the cost of being
  // wrong about that is somebody else's file being overwritten.
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('that path is not inside the store');
  const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, target);
  return target;
}

/** Read one back, or null when it is not there. */
export function readShot(root: string, day: string, name: string): Buffer | null {
  const onlyDay = safeDay(day);
  const onlyName = safeName(name);
  if (!onlyDay || !onlyName) return null;
  const file = path.join(root, onlyDay, onlyName);
  try { return existsSync(file) ? readFileSync(file) : null; } catch { return null; }
}

/**
 * Drop whole days older than the cutoff. Images are the largest thing she keeps
 * and the least re-readable, so they go on the same clock as the activity log
 * that describes them rather than living until somebody notices the disk.
 */
export function pruneShots(root: string, cutoffDay: string): number {
  let dropped = 0;
  for (const day of Object.keys(heldShots(root))) {
    if (day >= cutoffDay) continue;
    try {
      rmSync(path.join(root, day), { recursive: true, force: true });
      dropped += 1;
    } catch { /* a folder that will not delete is not worth stopping for */ }
  }
  return dropped;
}

/** One local screenshot worth sending: where it is, and the day it belongs to. */
export type LocalShot = { file: string; name: string; day: string };

/**
 * The screenshots on this machine from the last `days` days, oldest first.
 *
 * Read off the folder rather than from a queue kept alongside: a queue goes
 * stale the moment somebody deletes a screenshot, and the folder is the truth
 * about what exists. Oldest first so a backlog is sent in the order it happened.
 */
export function localShots(
  folder: string,
  dayOf: (at: Date) => string,
  isScreenshot: (name: string) => boolean,
  now: Date,
  days: number,
): LocalShot[] {
  const cutoff = now.getTime() - days * 86_400_000;
  let names: string[];
  try { names = readdirSync(folder); } catch { return []; }
  const found: (LocalShot & { at: number })[] = [];
  for (const name of names) {
    if (!isScreenshot(name) || !safeName(name)) continue;
    const file = path.join(folder, name);
    try {
      const stat = statSync(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SHOT_BYTES) continue;
      const at = stat.birthtimeMs || stat.mtimeMs;
      if (at < cutoff) continue;
      found.push({ file, name, day: dayOf(new Date(at)), at });
    } catch { /* a file that will not stat is a file that is not there */ }
  }
  return found.sort((a, b) => a.at - b.at).map(({ file, name, day }) => ({ file, name, day }));
}

/** What the desk has that the server does not, in the order they happened. */
export function missingFrom(held: HeldShots, mine: LocalShot[]): LocalShot[] {
  return mine.filter(shot => !(held[shot.day] ?? []).includes(shot.name));
}
