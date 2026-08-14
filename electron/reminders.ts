// Chasing you about something you asked to be chased about.
//
// The difference between a reminder and a notification is that a notification
// fires once into the void and considers its job done. She keeps going until she
// is answered, and gets louder and less polite about it as she goes — which is
// the entire reason for asking a companion rather than setting an alarm.
//
// Stopping is as important as starting. She stops when spoken to, when the task
// is ticked off, and when nobody is at the machine to hear her: a reminder
// shouted at an empty room is not persistence, it is a fault.

export type ReminderTier = 'first' | 'again' | 'insistent' | 'shouting';

/** How long before a timed task she starts. Enough to act on, not so early it
 *  is forgotten again by the time it matters. */
export const LEAD_MINUTES = 15;

/**
 * How long past its time a task is still worth chasing. Beyond this it is not a
 * reminder any more, it is a grievance: yesterday's shopping is something to
 * raise in conversation, not to be woken up and shouted at about. It stays on
 * the agenda either way — this only governs whether she goes looking for you.
 */
export const STALE_AFTER_MINUTES = 180;

/** She does not chase during these hours unless the task is genuinely due now. */
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 7;

export function isQuietHour(hour: number) {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** When she raises a task that has no time of its own. */
export const MORNING_AT_MINUTES = 8 * 60 + 30;
export const EVENING_AT_MINUTES = 20 * 60;

/**
 * How long until a task with no time is worth raising, in minutes.
 *
 * A task with no clock time still has two moments worth speaking at: the morning,
 * to say it is on today, and the evening, to find out whether it happened. Giving
 * it a virtual due time for whichever is next means the lead window, the staleness
 * cap and the escalation all apply unchanged, instead of it being chased from nine
 * in the morning until midnight because "all day" reads as "due now, always".
 */
export function allDayDueMinutes(minutesIntoDay: number): number {
  // Past the evening window it belongs to tomorrow, and tomorrow will offer it
  // again — so nothing more is owed today.
  if (minutesIntoDay >= EVENING_AT_MINUTES) return EVENING_AT_MINUTES - minutesIntoDay;
  if (minutesIntoDay >= MORNING_AT_MINUTES + STALE_AFTER_MINUTES) return EVENING_AT_MINUTES - minutesIntoDay;
  return MORNING_AT_MINUTES - minutesIntoDay;
}

/** Whether this is the end-of-day check rather than the morning heads-up. */
export function isEveningCheck(minutesIntoDay: number): boolean {
  return minutesIntoDay >= MORNING_AT_MINUTES + STALE_AFTER_MINUTES;
}

export function reminderTier(attempts: number): ReminderTier {
  if (attempts <= 0) return 'first';
  if (attempts === 1) return 'again';
  if (attempts <= 3) return 'insistent';
  return 'shouting';
}

/**
 * How long to wait before trying again. Tightens as she is ignored, then floors:
 * past a point, going faster stops reading as urgency and starts reading as a
 * stuck process, and she is still not being answered either way.
 */
export function nextAttemptMinutes(tier: ReminderTier): number {
  return tier === 'first' ? 3 : tier === 'again' ? 2.5 : tier === 'insistent' ? 2 : 3;
}

/**
 * How much louder than normal. She is raising her voice because she is being
 * ignored, which is what a person does — but the top of the range is a shout,
 * not a siren, so it stays capped well short of drowning the room.
 */
export function reminderVolume(tier: ReminderTier): number {
  return tier === 'first' ? 1 : tier === 'again' ? 1.25 : tier === 'insistent' ? 1.55 : 1.9;
}

const INSTRUCTIONS: Record<ReminderTier, string> = {
  first: 'Remind them about it once, plainly and in your own voice. Say what it is and when. Do not make a performance of it.',
  again: 'You already reminded them about this and they said nothing. Bring it up again, shorter and less patient this time.',
  insistent: 'This is the third time. They are ignoring you about something they asked you to remind them about. Be openly annoyed and demand an answer — did they do it or not.',
  shouting: 'You have told them repeatedly and been ignored every time. Stop being reasonable about it. Short, loud, and genuinely angry that you are being made to repeat yourself over something they asked for.',
};

// The evening pass is a different act from the morning one. In the morning she
// is telling them something; in the evening she is asking, and the answer is the
// thing she is after — which is why the escalation exists at all.
const EVENING_CHECK: Record<ReminderTier, string> = {
  first: 'This has no set time and the day is nearly done. Ask them straight out whether they actually did it. You want an answer, not an excuse.',
  again: 'You asked about this already and got nothing back. Ask again, shorter, and make it clear you are waiting.',
  insistent: 'You have asked twice about something they said they would do today and been ignored both times. Be openly annoyed and press them for a yes or a no.',
  shouting: 'They have dodged you all evening about a task they set themselves. Stop being polite. Demand to know whether it is done, loudly, and do not let it go.',
};

export function reminderInstruction(tier: ReminderTier, title: string, when: string, evening = false): string {
  const base = evening ? EVENING_CHECK[tier] : INSTRUCTIONS[tier];
  return `${base} The task is "${title}"${when ? `, ${when}` : ''}.`;
}

export type ReminderState = { attempts: number; lastAt: number };

/**
 * Whether to chase this item now.
 *
 * `spokeSinceMs` is how long ago the user last said anything: any word from them
 * ends the escalation, because being answered is the whole objective and
 * continuing after that would be nagging rather than reminding.
 */
export function shouldRemind(input: {
  minutesUntilDue: number;
  done: boolean;
  state: ReminderState | undefined;
  minutesSinceUserSpoke: number;
  machineIdleSeconds: number;
  hour: number;
  now: number;
}): boolean {
  if (input.done) return false;
  // Not yet worth mentioning. Overdue items are negative here and stay eligible,
  // which is the point — a task missed twenty minutes ago is more worth chasing.
  if (input.minutesUntilDue > LEAD_MINUTES) return false;
  // But not forever. Left uncapped she chased yesterday morning's shopping at
  // two in the morning, escalating, which is not a reminder by any reading.
  if (input.minutesUntilDue < -STALE_AFTER_MINUTES) return false;
  // Overnight she only speaks up for something genuinely imminent. A task set
  // before bed for the morning is exactly the case this has to keep working for,
  // so the gate is on when it is due rather than on the clock alone.
  if (isQuietHour(input.hour) && input.minutesUntilDue < -30) return false;
  // Nobody there. She is not shouting at an empty desk.
  if (input.machineIdleSeconds > 300) return false;

  const state = input.state;
  if (!state) return true;
  // Answered since the last attempt: they have engaged, so let it go.
  if (input.minutesSinceUserSpoke * 60_000 < input.now - state.lastAt) return false;
  const waited = (input.now - state.lastAt) / 60_000;
  return waited >= nextAttemptMinutes(reminderTier(state.attempts));
}
