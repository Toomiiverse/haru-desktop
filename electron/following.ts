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
  // A game is already named properly by Steam, and its title carries no
  // chapters. Nothing to parse.
  if (activity.kind === 'gaming') {
    const title = (gameName || activity.label || '').trim();
    return title ? blank(title, 'game') : null;
  }
  // Never anything from the adult classification. She is not going to build a
  // reading history out of that and bring it up over breakfast.
  if (activity.kind === 'adult') return null;
  if (activity.kind !== 'watching' && activity.kind !== 'other') return null;

  const raw = (activity.label ?? '').trim();
  if (!raw) return null;

  const parts = raw.split(/\s+[-–—|·]\s+|\s*\|\s*/).map(part => part.trim()).filter(Boolean);
  let progress: number | undefined;
  let kind: WorkKind | null = null;
  const nameParts: string[] = [];

  for (const part of parts) {
    if (SITE.test(part)) continue;
    const season = SEASON_EPISODE.exec(part);
    const episode = season ?? EPISODE.exec(part);
    const chapter = CHAPTER.exec(part);
    // Chapter wins a tie: "Ch" and "E" are short enough to appear by accident,
    // and a chapter marker is the more specific of the two.
    if (chapter) {
      progress ??= Number(chapter[1]);
      kind ??= 'manga';
    } else if (episode) {
      progress ??= Number(episode[1]);
      kind ??= 'anime';
    }
    // Only what comes *before* the marker. Cutting the marker out of the middle
    // and keeping both halves glues the site's own trailing words back on:
    // "Read Oyasumi Punpun Chapter 12 Online" came out as "Oyasumi Punpun
    // Online". Nothing useful ever follows the chapter number.
    const marker = chapter ?? episode;
    const head = marker ? part.slice(0, marker.index) : part;
    const remainder = head.replace(TRAILING, '').replace(/\s+/g, ' ').trim();
    if (remainder && !SITE.test(remainder)) nameParts.push(remainder);
  }

  if (!kind) return null;
  const title = nameParts.map(part => part.replace(LEAD_IN, '').trim()).filter(Boolean)[0] ?? '';
  const clean = title.replace(TRAILING, '').trim();
  // A single word that is only a number, or nothing at all, is not a name.
  if (!clean || clean.length < 2 || /^\d+$/.test(clean)) return null;
  return { ...blank(clean, kind), progress };
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
  const existing = following[work.key];
  const days = existing ? (existing.days.includes(dayKey) ? existing.days : [...existing.days, dayKey]) : [dayKey];
  const merged: Work = {
    ...work,
    firstSeen: existing?.firstSeen || nowIso,
    // Never moves backwards: entries can arrive out of order after a restore,
    // and a stale lastSeen would have her call today's reading last week's.
    lastSeen: existing && Date.parse(existing.lastSeen) > Date.parse(nowIso) ? existing.lastSeen : nowIso,
    days: days.slice(-MAX_DAYS),
    progress: Math.max(work.progress ?? 0, existing?.progress ?? 0) || undefined,
    progressWhenMentioned: existing?.progressWhenMentioned,
  };
  const updated = { ...following, [work.key]: merged };
  return prune(updated);
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
  if (!saved || typeof saved !== 'object') return {};
  const record = saved as Following;
  return Object.fromEntries(Object.entries(record).filter(([, work]) =>
    work && typeof work.title === 'string' && Array.isArray(work.days)));
}

/** Something they have come back to, rather than something they opened once. */
export function isRegular(work: Work): boolean {
  return work.days.length >= 2;
}

export function markMentioned(following: Following, key: string): Following {
  const work = following[key];
  if (!work) return following;
  return { ...following, [key]: { ...work, progressWhenMentioned: work.progress } };
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
  if (!summariseFollowing(following, nowMs)) return '';
  return [
    'You are looking at a picture, so nothing here is labelled.',
    'If it plausibly matches one of the things above — a comic page when they are partway through a manga, a game scene when they are partway through that game — then it is that, and you should treat it as that: name it, and talk about it as something you have been following.',
    'Describing it as an unfamiliar object when it is the thing you have watched them read all week is the one thing to avoid.',
    'If it clearly is not any of them, say nothing about them at all.',
  ].join(' ');
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
  if (!work) return '';
  const known = following[work.key];
  if (!known || !isRegular(known)) return '';
  const unit = UNIT[known.kind];
  const at = known.progress && unit ? `, and they are on ${unit} ${known.progress}` : '';
  return [
    `This is ${known.title}, which you already know about: they have been ${VERB[known.kind]} it across ${known.days.length} days${at}.`,
    'Talk about it as something you have been following along with, not something you have just found.',
    'Do not ask what it is, do not ask them to explain it, and do not react as though it is new or strange to you.',
  ].join(' ');
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
  const works = Object.values(following)
    .filter(isRegular)
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, 5);
  if (!works.length) return '';
  const lines = works.map(work => {
    const days = work.days.length;
    const since = Math.round((nowMs - Date.parse(work.lastSeen)) / 86_400_000);
    const when = since <= 0 ? 'today' : since === 1 ? 'yesterday' : `${since} days ago`;
    const where = work.progress && UNIT[work.kind] ? `, on ${UNIT[work.kind]} ${work.progress}` : '';
    // The movement is the interesting part: it is the difference between
    // knowing what they read and knowing that they are getting through it.
    const moved = work.progress && work.progressWhenMentioned && work.progress > work.progressWhenMentioned
      ? ` (was ${work.progressWhenMentioned} when it last came up)`
      : '';
    return `${work.title} — ${VERB[work.kind]} it across ${days} day${days === 1 ? '' : 's'}, last ${when}${where}${moved}`;
  });
  return [
    'Things they are partway through, from what has been on their screen:',
    lines.join('; ') + '.',
    'You already know about these. Do not ask what they are, do not ask them to explain them, and never act surprised to hear of something on this list.',
    'Do not bring them up for the sake of it either — this is so you are not caught out, not a list of topics.',
  ].join(' ');
}
