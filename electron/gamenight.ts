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

import {corePolicySync} from './core-policy-sync';
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
export const GUIDE_ODDS = 0.2;

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
  return corePolicySync<Played[]>('game-guide.playedLately',[log,todayKey,days]);
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
  return corePolicySync<string>('game-guide.plainName',[name]);
}

/** The desk's record and Steam's, as one list. Steam fills in what the desk never saw. */
export function withSteam(played: Played[], steam: SteamRecent[]): Played[] {
  return corePolicySync<Played[]>('game-guide.withSteam',[played,steam]);
}

/**
 * Which game tonight, if any: the most played that she has not read up on in
 * the last few nights. Null means the night is hers to spend on anything.
 */
export function pickGame(played: Played[], nights: Night[], todayKey: string): Played | null {
  return corePolicySync<Played|null>('game-guide.pickGame',[played,nights,todayKey]);
}

/**
 * What to search for. A caption that names something specific — a boss, an
 * area, a mechanic — makes the search specific; without one it is the general
 * guide, and a game she has read about before gets a different angle.
 */
export function guideQuery(game: Played, nights: Night[]): string {
  return corePolicySync<string>('game-guide.guideQuery',[game,nights]);
}

/** A proper noun or two out of a caption, if it has one worth searching. */
export function specificThing(caption: string): string | null {
  return corePolicySync<string|null>('game-guide.specificThing',[caption]);
}

const STOPNAMES = new Set(['the', 'a', 'an', 'this', 'that', 'there', 'screenshot', 'screen', 'window', 'menu', 'the screen', 'the game', 'game', 'player', 'the player', 'text', 'button', 'image']);

/** What she is told with the guide in front of her. */
export function guideNoteInstruction(game: Played, query: string, found: string): string {
  return corePolicySync<string>('game-guide.instruction',[game,query,found]);
}

/** Supply only the conditional entropy requested by Core. No local selection. */
export function chooseGuide(adopting:unknown,interest:unknown,played:Played[],nights:Night[],today:string,draw:()=>number):Played|null{
  const args=[adopting,interest,played,nights,today];
  let plan=corePolicySync<{needsDraws?:number;result?:Played|null}>('game-guide.choose',[...args,[]]);
  if(plan.needsDraws!==undefined){
    if(plan.needsDraws!==1)throw Error('game_guide_entropy_protocol');
    plan=corePolicySync('game-guide.choose',[...args,[draw()]]);
  }
  if(!Object.hasOwn(plan,'result')||plan.needsDraws!==undefined)throw Error('game_guide_policy_protocol');
  return plan.result??null;
}
