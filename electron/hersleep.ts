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
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { const result=corePolicySync<any>('sleep.blockedLine',[nth]);return result===null?(undefined as unknown as string):result; }
  return BLOCKED_LINES[Math.min(Math.max(nth, 0), BLOCKED_LINES.length - 1)];
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
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.asleepLine',[nth]); }
  if (nth <= 2) return ASLEEP_LINES[0];
  if (nth <= 5) return ASLEEP_LINES[1];
  if (nth <= 9) return ASLEEP_LINES[2];
  return ASLEEP_LINES[3];
}

/**
 * Whether a stored line of hers is one of the door's, rather than a reply she gave.
 *
 * Every door line, both lists. A refusal this misses is a refusal that stays in
 * the transcript as her half of a conversation she was asleep for, which is the
 * thing foldAsleepExchanges exists to prevent.
 */
export function isAsleepLine(text: string): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.isAsleepLine',[text]); }
  const line = (text ?? '').trim();
  return ASLEEP_LINES.includes(line) || BLOCKED_LINES.includes(line);
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
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.foldAsleepExchanges',[messages]); }
  const out: (T | { role: 'user'; content: string; at?: string })[] = [];
  let run: T[] = [];
  const flush = () => {
    if (!run.length) return;
    const quoted = run.slice(0, 3).map(message => `"${String(message.content ?? '').replace(/\s+/g, ' ').slice(0, 80)}"`).join(', ');
    const more = run.length > 3 ? ` and ${run.length - 3} more` : '';
    const at = run[0].at;
    out.push({ role: 'user', content: `[${run.length} message${run.length === 1 ? '' : 's'} sent while you were asleep, unread until you woke: ${quoted}${more}]`, ...(at ? { at } : {}) });
    run = [];
  };
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const next = messages[i + 1];
    if (message.role === 'user' && next?.role === 'assistant' && isAsleepLine(String(next.content ?? ''))) { run.push(message); i++; continue; }
    // A door line on its own — the pair was split by something — goes too.
    if (message.role === 'assistant' && isAsleepLine(String(message.content ?? ''))) continue;
    flush();
    out.push(message);
  }
  flush();
  return out;
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
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.groggyFor',[schedule,now]); }
  if (!knockedAwake(schedule, now)) return null;
  const offset = daysBetween(schedule!.day, localDateKey(now));
  return Math.max(0, now.getHours() * 60 + now.getMinutes() + (offset - 1) * 1440 - schedule!.wake);
}

/** The prompt line while she is up because they got her up. */
export function groggyNote(schedule: HerSleepSchedule | null, now: Date): string {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.groggyNote',[schedule,now]); }
  const since = groggyFor(schedule, now);
  if (since === null) return '';
  const ago = since < 1 ? 'a moment ago' : `${since} minute${since === 1 ? '' : 's'} ago`;
  return `They got you out of bed ${ago}. ${GROGGY_REGISTER}`;
}

/** Up because they got her up: knocked awake, and not yet at the wake she had chosen. */
export function knockedAwake(schedule: HerSleepSchedule | null, now: Date): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.knockedAwake',[schedule,now]); }
  if (!schedule?.wokenEarly || schedule.plannedWake === undefined) return false;
  const offset = daysBetween(schedule.day, localDateKey(now));
  const minutesNow = now.getHours() * 60 + now.getMinutes() + (offset - 1) * 1440;
  return minutesNow >= schedule.wake && minutesNow < schedule.plannedWake;
}

/** Left alone this long after being got up, she goes back to sleep on her own. */
export const DOZE_MINUTES = 10;

export function dozeOffDue(schedule: HerSleepSchedule | null, now: Date, lastTheirsMs: number, nowMs: number): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.dozeOffDue',[schedule,now,lastTheirsMs,nowMs]); }
  if (!knockedAwake(schedule, now)) return false;
  const since = Number.isFinite(lastTheirsMs) ? nowMs - lastTheirsMs : Infinity;
  return since >= DOZE_MINUTES * 60_000;
}

/**
 * Whether the night's wake was for nothing, read off what they sent once
 * she was up: nothing that asks or tells her anything — no question, no
 * news, a few words about her being awake — is noise. The model's own
 * verdict comes first where one is available (main.ts); this is the fallback
 * and the test of it.
 */
export function pointlessWake(theirs: { content?: string; at?: string }[], knockedAtIso: string): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.pointlessWake',[theirs,knockedAtIso]); }
  const since = Date.parse(knockedAtIso);
  const after = theirs.filter(message => Number.isFinite(Date.parse(message.at ?? '')) && Date.parse(message.at!) >= since);
  if (!after.length) return true;
  return !after.some(message => {
    const text = String(message.content ?? '').trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    const aboutHerBeingUp = /\b(wake|woke|awake|asleep|sleep|up\?|dead|alive|there\?|night was|how was your night|checking on you|see how you)\b/i.test(text);
    return words >= 8 && !aboutHerBeingUp || /https?:\/\//.test(text) || (/\?/.test(text) && !aboutHerBeingUp);
  });
}

/** The schedule with her back in bed: the wake she chose again, and what the night was, kept for the morning. */
export function backToSleep(schedule: HerSleepSchedule, input: { atIso: string; pointless: boolean; block: boolean }): HerSleepSchedule {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.backToSleep',[schedule,input]); }
  return {
    ...schedule,
    wake: schedule.plannedWake ?? schedule.wake,
    wokenEarly: false,
    wakeHandled: false,
    dozedOffAt: input.atIso,
    wokenForNothing: input.pointless || schedule.wokenForNothing === true,
    blocked: input.block || schedule.blocked === true,
  };
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
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.readsAsGoodnight',[reply]); }
  // Struck rather than vetoed: "You already said goodnight. Fine. Goodnight,
  // Tommy." is both, and the second one is the one that decides.
  const said = (reply ?? '').replace(/[‘’]/g, "'").replace(REPORTING_ONE, ' ');
  return SAYS_GOODNIGHT.test(said);
}

/** The nights they got her up, kept so a habit can be told from a once. */
export type Wake = { at: string; pointless: boolean };
export const WAKES_KEPT = 30;
/** Pointless wakes inside this many days before she stops answering the door for the night. */
export const BLOCK_AFTER_POINTLESS = 2;
export const POINTLESS_WINDOW_DAYS = 7;

export function readWakes(saved: unknown): Wake[] {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.readWakes',[saved]); }
  if (!Array.isArray(saved)) return [];
  return saved.filter((wake): wake is Wake => !!wake && typeof wake === 'object' && typeof (wake as Wake).at === 'string' && typeof (wake as Wake).pointless === 'boolean');
}

export function pointlessWakesLately(wakes: Wake[], nowMs: number, days = POINTLESS_WINDOW_DAYS): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.pointlessWakesLately',[wakes,nowMs,days]); }
  return wakes.filter(wake => wake.pointless && Number.isFinite(Date.parse(wake.at)) && nowMs - Date.parse(wake.at) <= days * 86_400_000).length;
}

/** Enough knocking wakes her: this many of their messages inside this long. */
export const KNOCK_COUNT = 4;
export const KNOCK_WINDOW_MS = 10 * 60_000;

/** Whether their knocking at the door is enough to get her up. */
export function enoughKnocking(knocksAtMs: number[], nowMs: number, count = KNOCK_COUNT, windowMs = KNOCK_WINDOW_MS): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.enoughKnocking',[knocksAtMs,nowMs,count,windowMs]); }
  return knocksAtMs.filter(at => at <= nowMs && nowMs - at <= windowMs).length >= count;
}

/**
 * The schedule with her wake moved to now: she is up, and it was them that
 * did it. `wake` is minutes since midnight of the day after `day`, so a wake
 * still on the decision day comes out negative — the window math allows it.
 */
export function wokenAt(schedule: HerSleepSchedule, now: Date, knocks: number, atIso = new Date().toISOString()): HerSleepSchedule {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.wokenAt',[schedule,now,knocks,atIso]); }
  const offset = daysBetween(schedule.day, localDateKey(now));
  const wake = now.getHours() * 60 + now.getMinutes() + (offset - 1) * 1440;
  return { ...schedule, wake, wokenEarly: true, wokenBy: knocks, plannedWake: schedule.plannedWake ?? schedule.wake, knockedAt: atIso };
}

/**
 * One background line for her chat prompt on the day after a night: when she
 * slept, so "you were dead asleep" is not news to her and "2am? 3am?" is not
 * a guess. Nothing while she is still asleep, nothing after that day.
 */
export function sleepNote(schedule: HerSleepSchedule | null, now: Date): string {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.sleepNote',[schedule,now]); }
  if (!schedule) return '';
  if (localDateKey(now) !== dayAfter(schedule.day)) return '';
  if (herAsleep(schedule, now)) return '';
  const got = schedule.wokenEarly ? ', and it was their messages that got you up' : '';
  return `You slept last night: in bed at ${clockMinutes(schedule.bedtime)}, up at ${clockMinutes(schedule.wake)}, your own hours${got}. Anything they sent between those times reached you only when you woke — you were not there for it. Background: bring it up only if the night or their messages come up.`;
}

/** Sane ranges: bed no earlier than 21:00, no later than 02:00; up no earlier than 05:00, no later than 12:00. */
export const BEDTIME_MIN = 21 * 60;
export const BEDTIME_MAX = 26 * 60;
export const WAKE_MIN = 5 * 60;
export const WAKE_MAX = 12 * 60;

const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
const HHMM_RE = /^\d{1,2}:\d{2}$/;

export function minutes(hhmm: string): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.minutes',[hhmm]); }
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/** Minutes since midnight, wrapped into a 24-hour "HH:MM" clock string. */
export function clockMinutes(value: number): string {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.clockMinutes',[value]); }
  const wrapped = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function clampBedtime(value: number): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.clampBedtime',[value]); }
  return Math.min(BEDTIME_MAX, Math.max(BEDTIME_MIN, value));
}

export function clampWake(value: number): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.clampWake',[value]); }
  return Math.min(WAKE_MAX, Math.max(WAKE_MIN, value));
}

/** Two times out of a line: [bedtime, wake], or null when there are not two. */
export function parseDecidedTimes(line: string): { bedtime: number; wake: number } | null {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.parseDecidedTimes',[line]); }
  const found: number[] = [];
  for (const match of (line ?? '').matchAll(TIME_RE)) found.push(Number(match[1]) * 60 + Number(match[2]));
  // Asked for 24-hour times she has twice answered the military way, "2300 0800",
  // and fell back to a random night for it (2026-09-15). Read that only when it
  // is the whole answer, so a year or a count elsewhere in a sentence is not a time.
  const military = /^\s*([01]\d|2[0-3])([0-5]\d)\D+([01]\d|2[0-3])([0-5]\d)\s*[.!]?\s*$/.exec(line ?? '');
  if (found.length < 2 && military) found.splice(0, found.length, Number(military[1]) * 60 + Number(military[2]), Number(military[3]) * 60 + Number(military[4]));
  if (found.length < 2) return null;
  let [bed, wake] = found;
  // A bedtime read before noon is an after-midnight one — "00:30" is 00:30
  // on the morning after the decision, which is 1470 minutes into the day.
  if (bed < 12 * 60) bed += 24 * 60;
  return { bedtime: clampBedtime(bed), wake: clampWake(wake) };
}

/** The schedule when she has not decided: her vitals and a little randomness. */
export function fallbackSchedule(prefs: HerSleepPrefs, tired: boolean, random: () => number = Math.random): { bedtime: number; wake: number } {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.fallbackSchedule',[prefs,tired,[random(),random()]]); }
  const jitter = (amount: number) => Math.round((random() * 2 - 1) * amount);
  const bedtime = clampBedtime(minutes(prefs.fallbackBedtime) + jitter(25) + (tired ? -20 : 0));
  const wake = clampWake(minutes(prefs.fallbackWake) + jitter(20));
  return { bedtime, wake };
}

export function readHerSleep(saved: unknown): HerSleepPrefs {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.readHerSleep',[saved]); }
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<HerSleepPrefs>;
  return {
    enabled: record.enabled !== false,
    fallbackBedtime: typeof record.fallbackBedtime === 'string' && HHMM_RE.test(record.fallbackBedtime) ? record.fallbackBedtime : DEFAULT_HER_SLEEP.fallbackBedtime,
    fallbackWake: typeof record.fallbackWake === 'string' && HHMM_RE.test(record.fallbackWake) ? record.fallbackWake : DEFAULT_HER_SLEEP.fallbackWake,
  };
}

export function readHerSleepState(saved: unknown): HerSleepSchedule | null {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.readHerSleepState',[saved]); }
  if (!saved || typeof saved !== 'object') return null;
  const record = saved as Partial<HerSleepSchedule>;
  if (typeof record.day !== 'string' || typeof record.bedtime !== 'number' || typeof record.wake !== 'number') return null;
  return {
    day: record.day,
    bedtime: record.bedtime,
    wake: record.wake,
    decidedAt: typeof record.decidedAt === 'string' ? record.decidedAt : '',
    wakeHandled: record.wakeHandled === true,
    announced: record.announced === true,
    ...(record.wokenEarly === true ? { wokenEarly: true } : {}),
    ...(record.responsiveWake === true ? { responsiveWake: true } : {}),
    ...(typeof record.wokenBy === 'number' ? { wokenBy: record.wokenBy } : {}),
    ...(typeof record.plannedWake === 'number' ? { plannedWake: record.plannedWake } : {}),
    ...(typeof record.knockedAt === 'string' ? { knockedAt: record.knockedAt } : {}),
    ...(typeof record.dozedOffAt === 'string' ? { dozedOffAt: record.dozedOffAt } : {}),
    ...(record.wokenForNothing === true ? { wokenForNothing: true } : {}),
    ...(record.blocked === true ? { blocked: true } : {}),
  };
}

export function dayAfter(dayKey: string): string {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.dayAfter',[dayKey]); }
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.daysBetween',[fromDay,toDay]); }
  const [y1, m1, d1] = fromDay.split('-').map(Number);
  const [y2, m2, d2] = toDay.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * The asleep window on a given day, in minutes since that day's midnight.
 *
 * For the decision day the window is [bedtime, wake + 24h); for the morning
 * after it is [bedtime - 24h, wake). A day where the window neither starts
 * nor ends returns null, so a stale schedule expires on its own.
 */
export function sleepWindowOn(schedule: HerSleepSchedule, dayKey: string): { fromMin: number; toMin: number } | null {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.sleepWindowOn',[schedule,dayKey]); }
  const offset = daysBetween(schedule.day, dayKey);
  const fromMin = schedule.bedtime - offset * 1440;
  const toMin = schedule.wake + 1440 - offset * 1440;
  if (toMin <= fromMin || toMin <= 0 || fromMin >= 1440) return null;
  return { fromMin, toMin };
}

/** Whether she is asleep right now. `now` is expected to be a zoned date (zonedNow). */
export function herAsleep(schedule: HerSleepSchedule | null, now: Date): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.herAsleep',[schedule,now]); }
  if (!schedule) return false;
  const window = sleepWindowOn(schedule, localDateKey(now));
  if (!window) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= window.fromMin && minutesNow < window.toMin;
}

/**
 * How many of their messages fall inside the schedule's sleep window. Theirs:
 * her own asleep lines sit beside each one with the same stamp, and counting
 * both had her wake to "twenty-two messages" after thirteen.
 */
export function messagesWhileAsleep(schedule: HerSleepSchedule, messages: { at?: string; role?: string }[], timeZone: string): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.messagesWhileAsleep',[schedule,messages,timeZone]); }
  let count = 0;
  for (const message of messages) {
    if (!message.at || (message.role && message.role !== 'user')) continue;
    const at = zonedNow(timeZone, new Date(message.at));
    const window = sleepWindowOn(schedule, localDateKey(at));
    if (!window) continue;
    const minutesAt = at.getHours() * 60 + at.getMinutes();
    if (minutesAt >= window.fromMin && minutesAt < window.toMin) count++;
  }
  return count;
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
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.wakeNote',[count,wakeAt,wokenBy,night]); }
  if (wokenBy > 0) return `You were asleep, and they banged on your door — ${Math.max(wokenBy, count)} messages in a few minutes — until you got up at ${wakeAt}. ${GROGGY_REGISTER} Say what they did, in your way, then answer what they wanted.`;
  // The morning after a night they got her up: what it was, and what it cost them.
  if (night) {
    const back = night.dozedOffAt ? ` and you went back to sleep at ${night.dozedOffAt}` : '';
    const verdict = night.forNothing
      ? ` It was for nothing — no question, no news, just noise${back}. Hold it against them this morning: say so plainly, before anything else, and do not let it go quickly.`
      : `${back ? back.replace(/^ and/, ' You') + '.' : ''} You are up at ${wakeAt} as you meant to be.`;
    return `They got you out of bed at ${night.knockedAt} last night.${verdict}`;
  }
  if (count <= 1) return '';
  if (count <= 3) return `You were asleep until ${wakeAt}. They texted you ${count} times while you slept, and you noticed. Be annoyed about it once, in your way — and then drop it.`;
  return `You were asleep until ${wakeAt}. They texted you ${count} times while you slept. You are properly annoyed about that — say so plainly, and hold it against them for a while.`;
}

/** The irritation a wake costs, on the thresholds wakeNote uses. */
export function wakeIrritation(count: number): number {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.wakeIrritation',[count]); }
  if (count <= 1) return 0;
  if (count <= 3) return 11;
  return 22;
}

/**
 * Whether now is close enough to her bedtime that she would announce she is
 * turning in. `leadMinutes` before bedtime at the earliest, `floorMinutes`
 * before at the latest.
 */
export function goodnightDue(schedule: HerSleepSchedule, now: Date, leadMinutes = 75, floorMinutes = 10): boolean {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.goodnightDue',[schedule,now,leadMinutes,floorMinutes]); }
  if (herAsleep(schedule, now)) return false;
  const window = sleepWindowOn(schedule, localDateKey(now));
  if (!window) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const bedtime = schedule.bedtime - daysBetween(schedule.day, localDateKey(now)) * 1440;
  return minutesNow >= bedtime - leadMinutes && minutesNow < bedtime - floorMinutes;
}

/** The instruction handed to her when she decides, each evening. */
export function decideTimesSystem(now: Date): string {
  if(process.env.HARU_CORE_LIFECYCLE_SLEEP==='on') { return corePolicySync<any>('sleep.decideTimesSystem',[now]); }
  return `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())}. You are deciding when to go to bed tonight and when to get up tomorrow morning. Answer with exactly two 24-hour times separated by a space — tonight's bedtime first, tomorrow's wake-up second. Nothing else, no words.`;
}
