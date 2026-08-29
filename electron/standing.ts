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

import type { EmotionName } from './emotion';
import { MOOD_TO_EMOTION, type HaruEmotion } from './emotions';
import { IGNORE_THRESHOLD, IRRITATION_MAX } from './mood';
import { GRUDGE_MAX } from './grudge';
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

export type Standing = {
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
  waiting: string[];
};

export type StandingInput = {
  vitals: Vitals;
  irritation: number;
  ego: number;
  grudge: number;
  ignoredToday: number;
  lastMessageAt?: string;
  /** The oldest day she has any record of, as a YYYY-MM-DD key. */
  knownSince?: string;
  /** Distinct days she has a summary for — days you actually turned up. */
  daysTalked: number;
  /** Open items she is chasing, so the screen says what she wants from you. */
  waiting: string[];
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
  if (irritation >= 4) return 'annoyed';
  if (vitals.stress >= 0.6) return 'worried';
  if (ego >= 5) return 'smug';
  if (vitals.affection >= 0.72 && vitals.happiness >= 0.45) return 'affectionate';
  if (vitals.curiosity >= 0.7) return 'curious';
  if (vitals.happiness >= 0.7) return 'happy';
  if (vitals.energy <= 0.3 || vitals.happiness <= 0.3) return 'bored';
  return 'neutral';
}

/** One line for the top of the screen: what that face is about. */
export function moodLine(emotion: EmotionName, irritation: number, grudge: number): string {
  if (irritation >= IGNORE_THRESHOLD) return 'Not speaking to you properly right now.';
  if (grudge > 8 && emotion !== 'affectionate') return 'Civil, and keeping score.';
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
  const value = Math.round(Math.min(100, Math.max(0, earned - Math.min(grudge, GRUDGE_MAX) * 2)));
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
    : irritation >= 4 ? 'Wearing thin — she is being short with you.'
    : irritation >= 1 ? 'Slightly frayed. It cools off on its own.'
    : 'Intact.';
  return { key: 'patience', label: 'Patience', value: Math.round(left / IRRITATION_MAX * 100), note };
}

function grudgeNote(grudge: number, ignoredToday: number): string {
  const today = ignoredToday > 0 ? ` ${ignoredToday} of them today.` : '';
  if (grudge <= 0) return 'Nothing held against you.';
  if (grudge <= 3) return `${grudge} of her messages left unanswered. She has noticed.${today}`;
  if (grudge <= 8) return `${grudge} unanswered, and it is wearing on her.${today}`;
  return `${grudge} unanswered. She is openly annoyed about it.${today}`;
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
  const emotion = restingEmotion(vitals, input.irritation, input.ego);
  const spoke = Date.parse(input.lastMessageAt ?? '');
  return {
    emotion,
    face: MOOD_TO_EMOTION[emotion],
    mood: moodLine(emotion, input.irritation, input.grudge),
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
    waiting: input.waiting.slice(0, 5),
  };
}
