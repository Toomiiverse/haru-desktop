import {corePolicySync} from './core-policy-sync';
import {coreRandomPolicy,coreEntropyPolicy} from './core-policy-observations';
// Her own life beyond her nights: the anniversaries of the things she took up,
// the wants her tastes declare, and the reading she does in the day while they
// work. What she does about a want, and how one gets harder, is projects.ts —
// this file still owns the ledger they share and the coin that settles a night
// nothing could judge. All of it is hers, not theirs, and all of it is written down
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
  return corePolicySync<ReturnType<typeof firstsNote>>('own-time.ownfirstsNote',[interests,today]);
}

// -- wants -------------------------------------------------------------------

// 'shelved' belongs to projects.ts, which widened a want into something with a
// ladder under it. It lives here because both read and write the one store key
// (her.wants) and a status this file refused would be dropped by readWants on
// the way back in.
export type WantStatus = 'declared' | 'working' | 'done' | 'dropped' | 'shelved';

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

/** Share of a deepen-night that becomes a night on something she is trying to do. */
export const WANT_ODDS = 0.5;
/** The roll per attempt. Randomised, weighted, and the early ones re-roll to slog. */
export const WANT_SLOG = 0.50;
export const WANT_CLICKED = 0.15;
export const WANT_GAVE_UP = 0.20;
export const WANT_NOTHING = 0.15;

export function readWants(saved: unknown): Want[] {
  return corePolicySync<ReturnType<typeof readWants>>('own-time.ownreadWants',[saved]);
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
  return coreEntropyPolicy<ReturnType<typeof reconcileWants>>('own-time.ownwantsWire',[interests,wants,now],interests.length,()=>Math.random().toString(36).slice(2,10));
}

export type WantOutcome = { kind: 'slog' | 'clicked' | 'gave_up' | 'nothing' };

/**
 * What a night of trying comes to. Randomised each time, weighted toward the
 * slog; the good and the giving-up need a few nights behind them before they
 * are on the table, so a want is never resolved on its first try.
 */
export function wantOutcome(roll: number, workedNights: number): WantOutcome {
  return corePolicySync<ReturnType<typeof wantOutcome>>('own-time.ownwantOutcome',[roll,workedNights]);
}

const OUTCOME_CUE: Record<WantOutcome['kind'], string> = {
  slog: 'You spent tonight on it and you tried again. It is still not going. Do not pretend otherwise — say what happened, which part of it is still beating you.',
  clicked: 'You spent tonight on it and it finally clicked — you can actually do a bit of it now. Say what gave, honestly, from what you read.',
  gave_up: 'You spent tonight on it and you have decided it is not worth it. Say the goodbye — the thing that made you walk away.',
  nothing: 'You spent the night on it and nothing happened — you got distracted. Say it in one line, without dressing it up.',
};

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
  return corePolicySync<ReturnType<typeof readRecs>>('own-time.ownreadRecs',[saved]);
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
  return corePolicySync<ReturnType<typeof recsAnsweredBy>>('own-time.ownrecsAnsweredBy',[recs,theirs,new Date().toISOString()]);
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
  {
    const requested=corePolicySync<number[]>('own-time.ownrecsCalendar',[recs]);
    const observed:(string|null)[]=Array.from({length:recs.length},()=>null);
    if(new Set(requested).size!==requested.length||requested.some(i=>!Number.isInteger(i)||i<0||i>=recs.length))throw Error('core_calendar_observation_protocol');
    for(const i of requested)observed[i]=dayOf(recs[i].at);
    return corePolicySync<ReturnType<typeof recsOnDay>>('own-time.ownrecsOnDay',[recs,observed,dayKey]);
  }
}

/** A recommendation overdue for its one follow-up, if any. */
export function recDueForFollowUp(recs: Rec[], nowMs: number): Rec | null {
  return corePolicySync<ReturnType<typeof recDueForFollowUp>>('own-time.ownrecDueForFollowUp',[recs,nowMs]);
}

/**
 * A thing of hers worth telling him to try: one she holds a view on and has
 * not pushed in a while. Nothing when there is nothing left, and the roll
 * keeps it a chance rather than a rota.
 */
export function pickRecommend(interests: { name: string; stance: string }[], recs: Rec[], nowMs: number, random: () => number = Math.random, madeToday = 0): string | null {
  return coreRandomPolicy<ReturnType<typeof pickRecommend>>('own-time.ownpickRecommend',[interests,recs,nowMs,madeToday],random);
}

export function noteRecommendation(recs: Rec[], interest: string, at: string): Rec[] {
  return corePolicySync<ReturnType<typeof noteRecommendation>>('own-time.ownnoteRecommendation',[recs,interest,at,Math.random().toString(36).slice(2,10)]);
}

export function markRecFollowed(recs: Rec[], id: string): Rec[] {
  return corePolicySync<ReturnType<typeof markRecFollowed>>('own-time.ownmarkRecFollowed',[recs,id]);
}

// -- week --------------------------------------------------------------------

export type HerWeek = {
  /** The Sunday the week ended on (the summary is written that evening). */
  day: string;
  summary: string;
};

/** The most recent Sunday on or before the given date. */
export function weekKey(dayKey: string): string {
  return corePolicySync<ReturnType<typeof weekKey>>('own-time.ownweekKey',[dayKey]);
}

export function readWeek(saved: unknown): HerWeek | null {
  return corePolicySync<ReturnType<typeof readWeek>>('own-time.ownreadWeek',[saved]);
}

/** Whether the week summary is due: Sunday evening, not yet written this week. */
export function weekSummaryDue(now: Date, week: HerWeek | null): boolean {
  return corePolicySync<ReturnType<typeof weekSummaryDue>>('own-time.ownweekSummaryDue',[now,week]);
}

/** What the block shows of the week just past, while it is still the current one. */
export function weekNote(week: HerWeek | null, today: string): string {
  return corePolicySync<ReturnType<typeof weekNote>>('own-time.ownweekNote',[week,today]);
}

/** What she is handed on Sunday night, with her week's material. */
export function weekReflectionInstruction(material: string): string {
  return corePolicySync<ReturnType<typeof weekReflectionInstruction>>('own-time.ownweekReflectionInstruction',[material]);
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
  return corePolicySync<ReturnType<typeof readDays>>('own-time.ownreadDays',[saved]);
}

export function keepDay(days: HerDay[], day: HerDay): HerDay[] {
  return corePolicySync<ReturnType<typeof keepDay>>('own-time.ownkeepDay',[days,day]);
}

/** Whether the daytime pass is due right now. */
export function dayPassDue(now: Date, todayKey: string, alreadyToday: boolean, roll: number, odds = DAY_ODDS): boolean {
  return corePolicySync<ReturnType<typeof dayPassDue>>('own-time.owndayPassDue',[now,todayKey,alreadyToday,roll,odds]);
}

/** What the block shows of today's reading. */
export function dayNote(days: HerDay[], today: string): string {
  return corePolicySync<ReturnType<typeof dayNote>>('own-time.owndayNote',[days,today]);
}

/** The pick for the daytime pass, day-flavoured rather than the night one. */
export function dayPickInstruction(theirs: string[], herRecent: string[]): string {
  return corePolicySync<ReturnType<typeof dayPickInstruction>>('own-time.owndayPickInstruction',[theirs,herRecent]);
}

/** What she is told once the day's reading is in front of her. */
export function dayNoteInstruction(about: string, found: string): string {
  return corePolicySync<ReturnType<typeof dayNoteInstruction>>('own-time.owndayNoteInstruction',[about,found]);
}
