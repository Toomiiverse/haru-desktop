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
};

export const DEFAULT_HER_SLEEP: HerSleepPrefs = { enabled: true, fallbackBedtime: '23:30', fallbackWake: '08:00' };

/**
 * The line the doors return while she is asleep. Hers, in the first person —
 * even the away line is her voice, and the phone reads it the way it reads
 * any line of hers. The message itself is already in the transcript, so it is
 * there for her when she wakes.
 */
export const ASLEEP_AWAY_LINE = "I'm asleep. I'll see it when I'm up.";

/** Sane ranges: bed no earlier than 21:00, no later than 02:00; up no earlier than 05:00, no later than 12:00. */
export const BEDTIME_MIN = 21 * 60;
export const BEDTIME_MAX = 26 * 60;
export const WAKE_MIN = 5 * 60;
export const WAKE_MAX = 12 * 60;

const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
const HHMM_RE = /^\d{1,2}:\d{2}$/;

export function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/** Minutes since midnight, wrapped into a 24-hour "HH:MM" clock string. */
export function clockMinutes(value: number): string {
  const wrapped = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function clampBedtime(value: number): number {
  return Math.min(BEDTIME_MAX, Math.max(BEDTIME_MIN, value));
}

export function clampWake(value: number): number {
  return Math.min(WAKE_MAX, Math.max(WAKE_MIN, value));
}

/** Two times out of a line: [bedtime, wake], or null when there are not two. */
export function parseDecidedTimes(line: string): { bedtime: number; wake: number } | null {
  const found: number[] = [];
  for (const match of (line ?? '').matchAll(TIME_RE)) found.push(Number(match[1]) * 60 + Number(match[2]));
  if (found.length < 2) return null;
  let [bed, wake] = found;
  // A bedtime read before noon is an after-midnight one — "00:30" is 00:30
  // on the morning after the decision, which is 1470 minutes into the day.
  if (bed < 12 * 60) bed += 24 * 60;
  return { bedtime: clampBedtime(bed), wake: clampWake(wake) };
}

/** The schedule when she has not decided: her vitals and a little randomness. */
export function fallbackSchedule(prefs: HerSleepPrefs, tired: boolean, random: () => number = Math.random): { bedtime: number; wake: number } {
  const jitter = (amount: number) => Math.round((random() * 2 - 1) * amount);
  const bedtime = clampBedtime(minutes(prefs.fallbackBedtime) + jitter(25) + (tired ? -20 : 0));
  const wake = clampWake(minutes(prefs.fallbackWake) + jitter(20));
  return { bedtime, wake };
}

export function readHerSleep(saved: unknown): HerSleepPrefs {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<HerSleepPrefs>;
  return {
    enabled: record.enabled !== false,
    fallbackBedtime: typeof record.fallbackBedtime === 'string' && HHMM_RE.test(record.fallbackBedtime) ? record.fallbackBedtime : DEFAULT_HER_SLEEP.fallbackBedtime,
    fallbackWake: typeof record.fallbackWake === 'string' && HHMM_RE.test(record.fallbackWake) ? record.fallbackWake : DEFAULT_HER_SLEEP.fallbackWake,
  };
}

export function readHerSleepState(saved: unknown): HerSleepSchedule | null {
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
  };
}

export function dayAfter(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
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
  const offset = daysBetween(schedule.day, dayKey);
  const fromMin = schedule.bedtime - offset * 1440;
  const toMin = schedule.wake + 1440 - offset * 1440;
  if (toMin <= fromMin || toMin <= 0 || fromMin >= 1440) return null;
  return { fromMin, toMin };
}

/** Whether she is asleep right now. `now` is expected to be a zoned date (zonedNow). */
export function herAsleep(schedule: HerSleepSchedule | null, now: Date): boolean {
  if (!schedule) return false;
  const window = sleepWindowOn(schedule, localDateKey(now));
  if (!window) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= window.fromMin && minutesNow < window.toMin;
}

/** How many of their messages fall inside the schedule's sleep window. */
export function messagesWhileAsleep(schedule: HerSleepSchedule, messages: { at?: string }[], timeZone: string): number {
  let count = 0;
  for (const message of messages) {
    if (!message.at) continue;
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
export function wakeNote(count: number, wakeAt: string): string {
  if (count <= 1) return '';
  if (count <= 3) return `You were asleep until ${wakeAt}. They texted you ${count} times while you slept, and you noticed. Be annoyed about it once, in your way — and then drop it.`;
  return `You were asleep until ${wakeAt}. They texted you ${count} times while you slept. You are properly annoyed about that — say so plainly, and hold it against them for a while.`;
}

/** The irritation a wake costs, on the thresholds wakeNote uses. */
export function wakeIrritation(count: number): number {
  if (count <= 1) return 0;
  if (count <= 3) return 1;
  return 2;
}

/**
 * Whether now is close enough to her bedtime that she would announce she is
 * turning in. `leadMinutes` before bedtime at the earliest, `floorMinutes`
 * before at the latest.
 */
export function goodnightDue(schedule: HerSleepSchedule, now: Date, leadMinutes = 75, floorMinutes = 10): boolean {
  if (herAsleep(schedule, now)) return false;
  const window = sleepWindowOn(schedule, localDateKey(now));
  if (!window) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const bedtime = schedule.bedtime - daysBetween(schedule.day, localDateKey(now)) * 1440;
  return minutesNow >= bedtime - leadMinutes && minutesNow < bedtime - floorMinutes;
}

/** The instruction handed to her when she decides, each evening. */
export function decideTimesSystem(now: Date): string {
  return `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())}. You are deciding when to go to bed tonight and when to get up tomorrow morning. Answer with exactly two 24-hour times separated by a space — tonight's bedtime first, tomorrow's wake-up second. Nothing else, no words.`;
}