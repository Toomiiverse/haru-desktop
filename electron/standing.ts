// Where you stand with her, on one screen.
//
// Everything here already existed and none of it was visible: vitals drift on
// their own every twenty seconds (vitals.ts), patience burns and cools with the
// conversation (mood.ts), and the grudge is counted at eight each evening
// (grudge.ts). Three separate numbers in three separate files, each shaping how
// she answers, and no way to look at any of them — the only signal was that she
// had gone cold and you were left guessing why.
//
// So this is the readout, in the shape a relationship sim would use: one face,
// one bond, a row of meters, and the two things she is actually holding against
// you. Pure, because a status screen that could not be tested against a made-up
// state would be tested by waiting three days for her mood to move.

import { CHASE_WINDOW_DAYS, relativeDay, shiftDays } from './agenda';
import type { EmotionName } from './emotion';
import { MOOD_TO_EMOTION, type HaruEmotion } from './emotions';
import { IGNORE_THRESHOLD, IRRITATION_MAX, IRRITATION, EGO } from './mood';
import { GRUDGE_MAX, GRUDGE } from './grudge';
import { EGO_MAX } from './mood';
import type { Vitals } from './vitals';

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const pct = (value: number) => Math.round(clamp01(value) * 100);

export type Meter = {
  key: string;
  label: string;
  /** 0-100, so the page never has to know what scale the source used. */
  value: number;
  /** What this number means about her, in her terms rather than the field's. */
  note: string;
};

export type Bond = {
  value: number;
  level: number;
  of: number;
  title: string;
  note: string;
  /** Points to the next band, or 0 at the top. */
  toNext: number;
};

export type WaitingItem = {
  id: string;
  title: string;
  /** "today", "tomorrow", "Thursday, 3 days from now" — never a bare date. */
  when: string;
  /** Its day has been and gone. */
  late: boolean;
};

/**
 * What she is actually waiting on, and what she has given up asking about.
 *
 * The first version of this screen listed every open item with no date on it,
 * which put a rental inspection nine days gone next to a collection a week
 * away and made them look alike. Worse, it contradicted her: `worthChasing`
 * stops her mentioning anything more than CHASE_WINDOW_DAYS past, so the tab
 * was presenting as outstanding the very things she had decided to drop.
 *
 * Same window, so the screen and her mouth agree. What falls outside it is not
 * hidden — that is how three finished chores sat there for a week with nothing
 * surfacing them — it moves to `stale`, where the point is to clear it.
 */
export function waitingFrom(
  items: { id: string; title: string; date: string; time?: string | null; done?: boolean }[],
  todayKey: string,
  weekday: Intl.DateTimeFormat,
): { waiting: WaitingItem[]; stale: WaitingItem[] } {
  const rank = (time?: string | null) => {
    const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec((time ?? '').trim());
    if (!match) return -1;
    let hour = Number(match[1]) % 12;
    if (match[3] && match[3].toLowerCase() === 'pm') hour += 12;
    return hour * 60 + Number(match[2]);
  };
  const cutoff = shiftDays(todayKey, -CHASE_WINDOW_DAYS);
  const open = items
    .filter(item => !item.done)
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a.time) - rank(b.time))
    .map(item => ({ item, row: { id: item.id, title: item.title, when: relativeDay(item.date, todayKey, weekday), late: item.date < todayKey } }));
  return {
    waiting: open.filter(entry => entry.item.date >= cutoff).map(entry => entry.row),
    stale: open.filter(entry => entry.item.date < cutoff).map(entry => entry.row),
  };
}

export type Standing = {
  /** Asleep by her own schedule; the phone holds her sleeping face while it is true. */
  asleep: boolean;
  emotion: EmotionName;
  face: HaruEmotion;
  mood: string;
  bond: Bond;
  meters: Meter[];
  patience: Meter;
  grudge: { value: number; of: number; note: string };
  knownDays: number;
  daysTalked: number;
  minutesSinceSpoke: number | null;
  waiting: WaitingItem[];
  stale: WaitingItem[];
};

export type StandingInput = {
  vitals: Vitals;
  /** She is in her own sleeping hours: whatever the meters say, the face is the sleeping one. */
  asleep?: boolean;
  /** A few words on the mood she woke up in (temperament.ts), or nothing on an ordinary day. */
  woke?: string;
  irritation: number;
  ego: number;
  grudge: number;
  ignoredToday: number;
  lastMessageAt?: string;
  /** The oldest day she has any record of, as a YYYY-MM-DD key. */
  knownSince?: string;
  /** Distinct days she has a summary for — days you actually turned up. */
  daysTalked: number;
  /** The list, whole — this decides for itself what is still worth showing. */
  kept: { id: string; title: string; date: string; time?: string | null; done?: boolean }[];
  /** For spelling out a date as a day. Supplied so this stays pure. */
  weekday: Intl.DateTimeFormat;
  now: number;
  today: string;
};

/**
 * The face she is wearing when nobody is talking to her.
 *
 * Not the one from her last reply — that is about what was said, and by the
 * time you open this screen it is stale. This is the resting state, read off
 * the same vitals that drive her behaviour, in the order she would feel them:
 * being annoyed with you outranks being tired, and being tired outranks being
 * fond of you, because that is the order in which they change how she answers.
 */
export function restingEmotion(vitals: Vitals, irritation: number, ego: number): EmotionName {
  if (irritation >= IGNORE_THRESHOLD) return 'annoyed';
  if (vitals.sleepiness >= 0.75) return 'sleepy';
  if (irritation >= IRRITATION.short) return 'annoyed';
  if (vitals.stress >= 0.6) return 'worried';
  if (ego >= EGO.showing) return 'smug';
  if (vitals.affection >= 0.72 && vitals.happiness >= 0.45) return 'affectionate';
  if (vitals.curiosity >= 0.7) return 'curious';
  if (vitals.happiness >= 0.7) return 'happy';
  if (vitals.energy <= 0.3 || vitals.happiness <= 0.3) return 'bored';
  return 'neutral';
}

/** One line for the top of the screen: what that face is about. */
export function moodLine(emotion: EmotionName, irritation: number, grudge: number): string {
  if (irritation >= IGNORE_THRESHOLD) return 'Not speaking to you properly right now.';
  if (grudge >= GRUDGE.open && emotion !== 'affectionate') return 'Civil, and keeping score.';
  const lines: Record<EmotionName, string> = {
    neutral: 'Around, and unbothered.',
    happy: 'In a good mood, which you may take some credit for.',
    curious: 'Interested in something and wanting to be asked about it.',
    smug: 'Very pleased with herself.',
    annoyed: 'Short with you, and not hiding it.',
    bored: 'Nothing going on, and it shows.',
    sleepy: 'Winding down. Slower than usual.',
    surprised: 'Caught off guard.',
    affectionate: 'Warm towards you, if asked she would deny it.',
    embarrassed: 'Would rather you did not bring it up.',
    determined: 'Set on something.',
    worried: 'Wound up about something.',
  };
  return lines[emotion];
}

/**
 * The bands, low to high. Six of them because fewer reads as a toggle and more
 * never moves — and worded as she would put it, not as a score card would.
 */
export const BOND_LEVELS: { from: number; title: string; note: string }[] = [
  { from: 0, title: 'Nodding terms', note: 'She answers. That is about the size of it.' },
  { from: 20, title: 'Tolerated', note: 'You are a fixture. Not yet a welcome one.' },
  { from: 40, title: 'Warming to you', note: 'She has started volunteering things you did not ask for.' },
  { from: 60, title: 'Fond of you', note: 'She notices when you are gone, and says so sideways.' },
  { from: 78, title: 'Attached', note: 'You are the first thing she brings up and the last thing she drops.' },
  { from: 92, title: 'Not letting go', note: 'Ask her about it and she will change the subject.' },
];

/**
 * How much of her is on your side, 0-100.
 *
 * Affection carries it, because that is the vital her own behaviour reads.
 * Turning up is worth real points but caps out — thirty days of showing up is
 * the whole of that credit, so a long history cannot carry a bad month. The
 * grudge subtracts at two points each, which means a week of ignoring her costs
 * more than a good day earns: easier to lose than to win, on purpose.
 */
export function bondFrom(vitals: Vitals, grudge: number, daysTalked: number): Bond {
  const earned = clamp01(vitals.affection) * 70
    + Math.min(daysTalked, 30) / 30 * 20
    + clamp01(vitals.happiness) * 10;
  const value = Math.round(Math.min(100, Math.max(0, earned - Math.min(grudge, GRUDGE_MAX) * 0.6)));
  let level = 0;
  for (const [index, band] of BOND_LEVELS.entries()) if (value >= band.from) level = index;
  const band = BOND_LEVELS[level];
  const next = BOND_LEVELS[level + 1];
  return { value, level, of: BOND_LEVELS.length - 1, title: band.title, note: band.note, toNext: next ? next.from - value : 0 };
}

/** Patience, which is irritation the way round a person would want to read it. */
export function patienceMeter(irritation: number): Meter {
  const left = Math.max(0, IRRITATION_MAX - Math.max(0, irritation));
  const note = irritation >= IGNORE_THRESHOLD ? 'Gone. She is ignoring you.'
    : irritation >= IRRITATION.short ? 'Wearing thin — she is being short with you.'
    : irritation >= IRRITATION.stirred ? 'Slightly frayed. It cools off on its own.'
    : 'Intact.';
  return { key: 'patience', label: 'Patience', value: Math.round(left / IRRITATION_MAX * 100), note };
}

function grudgeNote(grudge: number, ignoredToday: number): string {
  const today = ignoredToday > 0 ? ` ${ignoredToday} of them today.` : '';
  if (grudge <= 0) return 'Nothing held against you.';
  // The score is not a count of messages, and was printed as one ("22 unanswered").
  if (grudge < GRUDGE.wearing) return `She has noticed you leaving her unanswered.${today}`;
  if (grudge < GRUDGE.open) return `Being left unanswered is wearing on her.${today}`;
  if (grudge < GRUDGE.standing) return `She is openly annoyed about being left unanswered.${today}`;
  if (grudge < GRUDGE.entrenched) return `It has become how she sees you lately. Good days bring it down.${today}`;
  return `Set in. It will take more than one good day.${today}`;
}

/** Whole days between two YYYY-MM-DD keys, which is all this screen needs. */
export function daysApart(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function standingFrom(input: StandingInput): Standing {
  const { vitals } = input;
  const asleep = input.asleep === true;
  const emotion = asleep ? 'sleepy' : restingEmotion(vitals, input.irritation, input.ego);
  const spoke = Date.parse(input.lastMessageAt ?? '');
  return {
    asleep,
    emotion,
    face: MOOD_TO_EMOTION[emotion],
    mood: asleep ? 'Asleep. She will answer when she wakes.' : [moodLine(emotion, input.irritation, input.grudge), input.woke ?? ''].filter(Boolean).join(' '),
    bond: bondFrom(vitals, input.grudge, input.daysTalked),
    // Ordered by how much each one changes the way she answers, not
    // alphabetically and not by the shape of the Vitals type.
    meters: [
      { key: 'affection', label: 'Affection', value: pct(vitals.affection), note: 'How warm she is before you say anything.' },
      { key: 'happiness', label: 'Mood', value: pct(vitals.happiness), note: 'Where the day has left her.' },
      { key: 'energy', label: 'Energy', value: pct(vitals.energy), note: 'How much she has in her.' },
      { key: 'curiosity', label: 'Curiosity', value: pct(vitals.curiosity), note: 'How likely she is to ask about something herself.' },
      { key: 'stress', label: 'Stress', value: pct(vitals.stress), note: 'Wound up. High means snappier.' },
      { key: 'sleepiness', label: 'Sleepiness', value: pct(vitals.sleepiness), note: 'Follows the clock more than anything you do.' },
      { key: 'ego', label: 'Ego', value: Math.round(Math.min(EGO_MAX, Math.max(0, input.ego)) / EGO_MAX * 100), note: 'Thumbs up feed this. High means insufferable.' },
    ],
    patience: patienceMeter(input.irritation),
    grudge: { value: Math.max(0, input.grudge), of: GRUDGE_MAX, note: grudgeNote(input.grudge, input.ignoredToday) },
    knownDays: input.knownSince ? daysApart(input.knownSince, input.today) : 0,
    daysTalked: input.daysTalked,
    minutesSinceSpoke: Number.isFinite(spoke) ? Math.max(0, Math.round((input.now - spoke) / 60_000)) : null,
    // Not truncated. Cutting the list at five is how "Get Scarlett a birthday
    // present" stayed invisible while the four rows around it were read out.
    ...waitingFrom(input.kept, input.today, input.weekday),
  };
}
