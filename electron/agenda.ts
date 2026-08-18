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
 * What she should have in front of her — and nothing that is finished.
 *
 * A completed task used to be held here for a couple of days so she could say
 * "you did that yesterday". Measured against her own model, eight runs an arm,
 * that turned out to cost far more than it bought: with a finished task on the
 * list she opened on it 8 times out of 8, and with none she opened on what was
 * actually outstanding 8 times out of 8. Reordering the list did not move it.
 * Telling her outright not to lead with one did not move it. The only thing
 * that moved it was the item not being there.
 *
 * She is not silent about finishing things: she still says her piece the moment
 * something is ticked off, and if they tell her in conversation the message is
 * right there in front of her. What she has lost is the ability to bring it up
 * again afterwards, which is the whole point.
 */
export function relevantItems<T extends AgendaItem>(items: T[], todayKey: string): T[] {
  const earliest = shiftDays(todayKey, -OVERDUE_WINDOW_DAYS);
  return items
    .filter(item => !item.done && (item.date >= todayKey || item.date >= earliest))
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
/**
 * One slip apart: a swap, a missing letter, an extra one, or a wrong one.
 *
 * People type "motehrboard" and mean the motherboard, and a list that only
 * answers to correct spelling makes them retype it or, worse, quietly does
 * nothing. The first three letters already forgive a typo that happens later in
 * the word — which is why the swap above still matched — but they forgive
 * nothing at the start, and they let "mot" agree with "motion".
 *
 * Only for words of six letters or more. At four, one letter apart is not a
 * typo, it is a different word: pick and pack, cake and lake, work and word.
 */
const LONG_ENOUGH_TO_MISTYPE = 6;

function oneSlipApart(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  if (long.length === short.length) {
    const differ: number[] = [];
    for (let i = 0; i < long.length; i++) if (long[i] !== short[i] && differ.push(i) > 2) return false;
    if (differ.length === 1) return true;
    // Two neighbours, each holding the other's letter: the transposition that
    // "motehrboard" actually is.
    return differ.length === 2
      && differ[1] === differ[0] + 1
      && long[differ[0]] === short[differ[1]]
      && long[differ[1]] === short[differ[0]];
  }
  // One letter too many on one side.
  let i = 0, j = 0, slips = 0;
  while (i < long.length && j < short.length) {
    if (long[i] === short[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    i++;
  }
  return true;
}

/**
 * How well a title's word was actually said, not merely whether it was.
 *
 * Three letters agreeing is weak evidence — "rent" and "rental", "mot" and
 * "motion" — while the whole word, or the whole word with one slip in it, is
 * strong. Keeping them apart is what lets a single word be enough sometimes and
 * never enough other times.
 */
type WordMatch = 'exact' | 'slip' | 'prefix' | null;

function howItMatches(word: string, asked: Set<string>): WordMatch {
  if (asked.has(word)) return 'exact';
  const root = word.slice(0, 3);
  let prefix = false;
  for (const spoken of asked) {
    if (word.length >= LONG_ENOUGH_TO_MISTYPE && spoken.length >= LONG_ENOUGH_TO_MISTYPE && oneSlipApart(word, spoken)) return 'slip';
    if (spoken.slice(0, 3) === root) prefix = true;
  }
  return prefix ? 'prefix' : null;
}

function sharesRoot(word: string, asked: Set<string>) {
  return howItMatches(word, asked) !== null;
}

/**
 * The part of a title that names the thing, before it says where.
 *
 * "Pick up motherboard from Umart Belmont" is five words worth matching on, and
 * three of them are the shop. Nobody reports a task back that way: they say they
 * picked up the motherboard. Scored against the whole title that is 0.40 and
 * falls under the bar, so telling her it was done did nothing — which is worse
 * than useless, because she then carried on chasing something already finished.
 *
 * The head is only used when it leaves enough to be sure of. "Go to work" must
 * not become "go".
 */
const WHERE_IT_HAPPENS = /\s+\b(?:from|at|in)\b\s+/i;

function significant(text: string) {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2));
}

function headOf(title: string): string | null {
  const cut = title.search(WHERE_IT_HAPPENS);
  if (cut <= 0) return null;
  const head = title.slice(0, cut);
  return significant(head).size >= 2 ? head : null;
}

export function findItem<T extends AgendaItem>(items: T[], phrase: string): T | null {
  const asked = significant(phrase);
  if (!asked.size) return null;

  // How ordinary each word is across the list they actually have. "pick" is on
  // two of their tasks and means almost nothing on its own; "motherboard" is on
  // one and settles it. Counting rather than guessing means the judgement
  // follows their own list instead of a table of words someone chose here — and
  // it is what separates "got the motherboard", which should tick that off on
  // one word, from "I picked up Sam", which should not tick off anything.
  const spread = new Map<string, number>();
  for (const item of items) for (const word of significant(item.title)) spread.set(word, (spread.get(word) ?? 0) + 1);
  const tellsThemApart = (word: string) => (spread.get(word) ?? 0) <= 1;

  let best: { item: T; overlap: number; rank: number } | null = null;
  for (const item of items) {
    const words = significant(item.title);
    if (!words.size) continue;
    // Half a word is worth half a word. Three letters agreeing is a hint, not a
    // sighting, and counting it the same as the whole word is what let "I paid
    // the rent" close a rental inspection and "I picked up Sam" close the
    // motherboard — both on a single three-letter stub, in a two-word title
    // where one word is already half the score.
    const weigh = (word: string) => { const how = howItMatches(word, asked); return how === null ? 0 : how === 'prefix' ? 0.5 : 1; };
    const sharedWords = [...words].filter(word => sharesRoot(word, asked));
    const shared = sharedWords.length;
    if (!shared) continue;
    // One word is enough only when that word belongs to this task and no other.
    if (shared < 2 && !sharedWords.some(tellsThemApart)) continue;
    // Scored both ways round, best wins: against everything the title says, and
    // against just the part that names the thing.
    const weight = [...words].reduce((sum, word) => sum + weigh(word), 0);
    const head = headOf(item.title);
    const headWords = head ? significant(head) : null;
    const headOverlap = headWords ? [...headWords].reduce((sum, word) => sum + weigh(word), 0) / headWords.size : 0;
    // A long, uncommon word said in full carries the whole thing on its own.
    // "Get TV power connector" is three words worth matching, so "I bought the
    // connector" scores 0.33 and fails — while naming the one word that belongs
    // to no other task on the list. The word has to be said properly for this:
    // three letters agreeing would let "I paid the rent" close out a rental
    // inspection.
    const namesItOutright = sharedWords.some(word =>
      word.length >= LONG_ENOUGH_TO_MISTYPE
      && tellsThemApart(word)
      && howItMatches(word, asked) !== 'prefix');
    const overlap = namesItOutright ? 1 : Math.max(weight / words.size, headOverlap);
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
/**
 * The words people finish things with — and, said after a "haven't", the exact
 * same words people use to say they have not.
 *
 * Kept in one place because the two halves have drifted apart every single time.
 * "found" was added to the done list and not to the denial list, so "I've found
 * it" and "I haven't found it yet" both read as a report. Whichever half gets
 * patched next, the other half now moves with it.
 */
const FINISHED = 'did|done|took|taken|got|had|been|made|managed|picked|collected|grabbed|bought|fetched|found|sourced|nabbed|snagged|sorted|handled|finished|completed|returned|dropped|met|paid|called|rang|sent|posted|booked|emailed|texted|went';
/** The same verbs unconjugated, which is the form a denial puts them in. */
const TO_FINISH = 'get|do|make|manage|have time|pick|collect|grab|buy|fetch|find|source|sort|handle|finish|complete|return|drop|meet|pay|call|send|post|book|go';

// The contraction has no space in it — "I've taken" is one token where "I have
// taken" is two, and a pattern expecting "i " misses every contracted form,
// which is most of how anyone actually types.
// The verbs people actually finish things with. "picked up" was missing, which
// is how "I picked up the motherboard yes" read as no report at all: she
// congratulated them on it in the same breath as leaving it open, because the
// sentence reached the model but never reached the list.
const READS_AS_DONE = /\b(i(?:'ve| have| already)?\s+(?:just\s+|already\s+)?(?:did|done|took|taken|finished|sorted|handled|posted|sent|paid|booked|called|rang|emailed|texted|got|picked|collected|grabbed|bought|fetched|returned|completed|dropped|met|went|found|sourced|nabbed|snagged)\b|(?:picked|dropped) (?:it|that|them|those) (?:up|off)\b|\b(?:picked|collected|grabbed|bought|fetched|dropped)\s+(?:it\s+)?(?:up|off)?\s*(?:the|a|my|that|those|them)\b|(?:did|done|sorted|handled|finished) (?:it|that|them|those)\b|(?:it|that|they|those)(?:'s| is| are| was| were) (?:done|sorted|handled|finished)\b|all (?:done|sorted)\b|already (?:did|done|took|taken|picked)\b)/i;

// An answer with no sentence around it: "yes, picked up!", "yep, done". Anchored
// to the start on purpose, so it cannot fire inside "I need to get it picked up"
// — the loose reading of a completion belongs in the prompt below, where a model
// with the whole conversation decides, not in code acting on its own.
const READS_AS_DONE_BARE = /^\s*(?:(?:yes|yep|yeah|yup|ok|okay|aye)\b[,!.\s]*)?(?:picked|got|done|sorted|finished|collected|grabbed|bought|fetched|found)\b/i;

/**
 * A message is rarely all one thing. "I couldn't find it in store! I did
 * however pick up the motherboard" denies one task and reports another in the
 * same breath, and asking whether the whole message is a denial gets the wrong
 * answer for both halves at once — the failure at the front hid the report
 * behind it, and the task stayed open.
 *
 * Split on sentence ends and on "but", because the pivot is where the subject
 * changes. Then each half is read for what it actually says.
 */
function clausesOf(text: string): string[] {
  return text.split(/[.!?;]+|,?\s+\bbut\b/i).map(part => part.trim()).filter(Boolean);
}

/**
 * The part of a message that reports something finished, if any part does.
 *
 * Worth having on its own because whatever was finished is named in the clause
 * that says it was finished, and nowhere else. "I haven't got it but I did try"
 * keeps its only pronoun in the half that failed; read as one message, that "it"
 * stood in for the half that succeeded and ticked off the wrong task entirely.
 * Handing back just the reporting clause stops the two halves borrowing each
 * other's meaning.
 */
export function doneClause(text: string): string | null {
  const clauses = clausesOf(text);
  for (let i = 0; i < clauses.length; i++) {
    // A denial carries most of the same words, so it is asked first.
    if (readsAsNotDone(clauses[i])) continue;
    if (READS_AS_DONE.test(clauses[i]) || (i === 0 && READS_AS_DONE_BARE.test(clauses[i]))) return clauses[i];
  }
  return null;
}

export function readsAsDone(text: string) {
  return doneClause(text) !== null;
}

/**
 * An answer that names nothing because it does not need to.
 *
 * "yes, picked up!" has no pronoun to follow and no noun to match, which left it
 * falling through every path at once: nothing to find, nothing to resolve. But
 * naming nothing is itself the signal — it is an answer to a question, and the
 * question was hers. Anchored to the start, so it stays an answer rather than a
 * clause somewhere inside a longer sentence about something else.
 */
export function readsAsBareReport(text: string) {
  return !readsAsNotDone(text) && READS_AS_DONE_BARE.test(text);
}

/**
 * Telling her that ticking things off is her job too.
 *
 * The pattern above has now been widened four times for four ways of saying the
 * same thing — "I did however pick up", "I picked up the motherboard", "ive
 * picked it up", "yes, picked up!" — and a fifth is always available, because
 * this is language and not a form. Each widening also makes a false tick more
 * likely, and a false tick writes to their list.
 *
 * She has had complete_kept_item the whole time and did not reach for it, which
 * is not surprising: nothing ever asked her to, and the code quietly doing it
 * first meant the tool had no visible reason to exist. So the code keeps the
 * cases it is sure of, and she is told to handle the rest — she has the
 * conversation in front of her, which is the thing a regular expression will
 * never have, and can tell "yes, picked up!" from "I need to get it picked up".
 *
 * Deliberately generous about when to say this. Being reminded she can tick
 * something off costs a sentence in a prompt; not being reminded costs a task
 * that stays on the list while she keeps shouting about it.
 */
const MIGHT_BE_A_REPORT = /\b(done|did|got|picked|collected|grabbed|bought|fetched|sorted|finished|handled|completed|dropped|took|taken|paid|called|sent|posted|been|yes|yep|yeah|yup)\b/i;

/**
 * Asking her to do something about a task is not telling her it is done.
 *
 * Naming an open task is now enough on its own to raise the question, which is
 * the point — but "remind me about the power connector tomorrow" names one
 * while plainly meaning the opposite, so that one shape is ruled out here. Only
 * when the message is nothing but a request: "I got the milk, and remind me
 * about the dentist" is still a report.
 */
const ASKS_HER_TO = /^\s*(?:hey\s+haru[,!.\s]*)?(?:please\s+|can you\s+|could you\s+)?(?:remind|add|put|schedule|book|set|move|push|change)\b|\b(?:remind me|don'?t forget)\b/i;

export function tickOffInstruction(latestMessage: string, anythingOpen: boolean, namedTask?: string | null): string {
  if (!anythingOpen || readsAsNotDone(latestMessage)) return '';
  // Relevance first, vocabulary second.
  //
  // The word list has now been short six times — "I did however pick up", "ive
  // picked it up", "yes, picked up!", "yes omg! I did get it", and finally "I've
  // already found the power connector", where the missing word was "found". A
  // seventh is always available, because this is language.
  //
  // But naming one of their open tasks is not language, it is a fact, and it is
  // the fact that matters: if they have brought up something on their list at
  // all, she is the one who should work out whether it is done. The word list
  // stays as a second way in, for the times they report something without
  // naming it.
  if (!namedTask && !MIGHT_BE_A_REPORT.test(latestMessage)) return '';
  if (ASKS_HER_TO.test(latestMessage) && !readsAsDone(latestMessage)) return '';
  return [
    namedTask
      ? `They have just mentioned "${namedTask}", which is on their list and not ticked off. If what they said means it is done, tick it off with complete_kept_item before you answer.`
      : 'If they have just told you something on their list is done, tick it off with complete_kept_item before you answer.',
    'They will not usually name it or say it in full — "yes, picked up", "yeah did that", "got it" all count.',
    'If it is not obvious which one they mean, it is the one you last asked them about.',
    'Do not tick anything off if they are saying they have not done it, or are about to.',
  ].join(' ');
}

/**
 * Whether a message is saying something has NOT been done. Cancelled and
 * not-yet-done are opposite states, and the model conflates them: told "I never
 * did get the milk" it reached for delete every time, wording the tool
 * description could not talk it out of. Deleting there loses work the user still
 * has to do, so it is refused in code rather than discouraged in prose.
 */
export function readsAsNotDone(text: string) {
  return new RegExp(
    '(?:'
      // "never got round to it", "haven't found it", "didn't manage to pick it up"
      + String.raw`(?:never|haven'?t|have not|hadn'?t|had not|didn'?t|did not|couldn'?t|could not|not)\s+(?:yet\s+|even\s+|really\s+|been able to\s+|managed to\s+|had (?:the )?(?:time|chance) to\s+)?(?:${FINISHED}|${TO_FINISH})\b`
      + '|not done|still (?:need|have|meant|got) to|forgot to|no time to|missed (?:it|the)|forgot about'
    + ')', 'i').test(text);
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

/**
 * When they will get to it, if they have just said.
 *
 * "I'm home now so I have to check tomorrow" is not a completion and not a
 * refusal — it is a new date, offered in passing. Nothing read it that way, so
 * the task sat on today being chased into the evening while both of them already
 * knew it was a tomorrow job.
 *
 * Deliberately not written to the list here. Ticking something off is one bit
 * and reversible in a click; moving a date means guessing which of several tasks
 * they meant from a sentence that often names none of them, and being wrong
 * quietly rewrites something they still have to do. She has update_kept_item and
 * she can see the conversation — this only makes sure she notices.
 */
// Written out in full when it stands alone, abbreviated only after a word that
// makes it a date: "sat" and "sun" are ordinary English otherwise, and "I sat
// down" is not a reschedule.
const WHEN_INSTEAD = /\b(tomorrow|tonight|later|next week|this weekend|another day|after work|in the morning|(?:on|until|till|by)\s+(?:mon|tues?|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)(?:day)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
// "move it" and "push it" were too literal by half: "Move the task to tomorrow"
// is about as plain as an instruction gets and matched none of it, because the
// object was a noun rather than a pronoun. The verbs are enough on their own —
// a day has to be named as well before any of this counts.
const PUTTING_IT_OFF = /\b(?:have to|has to|need to|i'?ll|i will|going to|gonna|can'?t|cannot|couldn'?t|won'?t|not (?:until|till)|push\w*|mov\w*|shift\w*|bump\w*|resched\w*|postpon\w*|put (?:it|that|them) off)\b/i;

export function putOffUntil(latestMessage: string): string | null {
  // "I did it tomorrow" is not a sentence anyone says; a completion wins.
  if (readsAsDone(latestMessage)) return null;
  if (!PUTTING_IT_OFF.test(latestMessage)) return null;
  return latestMessage.match(WHEN_INSTEAD)?.[0].toLowerCase() ?? null;
}

export function putOffInstruction(latestMessage: string): string {
  const when = putOffUntil(latestMessage);
  if (!when) return '';
  return [
    `They have just said they will not get to something until ${when}.`,
    'If it is one of the tasks already on their list, move it to that day with update_kept_item rather than adding a second one, and tell them you have moved it.',
    'Have an opinion about it being pushed — you are not a calendar politely accepting a change — but move it anyway.',
    'If you cannot tell which task they mean, ask which one instead of guessing.',
  ].join(' ');
}

/**
 * How many days between two date keys, counted on the calendar rather than the
 * clock, so daylight saving cannot make a day 23 hours long and lose one.
 */
function daysBetween(fromKey: string, toKey: string) {
  const at = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((at(toKey) - at(fromKey)) / 86_400_000);
}

/**
 * A weekday name on its own is only useful to someone who knows what day it is
 * today, and she was not always told. Handed "Rental Inspection (Thursday)" at
 * 11pm on a Tuesday she announced it was tomorrow, then said Saturday, and had
 * to be corrected twice — the day was right in front of her and the arithmetic
 * was not.
 *
 * So the distance is spelled out for anything within the fortnight. Today,
 * tomorrow and yesterday already say it in a word and are left alone.
 */
export function relativeDay(dateKey: string, todayKey: string, weekday: Intl.DateTimeFormat) {
  if (dateKey === todayKey) return 'today';
  if (dateKey === shiftDays(todayKey, 1)) return 'tomorrow';
  if (dateKey === shiftDays(todayKey, -1)) return 'yesterday';
  const [year, month, day] = dateKey.split('-').map(Number);
  const when = new Date(year, month - 1, day);
  const name = weekday.format(when);
  const away = daysBetween(todayKey, dateKey);
  if (away > 1 && away <= 14) return `${name}, ${away} days from now`;
  if (away < -1 && away >= -14) return `last ${name}, ${-away} days ago`;
  return dateKey < todayKey ? `last ${name}` : name;
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
    const mark = status === 'overdue' ? (worthChasing(item, todayKey)
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
  return parts.join(' ');
}
