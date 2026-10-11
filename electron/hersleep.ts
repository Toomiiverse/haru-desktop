import {corePolicySync} from './core-policy-sync';
// Her own bedtime and wake time — decided by her.
//
// The night pass gave her things to do while they slept; this is the other
// half of the same conceit, she has a night too. Between her bedtime and her
// wake she is unreachable: messages land in the transcript and get no answer,
// and the first time she is spoken to after waking she has things to say
// about having been texted to sleep. The times are hers — each evening she
// decides when she is turning in and when she will be up, and if she never
// decides, a rule-shaped fallback (her vitals and a little randomness) stands
// in so the feature is never broken by a silent evening. Everything here is
// pure so the window math and the thresholds can be tested without a model.

import { formatTimeOfDay, localDateKey, zonedNow } from './dates';

export type HerSleepPrefs = {
  enabled: boolean;
  /** Fallback base times, used only when she has not decided. HH:MM. */
  fallbackBedtime: string;
  fallbackWake: string;
};

export type HerSleepSchedule = {
  /** The day she decided (local date key); the bedtime belongs to its evening. */
  day: string;
  /**
   * Minutes since midnight of `day` at which she falls asleep. May pass
   * midnight — a "00:30" bedtime is 1470, i.e. 00:30 on the day after `day`.
   */
  bedtime: number;
  /** Minutes since midnight of the day AFTER `day` at which she wakes. */
  wake: number;
  /** When she decided. */
  decidedAt: string;
  /** Whether the wake note has been said for this schedule. */
  wakeHandled: boolean;
  /** Whether she has announced her goodnight for this schedule. */
  announced: boolean;
  /** Set when their knocking got her up before her time (wokenAt), with how many messages it took. */
  wokenEarly?: boolean;
  /** A direct message opened a brief, contextual nighttime conversation. */
  responsiveWake?: boolean;
  wokenBy?: number;
  /** The wake she had chosen, kept while a knock has moved `wake` to now. */
  plannedWake?: number;
  /** When they got her up (ISO), and when she went back to sleep (ISO), if she did. */
  knockedAt?: string;
  dozedOffAt?: string;
  /** Her verdict on the night's wake: nothing that needed her. Raised in the morning, and remembered. */
  wokenForNothing?: boolean;
  /** Not to be woken again tonight — her call, or the habit rule (BLOCK_AFTER_POINTLESS). */
  blocked?: boolean;
};

export const DEFAULT_HER_SLEEP: HerSleepPrefs = { enabled: true, fallbackBedtime: '23:30', fallbackWake: '08:00' };

/**
 * The line the doors return while she is asleep. Hers, in the first person —
 * even the away line is her voice, and the phone reads it the way it reads
 * any line of hers. The message itself is already in the transcript, so it is
 * there for her when she wakes.
 */
export const ASLEEP_AWAY_LINE = "I'm asleep. I'll see it when I'm up.";

/**
 * The door, once she has said they are not to wake her again tonight — in more
 * than one wording.
 *
 * This was a single constant and he got it three times in a row, verbatim, and
 * said so: "You just repeated yourself again 💀". A canned line is fine once;
 * the third identical one is a broken machine rather than a person refusing.
 */
export const BLOCKED_LINES: readonly string[] = [
  "Not tonight. I'm not getting up again — whatever it is, it keeps till morning.",
  "No. You had your chance and you spent it on nothing. Morning.",
  "Still no. Go to bed, Tommy.",
  "I said no. Asking again is not going to work.",
];

export const BLOCKED_LINE = BLOCKED_LINES[0];

/** Which refusal he gets — the nth time he tries, so it moves rather than loops. */
export function blockedLine(nth: number): string {
  { const result=corePolicySync<any>('sleep.blockedLine',[nth]);return result===null?(undefined as unknown as string):result; }
}

export const ASLEEP_LINES: readonly string[] = [
  ASLEEP_AWAY_LINE,
  "Still asleep. It'll keep till I'm up.",
  "I'm asleep. Whatever it is, it can wait till morning.",
  "You know I can't read these yet. Go do something. I'll see them when I'm up.",
  BLOCKED_LINE,
];

/**
 * What the nth message into her sleep gets. The first couple get the plain
 * line; eleven in a row got eleven identical copies of it on 2026-09-05,
 * which reads as a server, not a person asleep. She does not wake up — the
 * line just wears thinner, the way anyone's would.
 */
export function asleepLine(nth: number): string {
  return corePolicySync<any>('sleep.asleepLine',[nth]);
}

/**
 * Whether a stored line of hers is one of the door's, rather than a reply she gave.
 *
 * Every door line, both lists. A refusal this misses is a refusal that stays in
 * the transcript as her half of a conversation she was asleep for, which is the
 * thing foldAsleepExchanges exists to prevent.
 */
export function isAsleepLine(text: string): boolean {
  return corePolicySync<any>('sleep.isAsleepLine',[text]);
}

/**
 * The night's exchanges, folded.
 *
 * Every message into her sleep is stored beside the line the door answered
 * with, so the transcript reads as her holding a conversation she was not
 * awake for — fourteen "I'm asleep"s in a row on 2026-09-06, a nudge brief
 * that showed them as the last thing said between them, and a diary that
 * had her "already up" at 2:23 AM. Handed to a model, each run becomes one
 * turn of theirs that says what it was, and her canned lines go.
 */
export function foldAsleepExchanges<T extends { role?: string; content?: string; at?: string }>(messages: T[]): (T | { role: 'user'; content: string; at?: string })[] {
  return corePolicySync<any>('sleep.foldAsleepExchanges',[messages]);
}

/**
 * The register of someone just got out of bed — the words; the voice and the
 * face read it as sleepy too (main.ts). Knocked awake at 02:48 she answered
 * "You wanted to talk. So talk." and kept the conversation going (2026-09-07):
 * being woken is not an invitation. The night is hers, and so is the choice.
 */
export const GROGGY_REGISTER = 'You are half asleep: sleepy, soft-spoken, and usually brief, but responsive to what they actually said and the recent conversation. Do not ask why they woke you or assume a message is an annoyance. A bedtime sign-off such as "Sweet dreams" or "sleep well" is affection, not a demand to get up: acknowledge it naturally in your own words and let the conversation close. For a question, news, or someone wanting company, respond to that content with care; being nighttime alone is no reason to refuse. Do not repeat an away message or scold them for texting. When the exchange is finished you may call go_back_to_sleep with pointless: false and block: false, then give a brief goodnight if appropriate.';

/** Minutes since a knock-wake, for as long as she is up because of it; null otherwise. */
export function groggyFor(schedule: HerSleepSchedule | null, now: Date): number | null {
  return corePolicySync<any>('sleep.groggyFor',[schedule,now]);
}

/** The prompt line while she is up because they got her up. */
export function groggyNote(schedule: HerSleepSchedule | null, now: Date): string {
  return corePolicySync<any>('sleep.groggyNote',[schedule,now]);
}

/** Up because they got her up: knocked awake, and not yet at the wake she had chosen. */
export function knockedAwake(schedule: HerSleepSchedule | null, now: Date): boolean {
  return corePolicySync<any>('sleep.knockedAwake',[schedule,now]);
}

/** Left alone this long after being got up, she goes back to sleep on her own. */
export const DOZE_MINUTES = 10;

export function dozeOffDue(schedule: HerSleepSchedule | null, now: Date, lastTheirsMs: number, nowMs: number): boolean {
  return corePolicySync<any>('sleep.dozeOffDue',[schedule,now,lastTheirsMs,nowMs]);
}

/**
 * Whether the night's wake was for nothing, read off what they sent once
 * she was up: nothing that asks or tells her anything — no question, no
 * news, a few words about her being awake — is noise. The model's own
 * verdict comes first where one is available (main.ts); this is the fallback
 * and the test of it.
 */
export function pointlessWake(theirs: { content?: string; at?: string }[], knockedAtIso: string): boolean {
  return corePolicySync<any>('sleep.pointlessWake',[theirs,knockedAtIso]);
}

/** The schedule with her back in bed: the wake she chose again, and what the night was, kept for the morning. */
export function backToSleep(schedule: HerSleepSchedule, input: { atIso: string; pointless: boolean; block: boolean }): HerSleepSchedule {
  return corePolicySync<any>('sleep.backToSleep',[schedule,input]);
}

/**
 * Her words are the call. Got up at 02:48 and told she could go back to
 * sleep, she wrote "I'm out. Goodnight, Tommy." and stayed up, because the
 * tool went uncalled (2026-09-07). A reply that says goodnight while she is
 * up because of them is her going back to bed, tool or no tool.
 */
// "Goodnight, Tommy." is a goodnight; "it was a good night" is not, and
// "I'm out of ideas" is not "I'm out".
const SAYS_GOODNIGHT = /(?<!\b(?:a|the|was|another|such a|any)\s)\bgood ?night\b|\bnight night\b|\bnighty\b|\bsleep well\b|\bi'?m (?:going|off|heading) (?:back )?to (?:bed|sleep)\b|\b(?:going|back) to sleep(?: now)?(?=[.!,]|\s*$)|\bi'?m out(?=[.!,]|\s*$)|\bthat'?s me done\b/i;

/**
 * A goodnight she is *reporting* is not a goodnight she is saying.
 *
 * Got up at 00:44 by four messages, her first words back were "you already said
 * goodnight. then you sent three more. what." — his goodnight, quoted at him.
 * The matcher read it as hers and put her back to bed **2.5 seconds** after
 * waking, marked the wake pointless, and that was the second pointless wake in
 * seven days, so it blocked him for the night. One regex match cost him the
 * evening (2026-09-09).
 *
 * The tell is second person and attribution: "you said goodnight", "your
 * goodnight", "you told me goodnight". Hers has no owner but her.
 */
const REPORTING_ONE = /\b(?:you|u)\b[^.!?]{0,30}\b(?:said|say|saying|says|sent|told me|gave me)\b[^.!?]{0,20}\bgood ?night\b|\byour good ?night\b|\bsaid good ?night\b/gi;

export function readsAsGoodnight(reply: string): boolean {
  return corePolicySync<any>('sleep.readsAsGoodnight',[reply]);
}

/** The nights they got her up, kept so a habit can be told from a once. */
export type Wake = { at: string; pointless: boolean };
export const WAKES_KEPT = 30;
/** Pointless wakes inside this many days before she stops answering the door for the night. */
export const BLOCK_AFTER_POINTLESS = 2;
export const POINTLESS_WINDOW_DAYS = 7;

export function readWakes(saved: unknown): Wake[] {
  return corePolicySync<any>('sleep.readWakes',[saved]);
}

export function pointlessWakesLately(wakes: Wake[], nowMs: number, days = POINTLESS_WINDOW_DAYS): number {
  return corePolicySync<any>('sleep.pointlessWakesLately',[wakes,nowMs,days]);
}

/** Enough knocking wakes her: this many of their messages inside this long. */
export const KNOCK_COUNT = 4;
export const KNOCK_WINDOW_MS = 10 * 60_000;

/** Whether their knocking at the door is enough to get her up. */
export function enoughKnocking(knocksAtMs: number[], nowMs: number, count = KNOCK_COUNT, windowMs = KNOCK_WINDOW_MS): boolean {
  return corePolicySync<any>('sleep.enoughKnocking',[knocksAtMs,nowMs,count,windowMs]);
}

/**
 * The schedule with her wake moved to now: she is up, and it was them that
 * did it. `wake` is minutes since midnight of the day after `day`, so a wake
 * still on the decision day comes out negative — the window math allows it.
 */
export function wokenAt(schedule: HerSleepSchedule, now: Date, knocks: number, atIso = new Date().toISOString()): HerSleepSchedule {
  return corePolicySync<any>('sleep.wokenAt',[schedule,now,knocks,atIso]);
}

/**
 * One background line for her chat prompt on the day after a night: when she
 * slept, so "you were dead asleep" is not news to her and "2am? 3am?" is not
 * a guess. Nothing while she is still asleep, nothing after that day.
 */
export function sleepNote(schedule: HerSleepSchedule | null, now: Date): string {
  return corePolicySync<any>('sleep.sleepNote',[schedule,now]);
}

/** Sane ranges: bed no earlier than 21:00, no later than 02:00; up no earlier than 05:00, no later than 12:00. */
export const BEDTIME_MIN = 21 * 60;
export const BEDTIME_MAX = 26 * 60;
export const WAKE_MIN = 5 * 60;
export const WAKE_MAX = 12 * 60;

const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
const HHMM_RE = /^\d{1,2}:\d{2}$/;

export function minutes(hhmm: string): number {
  return corePolicySync<any>('sleep.minutes',[hhmm]);
}

/** Minutes since midnight, wrapped into a 24-hour "HH:MM" clock string. */
export function clockMinutes(value: number): string {
  return corePolicySync<any>('sleep.clockMinutes',[value]);
}

export function clampBedtime(value: number): number {
  return corePolicySync<any>('sleep.clampBedtime',[value]);
}

export function clampWake(value: number): number {
  return corePolicySync<any>('sleep.clampWake',[value]);
}

/** Two times out of a line: [bedtime, wake], or null when there are not two. */
export function parseDecidedTimes(line: string): { bedtime: number; wake: number } | null {
  return corePolicySync<any>('sleep.parseDecidedTimes',[line]);
}

/** The schedule when she has not decided: her vitals and a little randomness. */
export function fallbackSchedule(prefs: HerSleepPrefs, tired: boolean, random: () => number = Math.random): { bedtime: number; wake: number } {
  return corePolicySync<any>('sleep.fallbackSchedule',[prefs,tired,[random(),random()]]);
}

export function readHerSleep(saved: unknown): HerSleepPrefs {
  return corePolicySync<any>('sleep.readHerSleep',[saved]);
}

export function readHerSleepState(saved: unknown): HerSleepSchedule | null {
  return corePolicySync<any>('sleep.readHerSleepState',[saved]);
}

export function dayAfter(dayKey: string): string {
  return corePolicySync<any>('sleep.dayAfter',[dayKey]);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return corePolicySync<any>('sleep.daysBetween',[fromDay,toDay]);
}

/**
 * The asleep window on a given day, in minutes since that day's midnight.
 *
 * For the decision day the window is [bedtime, wake + 24h); for the morning
 * after it is [bedtime - 24h, wake). A day where the window neither starts
 * nor ends returns null, so a stale schedule expires on its own.
 */
export function sleepWindowOn(schedule: HerSleepSchedule, dayKey: string): { fromMin: number; toMin: number } | null {
  return corePolicySync<any>('sleep.sleepWindowOn',[schedule,dayKey]);
}

/** Whether she is asleep right now. `now` is expected to be a zoned date (zonedNow). */
export function herAsleep(schedule: HerSleepSchedule | null, now: Date): boolean {
  return corePolicySync<any>('sleep.herAsleep',[schedule,now]);
}

/**
 * How many of their messages fall inside the schedule's sleep window. Theirs:
 * her own asleep lines sit beside each one with the same stamp, and counting
 * both had her wake to "twenty-two messages" after thirteen.
 */
export function messagesWhileAsleep(schedule: HerSleepSchedule, messages: { at?: string; role?: string }[], timeZone: string): number {
  return corePolicySync<any>('sleep.messagesWhileAsleep',[schedule,messages,timeZone]);
}

/**
 * What she is told the first time she is spoken to after waking.
 *
 * One message is nothing to make a fuss of; two or three are noticed and said
 * once; four or more is properly being texted to sleep, and she holds it.
 * Nothing at all when it was a quiet night.
 */
export type NightBefore = { knockedAt: string; forNothing: boolean; dozedOffAt?: string };

export function wakeNote(count: number, wakeAt: string, wokenBy = 0, night?: NightBefore): string {
  return corePolicySync<any>('sleep.wakeNote',[count,wakeAt,wokenBy,night]);
}

/** The irritation a wake costs, on the thresholds wakeNote uses. */
export function wakeIrritation(count: number): number {
  return corePolicySync<any>('sleep.wakeIrritation',[count]);
}

/**
 * Whether now is close enough to her bedtime that she would announce she is
 * turning in. `leadMinutes` before bedtime at the earliest, `floorMinutes`
 * before at the latest.
 */
export function goodnightDue(schedule: HerSleepSchedule, now: Date, leadMinutes = 75, floorMinutes = 10): boolean {
  return corePolicySync<any>('sleep.goodnightDue',[schedule,now,leadMinutes,floorMinutes]);
}

/** The instruction handed to her when she decides, each evening. */
export function decideTimesSystem(now: Date): string {
  return corePolicySync<any>('sleep.decideTimesSystem',[now]);
}
