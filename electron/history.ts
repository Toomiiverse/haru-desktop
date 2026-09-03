// Telling old messages from new ones.
//
// Every message in the store carried `time: "now"` — the literal string, on all
// of them, for ever. It is what the bubble prints, and nothing anywhere recorded
// when anything was actually said. So the conversation handed to the model is a
// flat wall of text in which a line from last Tuesday at midnight sits flush
// against one from thirty seconds ago, indistinguishable.
//
// That is the mechanism behind a whole family of complaints, not one bug. Her
// own past assertions never expire: a marketing campaign she invented once was
// still "the campaign I was talking about earlier" two days later, and a remark
// framed for eleven at night reads as current at breakfast. She is not
// misremembering. She is reading something with no date on it and correctly
// concluding it is now.
//
// The fix is not to hide the old messages — the history is worth having — but to
// say plainly where the seams are.

import { zonedNow } from './dates';

export type Dated = { role: string; content: string; at?: string };

/** Below this a gap is just someone thinking, and marking it would be noise. */
export const GAP_MINUTES = 90;

const MINUTE = 60_000;

/**
 * Both instants read in the user's zone before anything is compared.
 *
 * "The next morning" is a statement about their day, and their day happens
 * somewhere. Read with the machine's own getters instead — which is what this
 * did — a night that ran from 20:00 to 06:00 Perth is 12:00 to 22:00 on a UTC
 * server: one calendar day, ten hours apart, and she was told an overnight
 * silence was an afternoon lull. The hour test misread the same way, calling
 * eight in the evening "the next afternoon".
 */
function inZone(at: Date, timeZone: string): Date {
  return zonedNow(timeZone, at);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * How to describe a gap, from the later message's point of view.
 *
 * Relative rather than absolute — "the next morning" is what a person would say,
 * and a bare timestamp invites her to read it out. The one exception is a gap
 * long enough that "later" stops being meaningful.
 */
export function describeGap(before: Date, after: Date, timeZone: string): string {
  // The length of the gap is a fact about the two instants and needs no zone;
  // which day and which part of the day they fall in is a fact about the user.
  const minutes = Math.round((after.getTime() - before.getTime()) / MINUTE);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const there = { before: inZone(before, timeZone), after: inZone(after, timeZone) };
  if (sameDay(there.before, there.after)) {
    if (hours < 4) return `about ${hours} hour${hours === 1 ? '' : 's'} later, the same day`;
    return 'later the same day';
  }
  if (days <= 1) {
    const hour = there.after.getHours();
    const part = hour < 12 ? 'the next morning' : hour < 18 ? 'the next afternoon' : 'the next evening';
    return part;
  }
  if (days < 7) return `${days} days later`;
  if (days < 30) return `about ${Math.round(days / 7)} weeks later`;
  return 'a long time later';
}

/**
 * The same conversation with the seams named.
 *
 * A note goes in as a system message rather than being glued onto the next line,
 * so it cannot be mistaken for something either of them said — and so that a
 * model which ignores it is no worse off than before.
 *
 * Undated messages are passed through untouched. Everything already in the store
 * predates this and has no timestamp to reason from; guessing one would be worse
 * than the flatness being fixed.
 */
export function markTimeGaps<T extends Dated>(messages: T[], timeZone: string, gapMinutes = GAP_MINUTES): (T | { role: 'system'; content: string })[] {
  const out: (T | { role: 'system'; content: string })[] = [];
  let previous: Date | null = null;
  for (const message of messages) {
    const at = message.at ? new Date(message.at) : null;
    const usable = at && !Number.isNaN(at.getTime()) ? at : null;
    if (usable && previous && usable.getTime() - previous.getTime() >= gapMinutes * MINUTE) {
      out.push({
        role: 'system',
        // Short: five of these sat in one prompt at eighty tokens each, read by
        // the hosted model before every first word. The rule is the same.
        content: `[Time passed — what follows was said ${describeGap(previous, usable, timeZone)}. What is above is background, not still going on: carry no plan, mood or time of day across this line.]`,
      });
    }
    if (usable) previous = usable;
    out.push(message);
  }
  return out;
}

/**
 * How long ago the last thing was said, for the composers that speak first.
 *
 * She opens conversations, and an opening line written as though the last
 * exchange were still warm is the same failure seen from the other end.
 */
export function sinceLast(messages: Dated[], now: Date, timeZone: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = messages[i].at ? new Date(messages[i].at as string) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const minutes = Math.round((now.getTime() - at.getTime()) / MINUTE);
    if (minutes < GAP_MINUTES) return '';
    return `The last thing either of you said was ${describeGap(at, now, timeZone)} — that conversation is over. Do not pick it up mid-thought or refer back to it as though no time has passed.`;
  }
  return '';
}

/** Days of finished conversation put in front of today's. */
export const DAYS_OF_HISTORY = 3;
/**
 * What those days may take, in characters.
 *
 * The model's window is a million tokens and she was being handed six and a
 * half thousand, of which the conversation itself was one thousand — everything
 * said before this morning left the prompt at the five o'clock rollover and was
 * replaced by a one-line summary of the day. Thirty days and two and a half
 * thousand messages sat on disk unread.
 *
 * The ceiling is not the hosted model's window but the local one's, which
 * answers when the hosted route is down: twenty thousand tokens for everything,
 * so this takes about five and leaves room for the brief and for the day itself.
 */
export const HISTORY_BUDGET_CHARS = 20_000;

/**
 * The finished days before today, newest last, trimmed from the oldest end to
 * fit the budget. Whole exchanges only — half a conversation reads worse than
 * none — so the trim drops from the front and never mid-day.
 */
export function earlierTurns<T extends Dated>(archive: Record<string, T[]>, todayKey: string, days = DAYS_OF_HISTORY, budget = HISTORY_BUDGET_CHARS): T[] {
  const wanted = Object.keys(archive).filter(day => day < todayKey).sort().slice(-days);
  const byDay = wanted.map(day => (archive[day] ?? []).filter(message => message.role === 'user' || message.role === 'assistant'));
  const size = (turns: T[]) => turns.reduce((sum, turn) => sum + String(turn.content ?? '').length, 0);
  // Oldest first out, so what survives is what was said most recently.
  while (byDay.length > 1 && byDay.reduce((sum, turns) => sum + size(turns), 0) > budget) byDay.shift();
  // One day left and still too much: its evening, from a message of theirs,
  // rather than nothing. A small budget — a phone that wants her first word
  // in a second — should still see how yesterday ended.
  if (byDay.length === 1 && size(byDay[0]) > budget) {
    let day = byDay[0];
    while (day.length && size(day) > budget) day = day.slice(1);
    while (day.length && day[0].role !== 'user') day = day.slice(1);
    byDay[0] = day;
  }
  return byDay.flat();
}

