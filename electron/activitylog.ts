import {devicePolicy} from './core-device-activity';
// The day at the desk, written down.
//
// Everything else in the activity path is built to forget. readActivity reduces
// a window to a category, only the category reaches the log, and main.ts says
// plainly why: "a browsing history written to disk is a different thing from her
// reading a window title and forgetting it". That is still true. This file is
// the deliberate exception, switched on by hand, because a companion who cannot
// remember what you spent Tuesday doing has to ask every time.
//
// So it keeps the raw titles. What makes that defensible is where they go: this
// machine, and one other machine on the same tailnet that belongs to the same
// person. Nothing here is sent to a model vendor, and the push refuses any
// address that is not a tailnet one for the same reason the check-in pull does.
//
// Two things keep it from becoming a firehose. Consecutive sightings of the same
// window extend the entry they already have rather than adding a row, so a day
// of alt-tabbing between two windows is two entries that grow, not four hundred;
// and a day is capped, so a pathological loop cannot fill the disk.

import type { ActivityKind } from './activity';

/** One stretch at one window. `until` moves while it stays in front. */
export type ActivityEntry = {
  at: string;
  until: string;
  kind: ActivityKind;
  /** What she would call it — the Steam name for a game, the site for a page. */
  label: string;
  process: string;
  /** The raw window title. Empty for anything redacted. */
  title: string;
  url?: string;
  /** Set on a screenshot entry: the bare file name, which is what identifies it
   *  when the description arrives a moment later. */
  shot?: string;
  /** What the local vision model made of that screenshot. This, not the image,
   *  is what travels far enough to become a memory — the server has no vision
   *  model, and describing it twice on two machines would be paying twice for
   *  an answer the desk already has. */
  description?: string;
};

/** Day key (`2026-08-29`) to what was in front of them that day. */
export type ActivityLog = Record<string, ActivityEntry[]>;

/** Beyond this a day is a loop, not a day. */
export const MAX_ENTRIES_PER_DAY = 600;

/**
 * Coming back to the same window after this long is a new sitting rather than
 * the same one continuing. Matches familiar.ts's SAME_SITTING_MS, so the log and
 * the haunts agree about what counts as one stretch.
 */
export const SAME_STRETCH_MS = 8 * 60_000;

/**
 * What never gets written down, whatever else does.
 *
 * activity.ts classifies adult browsing so that the raw title never reaches the
 * model. Writing it to a file that then travels to another machine would undo
 * that decision by the back door, so the category and the timing are kept and
 * the title is not. Delete this and the two lines that call it to log those
 * titles like any other.
 */
export function isRedacted(kind: ActivityKind): boolean {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('isRedacted',[kind]);
  return kind === 'adult';
}

function sameWindow(entry: ActivityEntry, next: { process: string; title: string }): boolean {
  return entry.process === next.process && entry.title === next.title;
}

/**
 * Note that this window is in front, now.
 *
 * Returns the log unchanged when nothing about it moved, so a caller can write
 * only when there is something to write — the poller fires far more often than
 * the picture actually changes.
 */
export function noteActivity(
  log: ActivityLog,
  day: string,
  seen: { kind: ActivityKind; label: string; process: string; title: string; url?: string },
  now: Date,
): ActivityLog {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('noteActivity',[log,day,seen,now.toISOString()]);
  const at = now.toISOString();
  const redacted = isRedacted(seen.kind);
  const entry: ActivityEntry = {
    at,
    until: at,
    kind: seen.kind,
    label: redacted ? '' : seen.label,
    process: seen.process,
    title: redacted ? '' : seen.title,
    ...(redacted || !seen.url ? {} : { url: seen.url }),
  };
  const today = log[day] ?? [];
  const last = today[today.length - 1];
  // Still here: move the end, do not add a row. Compared on the raw window
  // rather than the label, since two different pages on one site share a label
  // and are not the same stretch.
  if (last && sameWindow(last, { process: entry.process, title: entry.title })
    && now.getTime() - new Date(last.until).getTime() < SAME_STRETCH_MS) {
    if (last.until === at) return log;
    return { ...log, [day]: [...today.slice(0, -1), { ...last, until: at }] };
  }
  return { ...log, [day]: [...today, entry].slice(-MAX_ENTRIES_PER_DAY) };
}

/**
 * Note that a screenshot was taken, and what was in front when it was.
 *
 * Its own entry rather than a stretch: a screenshot happens at an instant, so
 * it has no duration and never will, and everything that reasons about
 * durations has to know not to ask.
 */
export function noteScreenshot(
  log: ActivityLog,
  day: string,
  shot: { name: string; doing?: { kind: ActivityKind; label: string } },
  now: Date,
): ActivityLog {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('noteScreenshot',[log,day,shot,now.toISOString()]);
  const at = now.toISOString();
  const doing = shot.doing && !isRedacted(shot.doing.kind) ? shot.doing : null;
  const entry: ActivityEntry = {
    at,
    until: at,
    kind: doing ? doing.kind : 'other',
    label: 'screenshot',
    process: SCREENSHOT_PROCESS,
    title: doing ? `${shot.name} — while in ${doing.label}` : shot.name,
    shot: shot.name,
  };
  return { ...log, [day]: [...(log[day] ?? []), entry].slice(-MAX_ENTRIES_PER_DAY) };
}

/** The process name a screenshot entry carries, so nothing has to parse a title
 *  to know it is looking at one. */
export const SCREENSHOT_PROCESS = 'screenshot';

export function isScreenshotEntry(entry: ActivityEntry): boolean {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('isScreenshotEntry',[entry]);
  return entry.process === SCREENSHOT_PROCESS;
}

/**
 * Attach what the vision model saw to the screenshot it saw it in.
 *
 * Matched on the file name rather than on position: the description arrives a
 * second or two after the entry, and a burst of screenshots can put other
 * entries in between. Returns the log unchanged when there is nothing to attach
 * it to, so a caller can avoid a pointless write.
 */
export function describeShot(log: ActivityLog, day: string, name: string, description: string): ActivityLog {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('describeShot',[log,day,name,description]);
  const today = log[day];
  const text = description.trim();
  if (!today || !text) return log;
  let index = -1;
  for (let at = today.length - 1; at >= 0; at -= 1) {
    if (today[at].shot === name) { index = at; break; }
  }
  if (index < 0 || today[index].description === text) return log;
  const next = [...today];
  next[index] = { ...next[index], description: text };
  return { ...log, [day]: next };
}

/** Whole minutes at one window, rounded down; a stretch under a minute is 0. */
export function minutesOf(entry: ActivityEntry): number {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('minutesOf',[entry]);
  const span = new Date(entry.until).getTime() - new Date(entry.at).getTime();
  return Number.isFinite(span) && span > 0 ? Math.floor(span / 60_000) : 0;
}

/**
 * The day in the few lines worth giving a model.
 *
 * Grouped by what she would call the thing rather than listed by the minute:
 * "Figma 95m, Elden Ring 140m" is what a day was about, where two hundred
 * timestamped rows is a log file. Longest first, since that is the order in
 * which a day is worth mentioning, and short stretches are dropped entirely —
 * a window someone passed through is not something they did.
 */
export function summariseDay(entries: ActivityEntry[], limit = 12): string {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('summariseDay',[entries,limit]);
  const byLabel = new Map<string, { label: string; kind: ActivityKind; minutes: number }>();
  for (const entry of entries) {
    // Screenshots are counted below, not timed. They are taken at an instant,
    // so their duration is zero by construction — put through the minutes floor
    // with everything else they were silently dropped, which made the whole log
    // of them reach the server and then never reach her.
    if (isScreenshotEntry(entry)) continue;
    const label = entry.label || entry.process;
    if (!label) continue;
    const held = byLabel.get(label.toLowerCase());
    if (held) held.minutes += minutesOf(entry);
    else byLabel.set(label.toLowerCase(), { label, kind: entry.kind, minutes: minutesOf(entry) });
  }
  const stretches = [...byLabel.values()]
    .filter(item => item.minutes >= 5)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit)
    .map(item => `${item.label} (${item.kind}, ${item.minutes}m)`)
    .join('; ');
  return [stretches, summariseShots(entries)].filter(Boolean).join('. ');
}

/** How many screenshots, and what the ones she looked at were of. */
export const SHOT_DESCRIPTIONS = 3;

export function summariseShots(entries: ActivityEntry[]): string {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('summariseShots',[entries]);
  const shots = entries.filter(isScreenshotEntry);
  if (!shots.length) return '';
  const count = `${shots.length} screenshot${shots.length === 1 ? '' : 's'}`;
  // The descriptions are the whole reason a screenshot is worth remembering —
  // "a screenshot was taken" is not a fact about anybody's day. Trimmed hard,
  // because a vision model given no limit will write a paragraph per image.
  const said = shots
    .map(entry => entry.description?.trim())
    .filter((text): text is string => Boolean(text))
    .slice(-SHOT_DESCRIPTIONS)
    .map(text => text.slice(0, 160));
  return said.length ? `${count}: ${said.join('; ')}` : count;
}

/**
 * Which of two copies of the same entry to keep.
 *
 * Every rule is ordered and total, so both machines reach the same answer for
 * the same pair without conferring — the property the whole sync rests on. The
 * previous rule was "the longer stretch wins, otherwise keep what we already
 * have", and the second half of that is not symmetric: a screenshot has no
 * duration, so `until` always tied, and whichever machine ran the merge kept its
 * own copy. That was invisible until captions arrived. The desk captions a
 * screenshot with the model on its GPU and pushes it; the server, holding its
 * own copy of the same entry, kept that one and discarded the caption; and
 * because the push only goes one way the desk never found out. Two machines,
 * two different captions for one screenshot, for ever.
 *
 * A caption is therefore the first thing compared, and the copy that has one
 * beats the copy that does not, whichever side is asking.
 */
function preferred(a: ActivityEntry, b: ActivityEntry): ActivityEntry {
  const captionOf = (entry: ActivityEntry) => (entry.description ?? '').trim();
  const mine = captionOf(a);
  const theirs = captionOf(b);
  if (Boolean(mine) !== Boolean(theirs)) return mine ? a : b;
  // A stretch seen for longer is the better view of it.
  if (a.until !== b.until) return a.until > b.until ? a : b;
  // Two captions of one image, from two models. Neither side can tell which
  // model wrote which, so this picks by something both can see and agree on
  // rather than pretending to judge: the fuller account, then the alphabet.
  if (mine !== theirs) return mine.length !== theirs.length ? (mine.length > theirs.length ? a : b) : (mine > theirs ? a : b);
  // Equal on everything that is compared, and possibly still not identical.
  // Ordered on the whole record so the answer does not depend on which side
  // happens to be holding it.
  return JSON.stringify(a) <= JSON.stringify(b) ? a : b;
}

/**
 * Both machines' logs as one day.
 *
 * Only the desk writes these in practice — the server has no foreground window
 * — but a merge that assumed so would silently drop whatever it found, so this
 * does not assume it. An entry is identified by when it started and what was in
 * front; which copy of it survives is preferred()'s business.
 */
export function mergeActivity(mine: ActivityLog, theirs: unknown): ActivityLog {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('mergeActivity',[mine,theirs]);
  const incoming = normalizeActivityLog(theirs);
  const merged: ActivityLog = { ...mine };
  for (const [day, entries] of Object.entries(incoming)) {
    const byKey = new Map<string, ActivityEntry>();
    for (const entry of [...(merged[day] ?? []), ...entries]) {
      const key = `${entry.at}|${entry.process}|${entry.title}`;
      const held = byKey.get(key);
      byKey.set(key, held ? preferred(held, entry) : entry);
    }
    merged[day] = [...byKey.values()]
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-MAX_ENTRIES_PER_DAY);
  }
  return merged;
}

/**
 * What survives a read, whether off the disk or off the network. Anything
 * missing the two fields every caller indexes on is dropped rather than handed
 * on half-formed.
 */
export function normalizeActivityLog(value: unknown): ActivityLog {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('normalizeActivityLog',[value]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ActivityLog = {};
  for (const [day, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry): entry is ActivityEntry =>
      Boolean(entry) && typeof entry === 'object'
      && typeof (entry as ActivityEntry).at === 'string'
      && typeof (entry as ActivityEntry).process === 'string')
      .map(entry => ({ ...entry, until: typeof entry.until === 'string' ? entry.until : entry.at }));
    if (kept.length) out[day] = kept.slice(-MAX_ENTRIES_PER_DAY);
  }
  return out;
}
