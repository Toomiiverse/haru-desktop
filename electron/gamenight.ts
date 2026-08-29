// Reading up on what they play.
//
// The night pass (nightlife.ts) lets her pick anything. This narrows it, some
// of the time, to the one subject she has an actual reason to care about: the
// game they have been playing. The desk already tells her — every stretch in
// a game reaches the activity log under its Steam name, and the screenshots
// they take arrive captioned — and Steam's own record of recent play can be
// read with a key, without ever touching their login.
//
// Same rule as every night: she reads a real guide and knows what it said,
// nothing more. She has not played it and is told not to say she has.

import type { ActivityLog } from './activitylog';
import { minutesOf } from './activitylog';
import type { Night } from './nightlife';

export type Played = {
  name: string;
  /** In the window, from the activity log. Zero when only Steam knows it. */
  minutes: number;
  /** Steam's figure for the last fortnight, when there is one. */
  steamMinutes?: number;
  /** What their screenshots showed while they were in it — a boss, a menu, a map. */
  seen: string[];
};

/** How far back the desk's record is looked at. */
export const PLAYED_WINDOW_DAYS = 3;
/** Not the same game every night, whatever they play. */
export const GUIDE_REST_NIGHTS = 3;
/** With a game to read about, how often the night is spent on it rather than on anything. */
export const GUIDE_ODDS = 0.6;

function shiftDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days));
  return at.toISOString().slice(0, 10);
}

/**
 * What they have been playing, from the desk's own record.
 *
 * Captions ride along only when the screenshot was taken during a stretch in
 * that game — a picture of a PC case is not a picture of the game just because
 * it was the same afternoon — and only when they say something: a caption is
 * how "Dark Souls guide" becomes "Dark Souls Capra Demon guide".
 */
export function gamesPlayedLately(log: ActivityLog, todayKey: string, days = PLAYED_WINDOW_DAYS): Played[] {
  const from = shiftDays(todayKey, -days);
  const byName = new Map<string, Played>();
  for (const [day, entries] of Object.entries(log ?? {})) {
    if (day < from || day > todayKey) continue;
    const stretches = (entries ?? []).filter(entry => entry.kind === 'gaming' && entry.label?.trim());
    for (const entry of stretches) {
      const played = byName.get(entry.label) ?? { name: entry.label, minutes: 0, seen: [] };
      played.minutes += minutesOf(entry);
      byName.set(entry.label, played);
    }
    for (const entry of entries ?? []) {
      if (!entry.shot || !entry.description?.trim()) continue;
      const at = Date.parse(entry.at);
      const during = stretches.find(stretch => at >= Date.parse(stretch.at) && at <= Date.parse(stretch.until) + 60_000);
      if (!during) continue;
      const played = byName.get(during.label);
      if (played && played.seen.length < 3) played.seen.push(entry.description.trim().slice(0, 160));
    }
  }
  return [...byName.values()].filter(played => played.minutes >= 10).sort((a, b) => b.minutes - a.minutes);
}

export type SteamRecent = { name: string; minutesLastFortnight: number };

/**
 * Things on a Steam account that are not games. A night spent on "Wallpaper
 * Engine beginner guide tips" is a night wasted, and Steam counts the hours all
 * the same.
 */
const NOT_GAMES = /^(wallpaper engine|steamvr|steam link|blender|aseprite|source sdk|proton|steamworks|obs studio|vtube studio|3dmark|unity|unreal)\b/i;

/** "Overwatch®" is not what anyone types into a search box. */
export function plainName(name: string): string {
  return name.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();
}

/** The desk's record and Steam's, as one list. Steam fills in what the desk never saw. */
export function withSteam(played: Played[], steam: SteamRecent[]): Played[] {
  const out = played.map(entry => ({ ...entry, name: plainName(entry.name) }));
  for (const recent of steam) {
    const name = plainName(recent.name ?? '');
    if (!name || recent.minutesLastFortnight < 30 || NOT_GAMES.test(name)) continue;
    const known = out.find(entry => entry.name.toLowerCase() === name.toLowerCase());
    if (known) known.steamMinutes = recent.minutesLastFortnight;
    else out.push({ name, minutes: 0, steamMinutes: recent.minutesLastFortnight, seen: [] });
  }
  // Three days of the desk's record against a fortnight of Steam's: compared
  // as minutes a day, so a game they are in every evening outranks one they
  // put ten hours into a week ago.
  const rate = (entry: Played) => Math.max(entry.minutes / PLAYED_WINDOW_DAYS, (entry.steamMinutes ?? 0) / 14);
  return out.sort((a, b) => rate(b) - rate(a));
}

/**
 * Which game tonight, if any: the most played that she has not read up on in
 * the last few nights. Null means the night is hers to spend on anything.
 */
export function pickGame(played: Played[], nights: Night[], todayKey: string): Played | null {
  const restFrom = shiftDays(todayKey, -GUIDE_REST_NIGHTS);
  const readLately = new Set(nights.filter(night => night.game && night.day >= restFrom).map(night => night.game!.toLowerCase()));
  return played.find(entry => !readLately.has(entry.name.toLowerCase())) ?? null;
}

/**
 * What to search for. A caption that names something specific — a boss, an
 * area, a mechanic — makes the search specific; without one it is the general
 * guide, and a game she has read about before gets a different angle.
 */
export function guideQuery(game: Played, nights: Night[]): string {
  const before = nights.filter(night => night.game?.toLowerCase() === game.name.toLowerCase()).length;
  const hint = game.seen.map(specificThing).find(Boolean);
  if (hint) return `${game.name} ${hint} guide`;
  const angles = ['beginner guide tips', 'walkthrough guide', 'tips and tricks', 'best build guide', 'things I wish I knew'];
  return `${game.name} ${angles[before % angles.length]}`;
}

/** A proper noun or two out of a caption, if it has one worth searching. */
export function specificThing(caption: string): string | null {
  // Up to four capitalised words, allowing a small connector between them —
  // "Margit the Fell Omen", "Lake of Rot" — and never starting on one.
  const names = caption.match(/\b[A-Z][a-z]+(?:\s+(?:(?:of|the|de)\s+)?[A-Z][a-z]+){0,3}\b/g) ?? [];
  const useful = names.map(name => name.trim()).filter(name => !STOPNAMES.has(name.toLowerCase()) && name.length > 3);
  return useful[0] ?? null;
}

const STOPNAMES = new Set(['the', 'a', 'an', 'this', 'that', 'there', 'screenshot', 'screen', 'window', 'menu', 'the screen', 'the game', 'game', 'player', 'the player', 'text', 'button', 'image']);

/** What she is told with the guide in front of her. */
export function guideNoteInstruction(game: Played, query: string, found: string): string {
  const how = game.minutes >= 60 ? `${Math.round(game.minutes / 60)} hours over the last few days` : game.minutes ? `${game.minutes} minutes lately` : game.steamMinutes ? `${Math.round(game.steamMinutes / 60)} hours in the last fortnight` : 'lately';
  const seen = game.seen.length ? `You have seen their screenshots from it: ${game.seen.map(text => `"${text}"`).join('; ')}.` : '';
  return [
    `They have been playing ${game.name} — ${how}. ${seen} While they slept you went and read a guide to it ("${query}"). This is what you found, and it is everything you know about the game:`,
    found,
    'Write two or three sentences, as yourself, first person, past tense: what the guide said, and what you make of it — including whether it looks like something they are doing wrong, if the guide and their screenshots suggest it. Have an opinion.',
    'Only what is above. Do not add anything about the game you happen to remember, do not invent a mechanic or a boss to make a better point, and do not say you played it — you read a guide, which is all you did.',
    'No preamble, no addressing them, no questions. A note to yourself.',
  ].filter(Boolean).join('\n');
}
