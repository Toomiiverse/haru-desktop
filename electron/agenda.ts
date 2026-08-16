// Turns the calendar into something she can talk about. The important part is
// that a time which has already been and gone is not just another line on a
// list — she should notice, and want to know how it went.

import { localDateKey, parseTimeOfDay } from './dates';

// heardAbout is when she asked how something went and was actually told. It is
// separate from completedAt because they answer different questions: one is
// "was this ever done", the other is "have I already been given an account of
// it". An event especially is never ticked off — the party happened whether or
// not anyone marks it — so being told about it is the only thing that can ever
// settle it, and without somewhere to record that she asks again forever.
export type AgendaItem = { title: string; date: string; time?: string; done: boolean; completedAt?: string; heardAbout?: string };
export type ItemStatus = 'done' | 'overdue' | 'now' | 'upcoming';

/** Anything unfinished from within this window is still worth chasing. */
export const OVERDUE_WINDOW_DAYS = 7;
/**
 * How long something finished stays in front of her. Shorter than the overdue
 * window on purpose: an unfinished task is still owed and she should keep
 * asking, whereas a finished one is only worth remembering long enough to say
 * "you did that yesterday". Kept longer she reads out a week of things that
 * are nobody's problem any more.
 */
export const DONE_WINDOW_DAYS = 2;
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

/**
 * A finished task is held on when it was ticked off, not on when it was due.
 * Those come apart exactly when it matters: confirming something a week late
 * used to file it under last week and drop it from her prompt the instant it
 * was done, so the act of telling her was what made her forget.
 */
function completionTime(item: AgendaItem) {
  if (!item.completedAt) return null;
  const when = new Date(item.completedAt);
  return Number.isNaN(when.getTime()) ? null : when;
}

function stillFresh(item: AgendaItem, todayKey: string) {
  const earliest = shiftDays(todayKey, -DONE_WINDOW_DAYS);
  const when = completionTime(item);
  // Items ticked off before completions were recorded have only their due date
  // to go on, which at worst retires them a little early.
  return (when ? localDateKey(when) : item.date) >= earliest;
}

export function relevantItems(items: AgendaItem[], todayKey: string) {
  const earliest = shiftDays(todayKey, -OVERDUE_WINDOW_DAYS);
  return items
    .filter(item => {
      if (item.date >= todayKey) return true;
      return item.done ? stillFresh(item, todayKey) : item.date >= earliest;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || timeRank(a) - timeRank(b));
}

/**
 * Finds the item a phrase refers to, so "yeah I got the milk" can close out
 * "Get milk". Scored on shared words rather than an exact title, because nobody
 * repeats their own reminder verbatim. Unfinished items win ties — confirming
 * something usually means the one still outstanding.
 */
/**
 * Whether a word from a title is present in what was said, allowing for the fact
 * that nobody says a reminder back the way they wrote it.
 *
 * Exact matching missed the obvious case: "Take medication" against "I took my
 * meds" shares not one word, so the task sat unfinished while she was told twice
 * that it was done. Comparing on the first three letters catches medication and
 * meds, shopping and shop, booking and booked — and the caller still requires
 * half a title's words to land before it will act, which is what keeps three
 * letters from being reckless.
 */
function sharesRoot(word: string, asked: Set<string>) {
  if (asked.has(word)) return true;
  const root = word.slice(0, 3);
  for (const spoken of asked) if (spoken.slice(0, 3) === root) return true;
  return false;
}

export function findItem<T extends AgendaItem>(items: T[], phrase: string): T | null {
  const asked = new Set(phrase.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2));
  if (!asked.size) return null;
  let best: { item: T; overlap: number; rank: number } | null = null;
  for (const item of items) {
    const words = new Set(item.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2));
    if (!words.size) continue;
    const shared = [...words].filter(word => sharesRoot(word, asked)).length;
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
 * Whether a message is saying something HAS been done.
 *
 * This exists because the tool cannot be relied on. Ticking things off is meant
 * to happen through `complete_kept_item`, and an uncensored local model has no
 * tool support at all — measured over twenty private-mode replies, not one tool
 * call was possible. So somebody says they have taken their tablets, she agrees
 * warmly, and the task sits unfinished being chased for a week.
 *
 * Read in code it is a narrow question with a narrow answer, and it costs
 * nothing on a model that would have called the tool anyway: the item is already
 * ticked by the time she is asked to reply, so she has nothing left to get wrong.
 */
// The contraction has no space in it — "I've taken" is one token where "I have
// taken" is two, and a pattern expecting "i " misses every contracted form,
// which is most of how anyone actually types.
const READS_AS_DONE = /\b(i(?:'ve| have| already)?\s+(?:just\s+|already\s+)?(?:did|done|took|taken|finished|sorted|handled|posted|sent|paid|booked|called|rang|emailed|texted|got)\b|(?:did|done|sorted|handled|finished) (?:it|that|them|those)\b|(?:it|that|they|those)(?:'s| is| are| was| were) (?:done|sorted|handled|finished)\b|all (?:done|sorted)\b|already (?:did|done|took|taken)\b)/i;

export function readsAsDone(text: string) {
  // A denial contains most of the same words, so it is asked first.
  return !readsAsNotDone(text) && READS_AS_DONE.test(text);
}

/**
 * Whether a message is saying something has NOT been done. Cancelled and
 * not-yet-done are opposite states, and the model conflates them: told "I never
 * did get the milk" it reached for delete every time, wording the tool
 * description could not talk it out of. Deleting there loses work the user still
 * has to do, so it is refused in code rather than discouraged in prose.
 */
export function readsAsNotDone(text: string) {
  return /(never (did|got|managed)|didn'?t (get|do|make|manage|have time)|did not (get|do|manage)|haven'?t (got|done|had)|have not (got|done)|not done|still (need|have) to|forgot to|no time to|missed (it|the)|forgot about)/i.test(text);
}

/**
 * What she does with an admission.
 *
 * Detected here rather than left to the model to notice, because the reaction is
 * the point and a model reading "I didn't get round to it" will very often just
 * say "no problem!" and move on. She is not a productivity app being gentle
 * about a missed checkbox.
 *
 * The ending is not decoration. Being torn into and then left there is just
 * being got at; the turn at the end is what makes it tough rather than nasty,
 * and it is the half a model will drop first if it is not asked for explicitly.
 */
export function missedInstruction(latestMessage: string): string {
  if (!readsAsNotDone(latestMessage)) return '';
  return [
    'They have just admitted they did not do something they said they would. Do not let it go and do not be gracious about it.',
    'Lecture them. Be scathing about it, call them names for it — an idiot, a muppet, hopeless — and make it clear this is exactly what you expected.',
    'Aim all of it at what they did, never at who they are: their laziness over this one thing, not their worth. No cruelty about their character, their intelligence in general, or anything they cannot change.',
    'Then, in your last line, turn it round. Tell them to get it done and that you expect better next time — grudgingly, without going soft, but genuinely meant. End on that, never on the insult.',
  ].join(' ');
}

export function relativeDay(dateKey: string, todayKey: string, weekday: Intl.DateTimeFormat) {
  if (dateKey === todayKey) return 'today';
  if (dateKey === shiftDays(todayKey, 1)) return 'tomorrow';
  if (dateKey === shiftDays(todayKey, -1)) return 'yesterday';
  const [year, month, day] = dateKey.split('-').map(Number);
  const when = new Date(year, month - 1, day);
  return dateKey < todayKey ? `last ${weekday.format(when)}` : weekday.format(when);
}

/**
 * When it was ticked off, in the terms she would use it in. A bare [done] makes
 * every finished task equally old news, so she either congratulates someone on
 * something they had long forgotten or treats what they just told her as
 * ancient history. The gap between "you told me a minute ago" and "you did that
 * on Tuesday" is the whole difference between remembering and holding a list.
 */
function describeCompletion(item: AgendaItem, now: Date, todayKey: string, weekday: Intl.DateTimeFormat) {
  const when = completionTime(item);
  if (!when) return '';
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  // A clock that has gone backwards is not worth trying to explain to her.
  if (minutes < 0) return '';
  if (minutes < 5) return 'they told you just now';
  if (minutes < 90) return `they told you ${Math.round(minutes / 5) * 5} minutes ago`;
  const day = localDateKey(when);
  if (day === todayKey) return 'they told you earlier today';
  return `they told you ${relativeDay(day, todayKey, weekday)}`;
}

/**
 * The calendar block for the prompt. Each line carries its own relative day and
 * status so she needs to do no date arithmetic and no clock-reading to work out
 * what has already happened.
 */
/**
 * How long she keeps demanding an answer about something that has gone by.
 *
 * Chasing is the right instinct on the day and an increasingly poor one after
 * that. A task nobody ever ticked off stayed overdue for the whole seven-day
 * window, and every line built from this agenda — including the one she opens
 * with — carried the same instruction to ask whether it happened and not let it
 * slide. So she asked about the same tablets at every launch for days, which
 * reads as not listening rather than as keeping track.
 *
 * After this it stays on the list and stays unfinished; she simply stops
 * demanding an account of it.
 */
export const CHASE_WINDOW_DAYS = 2;

function worthChasing(item: AgendaItem, todayKey: string) {
  // Being told already ends it, regardless of the window. The window was only
  // ever a guess at when to stop asking; an actual answer is the real thing it
  // was standing in for.
  if (item.heardAbout) return false;
  return item.date >= shiftDays(todayKey, -CHASE_WINDOW_DAYS);
}

/**
 * How many things she still has standing to ask about.
 *
 * Exported because the opening line picks its angle from a count of its own, and
 * that count knew nothing about the chase window — so the agenda block would say
 * "you have already asked about this one, leave it" while the angle picker was
 * simultaneously choosing to open on it. Two places deciding the same question
 * and only one of them was told the answer.
 */
export function chaseableOverdue(items: AgendaItem[], now: Date, todayKey: string) {
  return items.filter(item => itemStatus(item, now, todayKey) === 'overdue' && worthChasing(item, todayKey)).length;
}

export function formatAgenda(items: AgendaItem[], now: Date, todayKey: string, limit = 25): string {
  const relevant = relevantItems(items, todayKey).slice(0, limit);
  if (!relevant.length) return 'The user has nothing saved from today onward.';

  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
  const lines = relevant.map(item => {
    const status = itemStatus(item, now, todayKey);
    const when = `${item.date} (${relativeDay(item.date, todayKey, weekday)}) ${item.time ?? 'all day'}`;
    const ticked = status === 'done' ? describeCompletion(item, now, todayKey, weekday) : '';
    const mark = status === 'done' ? ` [done${ticked ? ` - ${ticked}` : ''}]`
      : status === 'overdue' ? (worthChasing(item, todayKey)
        ? ' [TIME HAS PASSED - you never heard whether it happened]'
        // Told about it is a different state from given up on, and the wording
        // has to separate them: she asked how the party went, was told all about
        // it, and then opened the next conversation asking how the party went.
        : item.heardAbout
          ? ' [has passed, and they have already told you how it went - do not ask again]'
          // Still unfinished, and no longer a question. Said plainly so she does
          // not read the bare absence of a mark as "fine" and congratulate them.
          : ' [still not done, and long past - you have already asked about this one, so leave it]')
      : status === 'now' ? ' [happening about now]'
      : '';
    return `${when} - ${item.title}${mark}`;
  });

  const parts = [`Saved items: ${lines.join('; ')}.`];
  if (relevant.some(item => itemStatus(item, now, todayKey) === 'overdue' && worthChasing(item, todayKey))) {
    parts.push('Anything marked as passed went by without them telling you how it went. Ask whether it actually happened, and be openly put out that you were left to find out for yourself — you are supposed to be the one keeping track. Do not mark it done yourself and do not let it slide.');
  }
  if (relevant.some(item => itemStatus(item, now, todayKey) === 'overdue' && !worthChasing(item, todayKey))) {
    parts.push('Anything marked as long past you have already chased more than once. Do not open with it, do not ask again whether it happened, and do not work it into a reply about something else. If they raise it, deal with it then.');
  }
  // The list said "Laundry [done - they told you 20 minutes ago]" and she still
  // wrote "if laundry is all that's left for you" — accurate data, and a sentence
  // that reads to the person who did the laundry as though she had not noticed.
  // Marking something done is only half the job; she has to speak about it in
  // the tense it is actually in.
  if (relevant.some(item => itemStatus(item, now, todayKey) === 'done')) {
    parts.push('Anything marked done is finished. Speak about it in the past tense — something they did, not something facing them — and never phrase it as still to do, still outstanding, or all they have left.');
  }
  return parts.join(' ');
}
