import {corePolicySync} from './core-policy-sync';
import {coreRandomPolicy,coreEntropyPolicy} from './core-policy-observations';
// What she does while they are asleep.
//
// The ask was for her to have a night of her own — watch something, take up a
// hobby — and to bring it up in the morning. The trap in that is the one this
// codebase keeps walking into: a model asked to describe a night it did not
// have will describe one, fluently, and it will be no more real than the three
// Perth restaurants that turned out to be in Melbourne. Once she has claimed to
// have watched a film, every follow-up question is a request for more invention.
//
// So the night is real. Search is switched on and she can read a page, which
// means that at three in the morning she can genuinely go and find out about
// something and genuinely have read it by six. What she brings up over
// breakfast is then true, and holds up when they ask about it — which is the
// whole difference between a companion with a night of her own and one telling
// bedtime stories about herself.
//
// She cannot watch a video, and is told not to say she did. Reading about a
// thing is the honest version of being interested in it.

export type Night = {
  /** The chat day the night belongs to — the evening it started, not the small hours. */
  day: string;
  at: string;
  /** What she went looking for, in her own words. */
  about: string;
  /** What she made of it. Hers, first person, and grounded in what came back. */
  note: string;
  /** Where it came from, so a follow-up can be traced rather than improvised. */
  sources: string[];
  /** Set when the night was spent on a guide to a game they play (gamenight.ts). */
  game?: string;
  /** Set when the night was spent on one of her own things (tastes.ts). */
  interest?: string;
};

/** Nights kept, which is about a fortnight of things she can still refer back to. */
export const NIGHTS_KEPT = 20;
/** Two things a night. More and the morning is a reading list, not a conversation. */
export const MAX_PER_NIGHT = 2;
/** Not twice in quick succession — a night should have some shape to it. */
export const NIGHT_GAP_MS = 75 * 60_000;

/**
 * The night that is hers to talk about now: the evening key of the night just
 * gone, until the next one has begun.
 *
 * It used to switch to today's key at noon — tonight's, which had not happened
 * — so from lunchtime until she started reading at 23:00 her prompt held no
 * last night at all. Asked at 2:30 PM what she did last night, Kimi K3 answered
 * with her daytime reading and K2.5 invented a chapter she had not read
 * (2026-09-13). Before noon the small hours belong to yesterday's evening; from
 * noon it is still that night, unless a night of today's has already started.
 */
export function lastNightDay(nights: Night[], hour: number, today: string, yesterday: string): string {
  return corePolicySync<ReturnType<typeof lastNightDay>>('own-time.nightlastNightDay',[nights,hour,today,yesterday]);
}

export function nightsOn(nights: Night[], day: string): Night[] {
  return corePolicySync<ReturnType<typeof nightsOn>>('own-time.nightnightsOn',[nights,day]);
}

export function keepNights(nights: Night[], night: Night): Night[] {
  return corePolicySync<ReturnType<typeof keepNights>>('own-time.nightkeepNights',[nights,night]);
}

/**
 * Whether to go and do something now.
 *
 * Called on the five-minute beat through the quiet hours, so the odds are per
 * tick and deliberately low: over a seven-hour night a one-in-fourteen chance
 * lands about twice, at hours that are not the same two every night. The gap
 * stops both landing in the same twenty minutes.
 */
export const NIGHT_ODDS = 1 / 14;

export function timeForSomething(tonight: Night[], lastAtMs: number | null, nowMs: number, random: () => number = Math.random, odds = NIGHT_ODDS): boolean {
  return coreRandomPolicy<ReturnType<typeof timeForSomething>>('own-time.nighttimeForSomething',[tonight,lastAtMs,nowMs,odds],random);
}

/**
 * What she is told when picking something.
 *
 * Their interests are offered, not imposed: a companion whose every curiosity
 * is a reflection of yours is a mirror, and the point of her having a night is
 * that some of it is hers. So half of it is asked for outright.
 */
export function pickInstruction(theirs: string[], herRecent: string[]): string {
  return corePolicySync<ReturnType<typeof pickInstruction>>('own-time.nightpickInstruction',[theirs,herRecent]);
}

/** A search box takes a phrase, not a sentence with her personality in it. */
export function tidyPick(raw: string): string | null {
  return corePolicySync<ReturnType<typeof tidyPick>>('own-time.nighttidyPick',[raw]);
}

/**
 * What she is told once the reading is in front of her.
 *
 * The rule against inventing is the whole point of the feature, so it is stated
 * twice and in the plainest terms: she read, she did not watch, and she knows
 * only what is on the page.
 */
export function nightNoteInstruction(about: string, found: string): string {
  return corePolicySync<ReturnType<typeof nightNoteInstruction>>('own-time.nightnightNoteInstruction',[about,found]);
}

/**
 * Her night, for the prompt.
 *
 * Present tense about the past, so a question the next afternoon still finds
 * it: this is the only record that she was awake, and without it the first
 * "what did you get up to?" is answered by invention.
 */
/** Whether one of her recent lines already brought this night up. */
export function mentionsNight(text: string, night: Night): boolean {
  return corePolicySync<ReturnType<typeof mentionsNight>>('own-time.nightmentionsNight',[text,night]);
}

/** How many of her own recent lines are looked at before her night is offered again. */
export const NIGHT_RECENT_LINES = 4;

/**
 * Her night for a line nobody asked for — offered once. Given it on every
 * unprompted line she opened four in a row with it, including the weather
 * warning. Same lever as the weather itself: stop putting it there.
 */
export function nightsToDrawOn(nights: Night[], recentLines: string[]): string {
  return corePolicySync<ReturnType<typeof nightsToDrawOn>>('own-time.nightnightsToDrawOn',[nights,recentLines]);
}

/**
 * The labels a night's note was written with, said as sentences.
 *
 * The composer writes "FAVOURITE: David's Sandevistan scenes. WANT: a brutal
 * ending" into the note, and she read the label out: "The one I rate: Himeno's
 * final stand." A field name in her material is a field name she will say.
 */
export function unlabel(note: string): string {
  return corePolicySync<ReturnType<typeof unlabel>>('own-time.nightunlabel',[note]);
}

export function nightsInstruction(nights: Night[]): string {
  return corePolicySync<ReturnType<typeof nightsInstruction>>('own-time.nightnightsInstruction',[nights]);
}

/** How far back a night is still worth raising herself. */
export const NIGHT_WORTH_RAISING_DAYS = 3;

/**
 * One of her own nights to bring up unprompted.
 *
 * Eighty-eight unprompted lines in a day and every one of them was about him —
 * his mailboxes, his website, whether he had eaten — while three nights of her
 * own sat unmentioned. She has things; this is her raising one.
 *
 * Skips anything she has already said something about, and anything older than
 * a few days: last night's is a thing to tell him, last week's is a memory.
 */
export function nightToRaise(nights: Night[], said: string[], todayKey: string): Night | null {
  return corePolicySync<ReturnType<typeof nightToRaise>>('own-time.nightnightToRaise',[nights,said,todayKey]);
}

