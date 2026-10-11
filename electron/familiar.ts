import {devicePolicy} from './core-device-activity';
// What she already knows about where they spend their time.
//
// Without this she reacts to a category — "they have something administrative
// open" — and the category is the same at ten past nine as it is at four in the
// afternoon. So she asks what the poster thing is, and asks again an hour later,
// and the effect is not of a companion who is around but of one with no memory
// at all, which is worse than her saying nothing.
//
// What is kept is deliberately thin: which app or site, how often, roughly how
// long, and the last thing she said about it. Not page titles, not what was on
// them, not a sequence anyone could read back as a browsing history. The point
// is that she can say "still on Canva?" rather than "what's Canva?" — that needs
// a name and a count, and nothing else.

import type { Activity, ActivityKind } from './activity';

export type Haunt = {
  /** Lower-cased identity, stable across pages within the same site or app. */
  key: string;
  /** What she should call it. */
  label: string;
  kind: ActivityKind;
  firstSeen: string;
  lastSeen: string;
  /** Separate stretches of use, not page loads. */
  visits: number;
  /** Roughly how long, across all of them. */
  minutes: number;
  /** The last thing she said about it, so she can avoid saying it again. */
  lastSaid?: string;
  /**
   * The exchange itself, in brief — what they said back as well as what she
   * said. `lastSaid` alone gives her only her own half, so she can pick up her
   * thread and still not know the answer she was given: she asks how the poster
   * is going, is told it is nearly done, and asks again an hour later.
   */
  notes?: string[];
  /** Set once this has been written into her long-term memory. */
  remembered?: boolean;
};

export type Haunts = Record<string, Haunt>;

/** Two sightings closer than this are the same sitting, not a new one. */
const SAME_SITTING_MS = 8 * 60_000;
/** Beyond this the tail is places visited once and never again. */
const MAX_HAUNTS = 60;
/** Long enough to be worth mentioning as "you have been at this a while". */
export const SETTLED_IN_MINUTES = 25;

// Browsers put the site last: "Untitled design - Canva", "Inbox — Gmail",
// "some thread | Reddit". The final segment is the thing that stays the same
// while the user moves around inside it, which is exactly the identity wanted.
const SEPARATORS = /\s+[-—–|·]\s+/;

// Chrome and friends append their own name; it is not where anybody is.
const BROWSER_CHROME = /^(google chrome|mozilla firefox|microsoft.?edge|brave|opera|vivaldi|zen browser|librewolf|arc)$/i;
// Counting numbers, notification badges and the like.
const NOISE = /^(\(\d+\)|\d+|new tab|untitled|home|dashboard)$/i;

/**
 * The stable name of the place they are, or null when the title says nothing
 * worth remembering. Deliberately conservative: a wrong identity is worse than
 * none, because it has her greet an unfamiliar page like an old friend.
 */
export function identify(activity: Activity): { key: string; label: string } | null {
 return devicePolicy('identify',[activity]);
}

export function readHaunts(saved: unknown): Haunts {
 return devicePolicy('readHaunts',[saved]);
}

/** Drops the rarest once the list gets long, so it cannot grow without end. */
function prune(haunts: Haunts): Haunts {
  const entries = Object.entries(haunts);
  if (entries.length <= MAX_HAUNTS) return haunts;
  entries.sort((a, b) => (b[1].visits - a[1].visits) || b[1].lastSeen.localeCompare(a[1].lastSeen));
  return Object.fromEntries(entries.slice(0, MAX_HAUNTS));
}

/**
 * Telemetry-shaped keys that say nothing about the person: the Steam helper
 * process, a raw URL as a window title, a command prompt path, an OS "wants to
 * open" prompt. They are not a haunt — they are noise that would otherwise take
 * a slot real places deserve.
 */
const JUNK_HAUNTS = [
  /^steamwebhelper$/i,
  /^(cmd|powershell|windows powershell|command prompt|terminal|explorer|explorer\.exe)$/i,
  /^(c|d|e):\\/i,
  /:\/\//,
  /^www\./,
  /\/watch\b|\/watch\?/,
  /\bwants? to open\b/i,
];

export function isJunkHaunt(key: string): boolean {
 return devicePolicy('isJunkHaunt',[key]);
}

/** How long a valueless haunt is worth keeping before it is just noise. */
export const EMPTY_HAUNT_DAYS = 7;

/**
 * Expire haunts that never earned their place: a visit that logged no minutes
 * and no exchange says nothing about the person, and a junk key says even
 * less. Anything with minutes, notes or a last word survives — that is the
 * record of a real place.
 */
export function expireHaunts(haunts: Haunts, nowMs: number, emptyDays = EMPTY_HAUNT_DAYS): Haunts {
 return devicePolicy('expireHaunts',[haunts,nowMs,emptyDays]);
}

/**
 * Records that they are here now. Time is accumulated from the gap since the
 * last sighting rather than measured, which is the only thing available from a
 * poll — and close enough for "you have been at this a while".
 */
export function noteVisit(haunts: Haunts, activity: Activity, nowMs: number): { haunts: Haunts; haunt: Haunt } {
 return devicePolicy('noteVisit',[haunts,activity,nowMs]);
}

export function rememberSaid(haunts: Haunts, key: string, line: string): Haunts {
 return devicePolicy('rememberSaid',[haunts,key,line]);
}

/** Kept short and few: this rides in every prompt about the place. */
const MAX_NOTES = 4;
const NOTE_LENGTH = 180;

function tighten(text: string, limit: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Ties an exchange to the place it happened in.
 *
 * Only what was actually said, trimmed — not summarised, because summarising
 * costs a model call per message and loses exactly the specifics that make this
 * worth having. "Nearly done, just the fonts" is the whole point; a summary
 * would render it as "discussed progress".
 */
export function noteExchange(haunts: Haunts, key: string, said: string, replied: string): Haunts {
 return devicePolicy('noteExchange',[haunts,key,said,replied]);
}

/**
 * Whether an exchange belongs to the place at all.
 *
 * Being in Canva while saying something is not the same as saying something
 * about Canva, and tying every message to whatever happened to be in front of
 * them would build a record of the conversation indexed by window — which is
 * both useless to her and more than this should ever hold. So it has to be
 * named, or be an answer to her having just raised it.
 */
export function belongsToPlace(haunt: Haunt, message: string, sheRaisedItMs: number | undefined, nowMs: number) {
 return devicePolicy('belongsToPlace',[haunt,message,sheRaisedItMs,nowMs]);
}

/**
 * Enough history to be worth committing to memory rather than left in passing.
 * A pattern, not a glimpse: they either keep coming back to it, or one long
 * visit spread over real time. One 30-minute sitting with two comments is a
 * moment; returning to it across days is a fact about the person.
 */
export function worthRemembering(haunt: Haunt) {
 return devicePolicy('worthRemembering',[haunt]);
}

export function markRemembered(haunts: Haunts, key: string): Haunts {
 return devicePolicy('markRemembered',[haunts,key]);
}

function ago(fromIso: string, nowMs: number) {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * What she knows walking in, as an instruction rather than as data.
 *
 * The whole point is the last line: told only that she has been here before,
 * a model will still open with a question, because opening with a question is
 * what the rest of the prompt asked for. It has to be told not to.
 */
export function familiarity(haunt: Haunt, nowMs: number): string {
 return devicePolicy('familiarity',[haunt,nowMs]);
}
