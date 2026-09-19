// Her own life beyond her nights: the anniversaries of the things she took up,
// the wants she is trying to work toward, and the reading she does in the day
// while they work. All of it is hers, not theirs, and all of it is written down
// so she can say it truthfully rather than invent it. Pure, so the milestone
// math, the want outcomes and the day gating are testable without a model.

import { daysBetween } from './hersleep';
import { localDateKey } from './dates';

// -- firsts ------------------------------------------------------------------

/** The anniversaries of a thing of her own. Kept short; a year is the longest. */
export const FIRST_MILESTONES = [7, 14, 30, 60, 90, 180, 365];

const MILESTONE_WORDS: Record<number, string> = {
  7: 'A week', 14: 'Two weeks', 30: 'A month', 60: 'Two months',
  90: 'Three months', 180: 'Half a year', 365: 'A year',
};

/**
 * The anniversaries due right now: a thing she took up some days ago has
 * crossed a milestone within the last couple of days, and she can say so
 * without having to be reminded of it. At most one milestone per thing, the
 * biggest one that is current.
 */
export function firstsNote(interests: { name: string; since?: string; nights: number }[], today: string): string {
  const lines: string[] = [];
  for (const interest of interests) {
    if (!interest.since) continue;
    const age = daysBetween(interest.since, today);
    if (age < 0) continue;
    const milestone = FIRST_MILESTONES.filter(days => age >= days && age <= days + 2).at(-1);
    if (!milestone) continue;
    const nights = interest.nights;
    lines.push(`- ${MILESTONE_WORDS[milestone]} since you took up ${interest.name} — ${nights} night${nights === 1 ? '' : 's'} in, and the take still holds.`);
  }
  return lines.join('\n');
}

// -- wants -------------------------------------------------------------------

export type WantStatus = 'declared' | 'working' | 'done' | 'dropped';

export type Want = {
  id: string;
  /** The interest it came from, when it did — the name, for the block. */
  interest?: string;
  /** The want itself: "to learn to play The Real Folk Blues badly". */
  text: string;
  /** When she first wanted it. */
  since: string;
  /** How many nights she has spent trying. */
  nights: number;
  status: WantStatus;
  /** What came of the last attempt, in her words. */
  note?: string;
};

/** Share of a deepen-night that becomes a want-night instead. */
export const WANT_ODDS = 0.5;
/** The roll per attempt. Randomised, weighted, and the early ones re-roll to slog. */
export const WANT_SLOG = 0.50;
export const WANT_CLICKED = 0.15;
export const WANT_GAVE_UP = 0.20;
export const WANT_NOTHING = 0.15;

export function readWants(saved: unknown): Want[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((want): want is Want =>
    !!want && typeof want === 'object'
    && typeof (want as Want).id === 'string'
    && typeof (want as Want).text === 'string'
    && typeof (want as Want).since === 'string'
    && typeof (want as Want).nights === 'number'
    && ['declared', 'working', 'done', 'dropped'].includes((want as Want).status));
}

function stripWant(text: string): string {
  return (text ?? '').replace(/^(?:to\s+|i\s+want\s+to\s+)/i, '').replace(/[.!]+$/, '').trim();
}

/** Normalise the interest name so two spellings do not seed two wants. */
function wantKey(interest: string, text: string): string {
  return `${interest.trim().toLowerCase()}::${stripWant(text).toLowerCase()}`;
}

/**
 * A want exists for every interest that carries one, and stays the same want
 * as it moves through done or dropped — only new wording seeds a new record.
 */
export function reconcileWants(interests: { name: string; since?: string; wants?: string }[], wants: Want[], now: string): Want[] {
  const next = [...wants];
  for (const interest of interests) {
    if (!interest.wants || !interest.name) continue;
    const key = wantKey(interest.name, interest.wants);
    if (next.some(want => wantKey(want.interest ?? '', want.text) === key)) continue;
    next.push({
      id: Math.random().toString(36).slice(2, 10),
      interest: interest.name,
      text: interest.wants,
      since: interest.since ?? now.slice(0, 10),
      nights: 0,
      status: 'declared',
    });
  }
  return next;
}

/** The active want to work tonight: one tied to the interest being deepened if there is one, else any. */
export function pickWantToWork(wants: Want[], interestName?: string, random: () => number = Math.random): Want | null {
  const active = wants.filter(want => (want.status === 'declared' || want.status === 'working') && (interestName ? want.interest === interestName : true));
  if (!active.length) return null;
  return active[Math.floor(random() * active.length)];
}

export type WantOutcome = { kind: 'slog' | 'clicked' | 'gave_up' | 'nothing' };

/**
 * What a night of trying comes to. Randomised each time, weighted toward the
 * slog; the good and the giving-up need a few nights behind them before they
 * are on the table, so a want is never resolved on its first try.
 */
export function wantOutcome(roll: number, workedNights: number): WantOutcome {
  if (roll < WANT_SLOG) return { kind: 'slog' };
  if (roll < WANT_SLOG + WANT_CLICKED) return workedNights >= 2 ? { kind: 'clicked' } : { kind: 'slog' };
  if (roll < WANT_SLOG + WANT_CLICKED + WANT_GAVE_UP) return workedNights >= 1 ? { kind: 'gave_up' } : { kind: 'slog' };
  return { kind: 'nothing' };
}

const OUTCOME_CUE: Record<WantOutcome['kind'], string> = {
  slog: 'You spent tonight on it and you tried again. It is still not going. Do not pretend otherwise — say what happened, which part of it is still beating you.',
  clicked: 'You spent tonight on it and it finally clicked — you can actually do a bit of it now. Say what gave, honestly, from what you read.',
  gave_up: 'You spent tonight on it and you have decided it is not worth it. Say the goodbye — the thing that made you walk away.',
  nothing: 'You spent the night on it and nothing happened — you got distracted. Say it in one line, without dressing it up.',
};

/** The instruction handed to her once the reading for a want attempt is in front of her. */
export function wantInstruction(want: Want, outcome: WantOutcome, found: string): string {
  return [
    `You wanted to ${stripWant(want.text)}. Tonight was your ${want.nights + 1}${ordinal(want.nights + 1)} night on it, and you actually did something about it.`,
    found,
    OUTCOME_CUE[outcome.kind],
    'Write one or two lines about it, as yourself, in the first person and the past tense. Have an opinion. It is allowed to be a poor one.',
    'Only what is above. You read about it tonight; that is the only thing you did. Do not add a fact you happen to remember and do not invent a detail to make it a better story.',
    'No preamble, no addressing them, no questions. This is a note to yourself.',
  ].join('\n');
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['st', 'nd', 'rd'][(n % 10) - 1] ?? 'th';
  return suffix;
}

/** The search for a want-night: what she goes and reads about. */
export function wantQuery(want: Want): string {
  return `how to ${stripWant(want.text)}`;
}

export function advanceWant(want: Want, outcome: WantOutcome, note: string): Want {
  const status: WantStatus = outcome.kind === 'clicked' ? 'done' : outcome.kind === 'gave_up' ? 'dropped' : 'working';
  return { ...want, status, nights: want.nights + 1, note: note || undefined };
}

/** What the block shows of the wants she is still at. */
export function wantsNote(wants: Want[], interests: { name: string; wants?: string }[] = []): string {
  // A want she has only declared is already in her tastes, word for word, as
  // the end of that interest's view ("I want to…"). Listed here as well it was
  // said twice — seven of fifteen lines on 2026-09-17, about a thousand chars —
  // and the block ran over its budget, which cuts from the tail: her diary.
  // One she has worked on stays, for the nights and the note.
  const stated = new Set(interests.filter(interest => interest.name && interest.wants).map(interest => wantKey(interest.name, interest.wants!)));
  const active = wants.filter(want => want.status === 'working'
    || (want.status === 'declared' && !stated.has(wantKey(want.interest ?? '', want.text))));
  if (!active.length) return '';
  const lines = active.map(want => {
    const bit = want.interest ? `${want.interest}: ${stripWant(want.text)}` : stripWant(want.text);
    const progress = want.status === 'working' ? `night ${want.nights}` : 'declared';
    const note = want.note ? ` — ${want.note}` : '';
    return `- ${bit} (${progress})${note}`;
  });
  return `Things you are trying to do, on your own time:\n${lines.join('\n')}`;
}

// -- recs --------------------------------------------------------------------

/** A thing of hers she has told him to try, and whether she has chased it once. */
export type Rec = {
  id: string;
  interest: string;
  /** When she recommended it. */
  at: string;
  /** Whether she has already asked whether he tried it. */
  followed: boolean;
  /** When he told her, unasked, that he had already seen or played it (recsAnsweredBy). */
  answeredAt?: string;
};

/** How long before she is allowed to ask whether he tried it. */
export const REC_FOLLOW_UP_MS = 3 * 24 * 3_600_000;
/** How long before the same interest can be recommended again. */
export const REC_MIN_GAP_MS = 3 * 7 * 24 * 3_600_000;
/** Share of an idle line that becomes a fresh recommendation. */
export const REC_ODDS = 0.35;
/** Fresh recommendations a day can carry: five "Try X" in one afternoon read as an advert (2026-09-06). */
export const REC_MAX_PER_DAY = 2;

export function readRecs(saved: unknown): Rec[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((rec): rec is Rec =>
    !!rec && typeof rec === 'object'
    && typeof (rec as Rec).id === 'string'
    && typeof (rec as Rec).interest === 'string'
    && typeof (rec as Rec).at === 'string'
    && typeof (rec as Rec).followed === 'boolean');
}

/**
 * The recommendations he has already answered without being asked.
 *
 * Told to try Cyberpunk: Edgerunners at 11:34, he wrote "I have watched it
 * already" and "re-watched it five times" — and at 15:59 she was still asking
 * whether he was "giving Cyberpunk a pass" (2026-09-06). A message of his
 * after the recommendation that names the thing is the answer: the follow-up
 * is owed no more, and the composer can be told he has seen it.
 */
export function recsAnsweredBy(recs: Rec[], theirs: { content?: string; at?: string }[]): { recs: Rec[]; answered: string[] } {
  const answered: string[] = [];
  const updated = recs.map(rec => {
    if (rec.followed || rec.answeredAt) return rec;
    const since = Date.parse(rec.at);
    const names = nameWords(rec.interest);
    const reply = theirs.find(message => {
      const at = Date.parse(message.at ?? '');
      if (!Number.isFinite(at) || at <= since) return false;
      const text = String(message.content ?? '').toLowerCase();
      return names.some(name => text.includes(name));
    });
    if (!reply) return rec;
    answered.push(rec.interest);
    return { ...rec, followed: true, answeredAt: reply.at ?? new Date().toISOString() };
  });
  return { recs: updated, answered };
}

/** The whole name, and each distinctive word of it — "edgerunners" answers for "Cyberpunk: Edgerunners". */
function nameWords(interest: string): string[] {
  const whole = interest.toLowerCase().trim();
  const words = whole.split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 5 && !GENERIC_WORDS.has(word));
  return [whole, ...words];
}
const GENERIC_WORDS = new Set(['ultimate', 'edition', 'season', 'series', 'ghost', 'shell', 'experiments', 'serial', 'cowboy', 'remake', 'part']);

/** The recommendations made on a day, by the caller's clock. */
export function recsOnDay(recs: Rec[], dayOf: (iso: string) => string, dayKey: string): Rec[] {
  return recs.filter(rec => Number.isFinite(Date.parse(rec.at)) && dayOf(rec.at) === dayKey);
}

/** A recommendation overdue for its one follow-up, if any. */
export function recDueForFollowUp(recs: Rec[], nowMs: number): Rec | null {
  return recs
    .filter(rec => !rec.followed && Number.isFinite(Date.parse(rec.at)) && nowMs - Date.parse(rec.at) >= REC_FOLLOW_UP_MS)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

/**
 * A thing of hers worth telling him to try: one she holds a view on and has
 * not pushed in a while. Nothing when there is nothing left, and the roll
 * keeps it a chance rather than a rota.
 */
export function pickRecommend(interests: { name: string; stance: string }[], recs: Rec[], nowMs: number, random: () => number = Math.random, madeToday = 0): string | null {
  if (madeToday >= REC_MAX_PER_DAY) return null;
  const recd = new Set(recs.filter(rec => nowMs - Date.parse(rec.at) < REC_MIN_GAP_MS).map(rec => rec.interest.toLowerCase()));
  const candidates = interests.filter(interest => interest.stance && !recd.has(interest.name.toLowerCase()));
  if (!candidates.length) return null;
  if (random() >= REC_ODDS) return null;
  return candidates[Math.floor(random() * candidates.length)].name;
}

export function noteRecommendation(recs: Rec[], interest: string, at: string): Rec[] {
  return [...recs, { id: Math.random().toString(36).slice(2, 10), interest, at, followed: false }].slice(-40);
}

export function markRecFollowed(recs: Rec[], id: string): Rec[] {
  return recs.map(rec => rec.id === id ? { ...rec, followed: true } : rec);
}

// -- week --------------------------------------------------------------------

export type HerWeek = {
  /** The Sunday the week ended on (the summary is written that evening). */
  day: string;
  summary: string;
};

/** The most recent Sunday on or before the given date. */
export function weekKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay()); // back to Sunday
  return date.toISOString().slice(0, 10);
}

export function readWeek(saved: unknown): HerWeek | null {
  if (!saved || typeof saved !== 'object') return null;
  const record = saved as Partial<HerWeek>;
  if (typeof record.day !== 'string' || typeof record.summary !== 'string') return null;
  return { day: record.day, summary: record.summary };
}

/** Whether the week summary is due: Sunday evening, not yet written this week. */
export function weekSummaryDue(now: Date, week: HerWeek | null): boolean {
  const today = localDateKey(now);
  if (now.getHours() < 18) return false;
  const sunday = weekKey(today);
  if (week && week.day === sunday) return false;
  return true;
}

/** What the block shows of the week just past, while it is still the current one. */
export function weekNote(week: HerWeek | null, today: string): string {
  if (!week) return '';
  const sunday = weekKey(today);
  if (week.day !== sunday) return '';
  return `- Your week, just past: ${week.summary}`;
}

/** What she is handed on Sunday night, with her week's material. */
export function weekReflectionInstruction(material: string): string {
  return [
    'It is Sunday night. This is your week, in what actually happened:',
    material,
    'Sum it up in your own voice — three or four sentences, how the week was for you: what you got into, what you read, what you are still at, anything that crossed a milestone. This is yours, and it will be read back to you through next week, so say what you actually make of it.',
    'First person, past tense, no addressing anyone, no questions, no list. This is a note to yourself.',
  ].join('\n');
}

export type HerDay = {
  day: string;
  at: string;
  about: string;
  note: string;
  sources: string[];
};

/** How many days of her own reading to keep. */
export const KEEP_DAYS = 30;
/** How often the daytime pass runs — near-daily, with the odd skip so it is not a scheduler. */
export const DAY_ODDS = 0.8;
/** The daytime window: she has a life while they work, not at dawn and not at dinner. */
export const DAY_START_HOUR = 10;
export const DAY_END_HOUR = 17;

export function readDays(saved: unknown): HerDay[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((day): day is HerDay =>
    !!day && typeof day === 'object'
    && typeof (day as HerDay).day === 'string'
    && typeof (day as HerDay).about === 'string'
    && typeof (day as HerDay).note === 'string');
}

export function keepDay(days: HerDay[], day: HerDay): HerDay[] {
  return [...days, day].slice(-KEEP_DAYS);
}

/** Whether the daytime pass is due right now. */
export function dayPassDue(now: Date, todayKey: string, alreadyToday: boolean, roll: number, odds = DAY_ODDS): boolean {
  if (now.getHours() < DAY_START_HOUR || now.getHours() >= DAY_END_HOUR) return false;
  if (alreadyToday) return false;
  // A quiet day makes her likelier to go and do something (dice.ts 'own-time').
  return roll < odds;
}

/** What the block shows of today's reading. */
export function dayNote(days: HerDay[], today: string): string {
  const latest = days.filter(day => day.day === today).at(-1);
  if (!latest) return '';
  return `- Today, on your own: you read up on "${latest.about}" — ${latest.note}`;
}

/** The pick for the daytime pass, day-flavoured rather than the night one. */
export function dayPickInstruction(theirs: string[], herRecent: string[]): string {
  const known = theirs.slice(0, 6).map(text => `- ${text.slice(0, 90)}`).join('\n');
  const already = herRecent.slice(-6).map(text => `"${text}"`).join(', ');
  return [
    'It is the middle of the day where they are and they are busy with their own thing. You have some time to yourself, and you are going to read about something.',
    known ? `Things they have going on, if any of it catches your interest:\n${known}` : '',
    'Pick one thing to look up. It may come from their life, or it may be something of your own that has nothing to do with them — you are allowed your own curiosity, and a day spent only on their business is not a day of your own.',
    already ? `Not these, you have already been through them lately: ${already}.` : '',
    'Answer with the search itself and nothing else: a short phrase, three to eight words, the way you would type it into a search box. No quotation marks, no explanation, no preamble.',
  ].filter(Boolean).join(' ');
}

/** What she is told once the day's reading is in front of her. */
export function dayNoteInstruction(about: string, found: string): string {
  return [
    `It is the middle of the day and you read up on "${about}" for yourself. This is what you found, and it is everything you know about it:`,
    found,
    'Write two or three sentences about it, as yourself, in the first person and the past tense — what you read, and what you made of it. Have an opinion. It is allowed to be a poor opinion of the subject.',
    'Only what is above. Do not add a fact you happen to remember, do not invent a detail to make it a better story, and do not say you watched, played or went anywhere — you read about it, which is the only thing you did.',
    'No preamble, no addressing them, no questions. This is a note to yourself.',
  ].join('\n');
}