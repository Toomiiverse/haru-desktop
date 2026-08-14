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
  const title = (activity.label ?? '').trim();
  if (!title) return null;
  const parts = title.split(SEPARATORS).map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  // Walk back from the end, since the site sits last and may be followed by the
  // browser's own name.
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i];
    if (BROWSER_CHROME.test(candidate) || NOISE.test(candidate)) continue;
    // A whole sentence is a page title, not a site name.
    if (candidate.length > 40 || candidate.split(/\s+/).length > 5) continue;
    return { key: candidate.toLowerCase(), label: candidate };
  }
  return null;
}

export function readHaunts(saved: unknown): Haunts {
  if (!saved || typeof saved !== 'object') return {};
  const record = saved as Haunts;
  const out: Haunts = {};
  for (const [key, haunt] of Object.entries(record)) {
    if (haunt && typeof haunt.key === 'string' && typeof haunt.label === 'string') out[key] = haunt;
  }
  return out;
}

/** Drops the rarest once the list gets long, so it cannot grow without end. */
function prune(haunts: Haunts): Haunts {
  const entries = Object.entries(haunts);
  if (entries.length <= MAX_HAUNTS) return haunts;
  entries.sort((a, b) => (b[1].visits - a[1].visits) || b[1].lastSeen.localeCompare(a[1].lastSeen));
  return Object.fromEntries(entries.slice(0, MAX_HAUNTS));
}

/**
 * Records that they are here now. Time is accumulated from the gap since the
 * last sighting rather than measured, which is the only thing available from a
 * poll — and close enough for "you have been at this a while".
 */
export function noteVisit(haunts: Haunts, activity: Activity, nowMs: number): { haunts: Haunts; haunt: Haunt } {
  const found = identify(activity);
  const now = new Date(nowMs).toISOString();
  if (!found) {
    const blank: Haunt = { key: '', label: activity.label, kind: activity.kind, firstSeen: now, lastSeen: now, visits: 1, minutes: 0 };
    return { haunts, haunt: blank };
  }
  const existing = haunts[found.key];
  if (!existing) {
    const haunt: Haunt = { key: found.key, label: found.label, kind: activity.kind, firstSeen: now, lastSeen: now, visits: 1, minutes: 0 };
    return { haunts: prune({ ...haunts, [found.key]: haunt }), haunt };
  }
  const gap = nowMs - Date.parse(existing.lastSeen);
  const continuing = gap >= 0 && gap < SAME_SITTING_MS;
  const haunt: Haunt = {
    ...existing,
    label: found.label,
    kind: activity.kind,
    lastSeen: now,
    visits: continuing ? existing.visits : existing.visits + 1,
    minutes: continuing ? existing.minutes + gap / 60_000 : existing.minutes,
  };
  return { haunts: prune({ ...haunts, [found.key]: haunt }), haunt };
}

export function rememberSaid(haunts: Haunts, key: string, line: string): Haunts {
  const existing = haunts[key];
  if (!existing) return haunts;
  return { ...haunts, [key]: { ...existing, lastSaid: line.slice(0, 300) } };
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
  const existing = haunts[key];
  if (!existing) return haunts;
  const note = `They said: "${tighten(said, NOTE_LENGTH)}" — you answered: "${tighten(replied, NOTE_LENGTH)}"`;
  const notes = [...(existing.notes ?? []), note].slice(-MAX_NOTES);
  return { ...haunts, [key]: { ...existing, notes } };
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
  if (!haunt.key) return false;
  if (message.toLowerCase().includes(haunt.key)) return true;
  return sheRaisedItMs !== undefined && nowMs - sheRaisedItMs < 10 * 60_000;
}

/** Enough history to be worth committing to memory rather than left in passing. */
export function worthRemembering(haunt: Haunt) {
  return !haunt.remembered && (haunt.notes?.length ?? 0) >= 2 && haunt.minutes >= 30;
}

export function markRemembered(haunts: Haunts, key: string): Haunts {
  const existing = haunts[key];
  if (!existing) return haunts;
  return { ...haunts, [key]: { ...existing, remembered: true } };
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
  if (!haunt.key || haunt.visits <= 1 && haunt.minutes < 2) return '';
  const parts: string[] = [];
  const settled = haunt.minutes >= SETTLED_IN_MINUTES;
  const roughly = haunt.minutes >= 60
    ? `${Math.round(haunt.minutes / 60)} hour${Math.round(haunt.minutes / 60) === 1 ? '' : 's'}`
    : `${Math.round(haunt.minutes)} minutes`;

  // One long sitting and a habit of coming back are different facts about
  // somebody, and reading "1 separate times" back at her is neither.
  parts.push(haunt.visits > 1
    ? `You know ${haunt.label}. They keep going back to it — ${haunt.visits} separate stretches now, about ${roughly} of your time watching them in it altogether, the last of it ${ago(haunt.lastSeen, nowMs)}.`
    : `You know ${haunt.label}. They have been in it for about ${roughly} already, in one sitting.`);
  if (settled && haunt.visits > 1) parts.push('They have been at it a good while this time too.');
  if (haunt.notes?.length) {
    // Ahead of lastSaid, because this half carries their answers — the part she
    // is otherwise liable to ask for twice.
    parts.push(`What has already passed between you about it, oldest first: ${haunt.notes.join(' | ')}.`);
  } else if (haunt.lastSaid) {
    parts.push(`The last thing you said to them about it was: "${haunt.lastSaid}"`);
  }
  parts.push('So do not ask what it is, do not ask what they are working on as though this were new, do not ask anything they have already answered above, and do not repeat yourself.');
  parts.push('Pick it up where it was left: ask how the thing they were doing in it is going, be pointed about how long it is taking, or say something that only makes sense because you have watched them at this before.');
  return parts.join(' ');
}
