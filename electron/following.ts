import {devicePolicy} from './core-device-activity';
// What they are in the middle of.
//
// She already tracks where they go — ./familiar keys on the site, so it knows
// MangaDex is a habit. What it deliberately throws away is the rest of the
// title, which is the only part anybody cares about: "Oyasumi Punpun Chapter 47
// — MangaDex" is stored as "mangadex".
//
// So after a day of reading Punpun she would ask what the manga was. That is not
// a memory failure, it is a memory that was never written — and it reads as not
// paying attention, because that is exactly what it is.
//
// This keeps the work rather than the place: what it is, when they started, when
// they last touched it, and how far in they are. The last one is the point. A
// companion that knows you are on chapter 47 and were on chapter 20 yesterday is
// following along; one that knows you visit MangaDex is reading your browser
// history at you.

import type { Activity } from './activity';

export type WorkKind = 'manga' | 'anime' | 'game';

export type Work = {
  key: string;
  title: string;
  kind: WorkKind;
  firstSeen: string;
  lastSeen: string;
  /** Distinct dates it has been touched, newest last. Capped. */
  days: string[];
  /** Highest chapter or episode seen, when the title carries one. */
  progress?: number;
  /** How far along they were the last time she said something about it. */
  progressWhenMentioned?: number;
};

export type Following = Record<string, Work>;

/** Enough to see a pattern without the store growing without bound. */
const MAX_DAYS = 30;
const MAX_WORKS = 40;

/** Site names, readers and the browser's own furniture. */
const SITE = /^(mangadex|mangakakalot|manganato|mangaplus|viz|comick|bato|crunchyroll|funimation|netflix|hidive|9anime|aniwave|gogoanime|zoro|hianime|animepahe|youtube|twitch|plex|jellyfin|kodi|vlc|mpv|calibre|tachiyomi|google chrome|mozilla firefox|microsoft edge|brave|opera|vivaldi|zen browser|librewolf|arc|read online|manga online|watch online|free online)$/i;

/** Words a page puts in front of the actual name. */
const LEAD_IN = /^(read|reading|watch|watching|stream|streaming|download)\s+/i;

/** Trailing noise that survives the split. */
const TRAILING = /\s*[-–—|·:]\s*$|\s*\(\d+\)\s*$/;

const EPISODE = /\b(?:episode|ep|e)\.?\s*(\d{1,4})\b/i;
const CHAPTER = /\b(?:chapter|chap|ch)\.?\s*(\d{1,4})\b/i;
/** "S2E5" and friends, where the episode is what matters here. */
const SEASON_EPISODE = /\bs\d{1,2}\s?e(\d{1,3})\b/i;

/**
 * Splits a page title into the work and how far through it they are.
 *
 * The parts are separated by dashes and pipes, and any of them may be the site,
 * the chapter, or the name. Rather than guess an order — sites disagree, and the
 * name itself often contains a dash — each part is judged on what it looks like.
 */
export function identifyWork(activity: Activity, gameName = ''): Work | null {
 return devicePolicy('identifyWork',[activity,gameName]);
}

function blank(title: string, kind: WorkKind): Work {
  return { key: `${kind}:${title.toLowerCase()}`, title, kind, firstSeen: '', lastSeen: '', days: [] };
}

/**
 * Records that they are on it now.
 *
 * Progress only ever climbs. Titles lie in both directions — a reader that opens
 * on chapter one, a page that has not updated — and a number that goes backwards
 * would have her congratulating them on rereading something they never left.
 */
export function noteWork(following: Following, work: Work, nowIso: string, dayKey: string): Following {
 return devicePolicy('noteWork',[following,work,nowIso,dayKey]);
}

/** Oldest-touched go first once there are too many. */
function prune(following: Following): Following {
  const works = Object.values(following);
  if (works.length <= MAX_WORKS) return following;
  const kept = works
    .sort((a, b) => (b.days.length - a.days.length) || Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, MAX_WORKS);
  return Object.fromEntries(kept.map(work => [work.key, work]));
}

export function readFollowing(saved: unknown): Following {
 return devicePolicy('readFollowing',[saved]);
}

/** Something they have come back to, rather than something they opened once. */
export function isRegular(work: Work): boolean {
 return devicePolicy('isRegular',[work]);
}

export function markMentioned(following: Following, key: string): Following {
 return devicePolicy('markMentioned',[following,key]);
}

/**
 * For the paths where she is given a picture rather than a title.
 *
 * A screenshot reaches her as a vision model's description — "a black and white
 * comic page with several panels" — with the name nowhere in it. Handed the list
 * of what they are following she still called it "impressive detail in that
 * comic page", because nothing joined the two: 0/6 without this, and only 2/6
 * with the list alone. The list says what they are into; this says that the
 * unnamed thing in front of her is probably one of them.
 *
 * Hedged rather than asserted, because it is a guess. They do read other things.
 */
export function assumeItIsTheirs(following: Following, nowMs: number): string {
 return devicePolicy('assumeItIsTheirs',[following,nowMs]);
}

/**
 * What is in front of them right now, named.
 *
 * Separate from the summary below, and it earns its place. Handed a list of
 * things they are following she will still react to a window title as a stranger
 * — the failure that started this was a remark about a "bad translation" on a
 * manga she had been watching them read for days. The list tells her what they
 * are into; this tells her that the thing she is looking at *is* one of them.
 *
 * Returns nothing when the work is new, because two chapters in she genuinely
 * does not know it yet and pretending otherwise is its own kind of wrong.
 */
export function recogniseNow(following: Following, work: Work | null): string {
 return devicePolicy('recogniseNow',[following,work]);
}

const VERB: Record<WorkKind, string> = { manga: 'reading', anime: 'watching', game: 'playing' };
const UNIT: Record<WorkKind, string> = { manga: 'chapter', anime: 'episode', game: '' };

/**
 * What she is told about it.
 *
 * Written as facts rather than as an instruction to mention them. Told to bring
 * something up she will bring it up every single time, which is its own kind of
 * not listening — this is here so that when it does come up she is not asking
 * what it is.
 */
export function summariseFollowing(following: Following, nowMs: number): string {
 return devicePolicy('summariseFollowing',[following,nowMs]);
}
