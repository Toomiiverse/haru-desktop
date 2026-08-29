// Little notes, taken while the day is happening.
//
// A journal entry is written at the end of a day, about the day, and by then the
// spike of anxiety at eleven in the morning has been rounded off into "bit of a
// rough one". These are the opposite: a line and a number, taken on a phone, in
// the moment, when the thing is actually happening.
//
// They are not journal entries and are deliberately not stored as them. A
// journal entry is one considered account of a day; these are the raw material
// it gets written from, and collapsing the two would lose exactly the detail
// that makes them worth keeping — what time it was, and what had just happened.

export type CheckIn = {
  id: string;
  /** The day it belongs to, so an evening entry can gather them. */
  date: string;
  /** Full timestamp: the hour is half the point of a check-in. */
  at: string;
  /** What happened, in their words. Short by design. */
  note: string;
  /** 1–10, or nothing. Not every note is an anxious one. */
  anxiety?: number;
};

export type CheckInStore = { entries: CheckIn[] };

/** Enough for months of a busy day, and a bound so the file cannot run away. */
const MAX_CHECKINS = 2000;

export function readCheckIns(saved: unknown): CheckInStore {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<CheckInStore>;
  const entries = Array.isArray(record.entries) ? record.entries : [];
  return {
    entries: entries
      .filter(e => e && typeof e.note === 'string' && e.note.trim())
      .map(e => ({
        id: typeof e.id === 'string' ? e.id : Math.random().toString(36).slice(2, 10),
        date: typeof e.date === 'string' ? e.date : '',
        at: typeof e.at === 'string' ? e.at : '',
        note: e.note.trim().slice(0, 1000),
        anxiety: typeof e.anxiety === 'number' && e.anxiety >= 1 && e.anxiety <= 10 ? Math.round(e.anxiety) : undefined,
      })),
  };
}

export function addCheckIn(store: CheckInStore, note: string, anxiety: number | undefined, now: Date, date: string): CheckInStore {
  const entry: CheckIn = {
    id: Math.random().toString(36).slice(2, 10),
    date,
    at: now.toISOString(),
    note: note.trim().slice(0, 1000),
    anxiety: typeof anxiety === 'number' && anxiety >= 1 && anxiety <= 10 ? Math.round(anxiety) : undefined,
  };
  return { entries: [...store.entries, entry].slice(-MAX_CHECKINS) };
}

export function checkInsOn(store: CheckInStore, date: string): CheckIn[] {
  return store.entries.filter(e => e.date === date).sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The clock, in the user's zone — the same job asides.ts:170 does, and for the
 * same reason, which is where this was copied from without the argument.
 *
 * A check-in is filed under a CHAT_TIMEZONE day key and read back by one, but
 * this rendered its time in whatever zone the machine happened to be in. On the
 * server, eight hours behind, a note written at 9am Perth came back as 01:00 —
 * so she was told the day's first note was written before the day started, and
 * "anxious at 9, fine by 2" inverted. That ordering is the whole reason the
 * times are kept; see the comment below.
 */
const clock = (at: string, timeZone: string) => {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(when);
};

/**
 * The day's notes, for her to read before asking how it went.
 *
 * Given these she can ask about the actual day rather than "how was your day" —
 * which is the difference between a check-in worth doing and a form. The times
 * are kept because "anxious at 9, fine by 2" is a different day from "fine all
 * morning, anxious at 6", and only one of them is about work.
 */
export function summariseCheckIns(entries: CheckIn[], timeZone: string): string {
  if (!entries.length) return '';
  const lines = entries.map(e => `${clock(e.at, timeZone)}${e.anxiety ? ` (anxiety ${e.anxiety}/10)` : ''} — ${e.note}`);
  const rated = entries.filter(e => typeof e.anxiety === 'number').map(e => e.anxiety as number);
  const shape = rated.length
    ? ` Anxiety ran ${Math.min(...rated)} to ${Math.max(...rated)} across ${rated.length} of them.`
    : '';
  return `They jotted these down through the day, as it happened:\n${lines.join('\n')}\n${shape}`;
}

/**
 * What she should do with them at the end of the day.
 *
 * Deliberately not "summarise the notes back at them". They were there; reading
 * their own day out is not a check-in. The notes are so she can ask about the
 * part that actually mattered.
 */
export function checkInInstruction(entries: CheckIn[], timeZone: string): string {
  if (!entries.length) return '';
  const worst = entries.filter(e => typeof e.anxiety === 'number').sort((a, b) => (b.anxiety ?? 0) - (a.anxiety ?? 0))[0];
  return [
    summariseCheckIns(entries, timeZone),
    'Use these to ask about the day properly, in your own way.',
    worst && (worst.anxiety ?? 0) >= 6
      ? `Ask about "${worst.note.slice(0, 80)}" specifically — that was the worst of it, and skipping past it is how a check-in becomes a form.`
      : 'Ask about whichever of them actually mattered, not all of them in order.',
    'Do not read their own notes back to them. They were there.',
  ].filter(Boolean).join(' ');
}
