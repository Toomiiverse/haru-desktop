// What a memory is, finer than its kind.
//
// `kind` has four values — preference, relationship, event, fact — and they
// were asked to carry too much. "Reply length: as much as she wants" and
// "Prefers dark mode" are both preferences, but one is how she should behave
// and the other is his taste. "Is the founder of The PC Project" and "Is
// halfway through building Logan's PC" are both facts, but one is true for
// years and the other is over by Friday. "Pick up the motherboard from Umart"
// and "Replaced a faulty RAM stick" are both events, but one is still ahead.
// Each pair wants handling the other does not: shown every turn or only when
// it comes up, kept for good or let go, dated forward or back.
//
// The category is written by the model that sorts new memories (a batch job,
// see memorystore.ts), not by whatever happened to save them. Until it has
// been sorted a record falls back to guessCategory, which reads the kind and
// the wording. `kind` stays, and is kept consistent with the category through
// LEGACY_KIND, because the desk runs older code that only knows the four kinds
// and a record it cannot place would be read as a fact.

import type { MemoryKind, MemoryRecord } from './memory';

export const CATEGORIES = ['identity', 'person', 'preference', 'instruction', 'plan', 'event', 'ongoing', 'shared', 'knowledge', 'passing'] as const;
export type Category = typeof CATEGORIES[number];

/**
 * What each category means, said once: the sorting prompt reads these lines
 * and so does anyone reading the code. Worded as the test a note has to pass,
 * because that is what the model applies.
 */
export const CATEGORY_MEANING: Record<Category, string> = {
  identity: 'a lasting fact about them or their own things: work and jobs, study, health, where and how they live, their business and how it runs, money, what they own or use, a habit that is part of who they are',
  person: 'someone in their life, or a pet, and who that is to them — family, partner, friends, colleagues, customers they know by name',
  preference: 'their own taste: what they like, dislike, love, hate, rate or would rather have — about anything except how Haru behaves',
  instruction: 'how they want Haru to treat them, talk to them or behave: a rule, a request, something they asked her to do for them regularly, or a permission or setting they gave her — how long she may talk, what she may bring up, when she may interrupt',
  plan: 'something still ahead of them: an appointment, a pickup, a deadline, a trip, something they intend, promised or decided to do and have not done yet',
  event: 'something that happened on a particular day: something they did, went to, bought, fixed, finished or decided, or that happened to them',
  ongoing: 'something they are in the middle of that will change or end: a project, a build, a show or book partway through, a situation still running',
  shared: 'something between them and Haru: a running joke, a moment the two of them had, a house rule of theirs, a promise or bet between them',
  knowledge: 'something about the world, a product, a place or other people\'s things that they told Haru or corrected her on, not about themselves',
  passing: 'not worth keeping: a line in Haru\'s own voice, a to-do Haru wrote for herself, or her own life and opinions; Haru\'s judgement of them; a small action at the computer (opened or closed an app, changed an icon, took a screenshot, set an option); a passing mood or state; small talk; how often something comes up; a note about the conversation itself; several unrelated notes welded into one',
};

/**
 * The four-kind view of each category, for everything that still reads `kind`
 * — pruning, decay, the vault page, and the desk's older copy of this code.
 * `passing` keeps whatever kind it had: it is never shown, and relabelling a
 * record nobody will see would only churn the sync.
 */
export const LEGACY_KIND: Record<Exclude<Category, 'passing'>, MemoryKind> = {
  identity: 'fact',
  person: 'relationship',
  preference: 'preference',
  instruction: 'preference',
  plan: 'event',
  event: 'event',
  ongoing: 'fact',
  shared: 'fact',
  knowledge: 'fact',
};

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/** A calendar day as written on a record: YYYY-MM-DD and nothing else. */
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

// Wording that says which way a record points when nothing sorted it. Only a
// fallback: these are the easy cases, and the model does the rest.
const ABOUT_HARU = /\b(haru|she|her|you|your)\b/i;
const AHEAD = /\b(will|going to|plans? to|planning|intends?|scheduled|appointment|due|deadline|pick(ing)? up|tomorrow|next (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (saturday|sunday|weekend)|considering|wants to (buy|get|build))\b/i;
const UNDER_WAY = /\b(currently|is (working on|building|creating|designing|reading|watching|rewatching|rereading|playing|saving)|are (working on|building|creating|designing|reading|watching|rewatching|rereading|playing|saving)|halfway|in the middle of)\b/i;

/**
 * The category a record has not been sorted into yet, read from its kind and
 * its wording. Conservative on purpose: when in doubt it says what the kind
 * already said, so an unsorted record behaves the way it always did.
 */
export function guessCategory(record: Pick<MemoryRecord, 'kind' | 'text' | 'subject'>): Category {
  const text = record.text ?? '';
  switch (record.kind) {
    case 'relationship': return 'person';
    case 'preference': return ABOUT_HARU.test(text) || /^\s*(don'?t|do not|never|always|check|keep|remind|reply|topics|reminders|she can)\b/i.test(text) ? 'instruction' : 'preference';
    case 'event': return AHEAD.test(text) ? 'plan' : UNDER_WAY.test(text) ? 'ongoing' : 'event';
    default: return UNDER_WAY.test(text) ? 'ongoing' : AHEAD.test(text) ? 'plan' : 'identity';
  }
}

/** An undated plan not raised again in this long has happened or fallen through. */
export const UNDATED_PLAN_DAYS = 14;

/**
 * The category as it stands: sorted if it has been, guessed if not — and a plan
 * whose day has gone is an event now. Worked out at read time rather than
 * rewritten, so nothing has to run at midnight for "the psychologist on
 * Friday" to stop being ahead of him on Saturday. A day of grace, so a plan for
 * today is still a plan whichever side of UTC midnight the clock is on.
 */
export function categoryOf(record: Pick<MemoryRecord, 'kind' | 'text' | 'subject' | 'lastSeenAt'> & { category?: Category; when?: string }, now?: Date): Category {
  const category = isCategory(record.category) ? record.category : guessCategory(record);
  if (category !== 'plan' || !now) return category;
  if (isDay(record.when)) return Date.parse(`${record.when}T00:00:00Z`) < now.getTime() - 2 * 86_400_000 ? 'event' : 'plan';
  const seen = Date.parse(record.lastSeenAt);
  return Number.isFinite(seen) && now.getTime() - seen > UNDATED_PLAN_DAYS * 86_400_000 ? 'event' : 'plan';
}

// Who someone in his life can be called, when no name is given.
const RELATION = /\b(mum|mom|mother|dad|father|parents?|sisters?|brothers?|siblings?|girlfriend|boyfriend|partner|wife|husband|fianc[eé]e?|friends?|mates?|cat|dog|pets?|puppy|kitten|step-?(father|mother|dad|mum|mom)|aunt|uncle|cousins?|nan|nana|grandma|grandpa|grandmother|grandfather|boss|manager|colleagues?|co-?workers?|customers?|clients?|flatmates?|roommates?|neighbou?rs?|psychologist|doctor|therapist|teacher)\b/i;
// Capitalised words that open a note or a clause without naming anyone.
const NOT_A_NAME = new Set(['they', 'their', 'them', 'the', 'this', 'that', 'these', 'he', 'she', 'his', 'her', 'is', 'has', 'had', 'was', 'are', 'were', 'likes', 'loves', 'hates', 'prefers', 'wants', 'does', 'doesn', 'don', 'did', 'went', 'got', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'and', 'but', 'haru', 'also', 'currently', 'lives', 'live', 'works', 'plans', 'decided']);

/**
 * Whether a note names somebody other than the user — by name, or by who they
 * are to him. A person record that does not is a note about him: "Tommy
 * complained about build failing issues" came back from the sorter as a person,
 * and people are shown on every turn (2026-09-17).
 */
export function namesSomeoneElse(text: string, userName = ''): boolean {
  if (RELATION.test(text)) return true;
  const user = userName.trim().toLowerCase();
  return (text.match(/\b[A-Z][a-z]+(?:['’]s)?\b/g) ?? [])
    .map(word => word.replace(/['’]s$/, '').toLowerCase())
    .some(word => word.length >= 3 && word !== user && !NOT_A_NAME.has(word));
}

// -- sorting ------------------------------------------------------------------

/** How many notes go to the model at once: enough to be worth the call, few
 *  enough that a long batch does not lose count of its numbers. */
export const SORT_BATCH = 20;

export type SortNote = { id: string; text: string; kind: MemoryKind; subject?: string; createdAt: string };
export type Sorted = { category: Category; when?: string };

export function sortPrompt(userName = ''): string {
  const name = userName.trim();
  return [
    'You sort the notes Haru keeps about the user she lives with into exactly one category each.',
    ...(name ? [`The user is ${name}: a note about ${name} is a note about them, never a person in their life.`] : []),
    '',
    ...CATEGORIES.map(category => `${category} — ${CATEGORY_MEANING[category]}.`),
    '',
    'Judge what the note is about, not the words it uses: "Wants 6 mailboxes for the shop" is a plan; "Likes to be called Tommy" is an instruction; "Johnny is their stepfather" is a person.',
    'The notes are written to Haru, so "you" in a note is Haru: "They woke you up at 3 am" is still about them and the two of them. A note that is Haru talking to them ("Now stop asking pointless questions") is passing.',
    'When a note mixes two things, pick the one that would matter most a month from now.',
    '',
    'More examples of the harder ones:',
    '"Works 9 to 5 at the cinema this Saturday" — plan: one day\'s hours, not their job. "Works at the cinema on weekends" — identity.',
    '"Is stressed about rent this week" — passing: a mood. "Is saving for a house deposit" — ongoing.',
    '"Turned on dark mode in the settings" — passing: a click. "Prefers dark mode" — preference.',
    '"Decided to sell the old monitor" — plan until it is done. "Sold the old monitor to a friend" — event. "Decided on a 27-inch monitor" or "Finished a budget plan for the build" — event: the choosing or the planning is what happened.',
    '"Linda is their mum" — person. "Visited their mum after work" — event.',
    '',
    'For a plan or an event also give WHEN: the calendar day it is or was, as YYYY-MM-DD. Each note says the day it was written, so "tomorrow", "next Friday" or "on Thursday" can be worked out from that. Use - when no single day can be worked out, and for every other category.',
    '',
    'Answer with one line per note, in the order given, exactly in this shape and nothing else:',
    '<number> | <category> | <when>',
  ].join('\n');
}

const WEEKDAY = new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: 'UTC' });

/** The notes as the model reads them, each with the day it was written. */
export function sortInput(notes: SortNote[], dayOf: (iso: string) => string): string {
  return notes.map((note, index) => {
    const day = dayOf(note.createdAt);
    const weekday = isDay(day) ? `${WEEKDAY.format(new Date(`${day}T00:00:00Z`))} ` : '';
    const about = note.subject ? ` [about: ${note.subject}]` : '';
    return `${index + 1}. (written ${weekday}${day})${about} ${note.text.replace(/\s+/g, ' ').trim()}`;
  }).join('\n');
}

/**
 * The model's answer, read strictly: a line that does not parse, names a
 * category that does not exist or a note that was not asked about is left out,
 * and that note stays unsorted for the next batch rather than guessed at.
 */
export function readSorting(answer: string, notes: SortNote[]): Map<string, Sorted> {
  const out = new Map<string, Sorted>();
  for (const line of String(answer ?? '').split('\n')) {
    const match = line.trim().replace(/^[-*]\s*/, '').match(/^(\d+)\s*[.|:)]\s*\|?\s*([a-z]+)\s*(?:\|\s*(\S+))?/i);
    if (!match) continue;
    const note = notes[Number(match[1]) - 1];
    const category = match[2].toLowerCase();
    if (!note || !isCategory(category) || out.has(note.id)) continue;
    const when = (category === 'plan' || category === 'event') && isDay(match[3]) ? match[3] : undefined;
    out.set(note.id, when ? { category, when } : { category });
  }
  return out;
}
