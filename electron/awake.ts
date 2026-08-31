// Whether they are up yet.
//
// The quiet hours ending means she may speak; it does not mean they are awake.
// Read as an alarm clock, it had her buzzing them at 06:02 and, by half seven,
// blaming them for "nine hours of radio silence" — most of it sleep. So the
// morning waits for a sign of life: a message, the phone page opened, the desk
// in use. Failing all of those, a deadline — the hour they have said they are
// up by — after which she assumes they are and the day begins.

import type { PushPrefs } from './push';

/** When the quiet ended most recently, or null when there are no quiet hours. */
export function quietEndedAt(prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo'>, now: Date): Date | null {
  if (prefs.quietFrom === prefs.quietTo) return null;
  const [hour, minute] = prefs.quietTo.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const ended = new Date(now.getTime());
  ended.setHours(hour, minute, 0, 0);
  if (ended.getTime() > now.getTime()) ended.setDate(ended.getDate() - 1);
  return ended;
}

/** The hour they say they are up by, on the same clock — today's, or null if unset. */
export function upByAt(prefs: Pick<PushPrefs, 'upBy'>, now: Date): Date | null {
  const [hour, minute] = (prefs.upBy ?? '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const at = new Date(now.getTime());
  at.setHours(hour, minute, 0, 0);
  return at;
}

export type Signs = {
  /** Their last message to her. */
  lastMessageAt?: string;
  /** The phone page last opened. */
  lastOpenedAt?: string;
  /** The desk's latest activity entry. */
  lastActivityAt?: string;
};

/**
 * Up, as far as she can tell. Any sign of life since the quiet ended counts;
 * with none, the deadline decides. With no quiet hours at all there is no
 * night to have slept through, so the answer is yes.
 */
export function theyAreUp(signs: Signs, prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo' | 'upBy'>, now: Date): boolean {
  const ended = quietEndedAt(prefs, now);
  if (!ended) return true;
  const since = ended.getTime();
  const seen = [signs.lastMessageAt, signs.lastOpenedAt, signs.lastActivityAt]
    .map(value => Date.parse(value ?? ''))
    .some(at => Number.isFinite(at) && at >= since && at <= now.getTime() + 60_000);
  if (seen) return true;
  const deadline = upByAt(prefs, now);
  // The deadline only counts on the morning after this quiet: at 23:30 with
  // an 09:00 deadline, "past nine" is not "up".
  return deadline !== null && deadline.getTime() >= since && now.getTime() >= deadline.getTime();
}

/** Hours of their silence that are actually theirs: none of it counted while asleep. */
/** The same in minutes, for a silence under an hour — "480 minutes" at breakfast is the night, not a silence. */
export function awakeMinutesSince(lastMessageAt: string | undefined, prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo'>, now: Date): number | null {
  const spoke = Date.parse(lastMessageAt ?? '');
  if (!Number.isFinite(spoke)) return null;
  const ended = quietEndedAt(prefs, now);
  const from = ended && ended.getTime() > spoke ? ended.getTime() : spoke;
  return Math.max(0, Math.round((now.getTime() - from) / 60_000));
}

export function awakeHoursSince(lastMessageAt: string | undefined, prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo'>, now: Date): number | null {
  const spoke = Date.parse(lastMessageAt ?? '');
  if (!Number.isFinite(spoke)) return null;
  const ended = quietEndedAt(prefs, now);
  const from = ended && ended.getTime() > spoke ? ended.getTime() : spoke;
  return Math.max(0, Math.floor((now.getTime() - from) / 3_600_000));
}
