// Turns the calendar into something she can talk about. The important part is
// that a time which has already been and gone is not just another line on a
// list — she should notice, and want to know how it went.

import { parseTimeOfDay } from './dates';

export type AgendaItem = { title: string; date: string; time?: string; done: boolean };
export type ItemStatus = 'done' | 'overdue' | 'now' | 'upcoming';

/** Anything unfinished from within this window is still worth chasing. */
export const OVERDUE_WINDOW_DAYS = 7;
/** Treated as happening right now rather than missed, either side of the hour. */
const NOW_WINDOW_MINUTES = 30;

function minutesInto(day: Date) {
  return day.getHours() * 60 + day.getMinutes();
}

export function itemStatus(item: AgendaItem, now: Date, todayKey: string): ItemStatus {
  if (item.done) return 'done';
  if (item.date < todayKey) return 'overdue';
  if (item.date > todayKey) return 'upcoming';
  // An all-day item today has not been missed until the day is over.
  const parsed = item.time ? parseTimeOfDay(item.time) : null;
  if (!parsed) return 'upcoming';
  const difference = minutesInto(now) - (parsed.hour * 60 + parsed.minute);
  if (difference > NOW_WINDOW_MINUTES) return 'overdue';
  if (difference >= -NOW_WINDOW_MINUTES) return 'now';
  return 'upcoming';
}

function shiftDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(year, month - 1, day + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

/**
 * What she should have in front of her: everything from today onward, plus
 * anything recently missed. Without that second part a task simply vanishes the
 * next morning, which is the opposite of a companion who was paying attention.
 */
// Sorted on the clock, not on the label. Comparing "8:00 AM" against "11:30 AM"
// as text puts the afternoon first, which had her reading the day back in the
// wrong order.
function timeRank(item: AgendaItem) {
  const parsed = item.time ? parseTimeOfDay(item.time) : null;
  // All-day items lead the day rather than trailing it.
  return parsed ? parsed.hour * 60 + parsed.minute : -1;
}

export function relevantItems(items: AgendaItem[], todayKey: string) {
  const earliest = shiftDays(todayKey, -OVERDUE_WINDOW_DAYS);
  return items
    .filter(item => item.date >= todayKey || (!item.done && item.date >= earliest))
    .sort((a, b) => a.date.localeCompare(b.date) || timeRank(a) - timeRank(b));
}

/**
 * Finds the item a phrase refers to, so "yeah I got the milk" can close out
 * "Get milk". Scored on shared words rather than an exact title, because nobody
 * repeats their own reminder verbatim. Unfinished items win ties — confirming
 * something usually means the one still outstanding.
 */
export function findItem<T extends AgendaItem>(items: T[], phrase: string): T | null {
  const asked = new Set(phrase.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2));
  if (!asked.size) return null;
  let best: { item: T; overlap: number; rank: number } | null = null;
  for (const item of items) {
    const words = new Set(item.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2));
    if (!words.size) continue;
    const shared = [...words].filter(word => asked.has(word)).length;
    if (!shared) continue;
    const overlap = shared / words.size;
    // The unfinished bonus only breaks ties between candidates; it must not lift
    // a weak match over the bar, which let "did you eat?" close out "Eat lunch
    // with Dad" on a single shared word.
    const rank = overlap + (item.done ? 0 : 0.25);
    if (!best || rank > best.rank) best = { item, overlap, rank };
  }
  // Half the title's own words have to actually appear.
  return best && best.overlap >= 0.5 ? best.item : null;
}

/**
 * Whether a message is saying something has NOT been done. Cancelled and
 * not-yet-done are opposite states, and the model conflates them: told "I never
 * did get the milk" it reached for delete every time, wording the tool
 * description could not talk it out of. Deleting there loses work the user still
 * has to do, so it is refused in code rather than discouraged in prose.
 */
export function readsAsNotDone(text: string) {
  return /(never (did|got|managed)|didn'?t (get|do|make|manage|have time)|did not (get|do|manage)|haven'?t (got|done|had)|have not (got|done)|not done|still (need|have) to|forgot to|no time to)/i.test(text);
}

function relativeDay(dateKey: string, todayKey: string, weekday: Intl.DateTimeFormat) {
  if (dateKey === todayKey) return 'today';
  if (dateKey === shiftDays(todayKey, 1)) return 'tomorrow';
  if (dateKey === shiftDays(todayKey, -1)) return 'yesterday';
  const [year, month, day] = dateKey.split('-').map(Number);
  const when = new Date(year, month - 1, day);
  return dateKey < todayKey ? `last ${weekday.format(when)}` : weekday.format(when);
}

/**
 * The calendar block for the prompt. Each line carries its own relative day and
 * status so she needs to do no date arithmetic and no clock-reading to work out
 * what has already happened.
 */
export function formatAgenda(items: AgendaItem[], now: Date, todayKey: string, limit = 25): string {
  const relevant = relevantItems(items, todayKey).slice(0, limit);
  if (!relevant.length) return 'The user has nothing saved from today onward.';

  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
  const lines = relevant.map(item => {
    const status = itemStatus(item, now, todayKey);
    const when = `${item.date} (${relativeDay(item.date, todayKey, weekday)}) ${item.time ?? 'all day'}`;
    const mark = status === 'done' ? ' [done]'
      : status === 'overdue' ? ' [TIME HAS PASSED - you never heard whether it happened]'
      : status === 'now' ? ' [happening about now]'
      : '';
    return `${when} - ${item.title}${mark}`;
  });

  const parts = [`Saved items: ${lines.join('; ')}.`];
  if (relevant.some(item => itemStatus(item, now, todayKey) === 'overdue')) {
    parts.push('Anything marked as passed went by without them telling you how it went. Ask whether it actually happened, and be openly put out that you were left to find out for yourself — you are supposed to be the one keeping track. Do not mark it done yourself and do not let it slide.');
  }
  return parts.join(' ');
}
