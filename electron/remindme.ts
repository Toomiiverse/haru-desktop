// "Remind me to eat at 12" — written down before she is even asked.
//
// Saving a reminder used to rest on the model choosing to call the tool, and a
// 9B model asked to set one at noon said "12:00 PM it is" and called nothing:
// the user waited for a reminder that did not exist. A request this plain has
// one reading, so it is read here, deterministically, and the item exists by
// the time she composes her reply — she is told it is already on the list and
// only has to say so in her own way.
//
// Only the plain forms are taken. Anything with judgement in it ("remind me
// about the thing we discussed", a reminder with no task named, a question)
// still goes to the model and its tool, which can ask.

import { formatTimeOfDay, localDateKey, parseTimeOfDay, resolveDate } from './dates';

export type ReminderAsk = { title: string; date: string; time?: string };

/** The ask itself, at the start of the message; what follows is the task and when. */
const TRIGGER = /^(?:please |can you |could you |haru,? )?(?:set (?:me )?(?:up )?(?:a |an )?(?:reminder|alarm|timer)|remind me|reminder)\b(.*)$/i;
/** "in 20 minutes", "in 2 hours" — a clock time from now. */
const IN = /(?:^|\s)(?:in|for)\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i;
/** "today", "tomorrow", "on monday", "next friday" — anywhere in the clause. */
const DAY = /(?:^|\s)((?:the )?day after tomorrow|today|tonight|tomorrow|(?:this |next |on )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i;
/** "@12", "at 12:30", "by 5pm"; "for" only with an unmistakable clock ("for 12pm", "for 9:30"). */
const AT = /(?:^|\s)(?:@\s*|at\s+|by\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)(?![\d:])(?!\s*(?:minutes?|mins?|hours?|hrs?)\b)|(?:^|\s)for\s+(\d{1,2}(?::\d{2}\s*(?:am|pm)?|\s*(?:am|pm)))\b/i;
const CONNECTOR = /^(?:to|that i need to|that i have to|that i should|that i|for|about|:|,|-)\s+/i;

/** A time said without am/pm: the next time that clock reading comes round today. */
function nextReading(hour: number, minute: number, now: Date, explicit: boolean): { hour: number; minute: number } {
  if (explicit || hour === 0 || hour > 12) return { hour, minute };
  // "12" on its own is noon, and stays noon even at half past.
  if (hour === 12) return { hour, minute };
  const intoDay = now.getHours() * 60 + now.getMinutes();
  return hour * 60 + minute > intoDay ? { hour, minute } : { hour: hour + 12, minute };
}

function tidy(task: string): string {
  let out = task.replace(/\s+/g, ' ').trim();
  for (let guard = 0; guard < 3; guard++) out = out.replace(CONNECTOR, '').trim();
  out = out.replace(/^[,:;-]\s*|[.!,;:\s-]+$/g, '').trim();
  return out;
}

/**
 * The reminder in a message, if it is one. `now` is in the user's timezone
 * (zonedNow), so "in 20 minutes" and a bare "at 5" resolve against their clock.
 */
export function reminderAsk(text: string, now: Date): ReminderAsk | null {
  const line = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!line || line.length > 240 || line.includes('?')) return null;
  const m = line.match(TRIGGER);
  if (!m) return null;
  let rest = m[1].trim();
  const todayKey = localDateKey(now);
  let date = todayKey;
  let time: string | undefined;

  const relative = rest.match(IN);
  if (relative) {
    const amount = Number(relative[1]);
    const minutes = /^h/i.test(relative[2]) ? amount * 60 : amount;
    if (!minutes || minutes > 24 * 60) return null;
    const at = new Date(now.getTime() + minutes * 60_000);
    date = localDateKey(at);
    time = formatTimeOfDay(at.getHours(), at.getMinutes());
    rest = rest.replace(relative[0], ' ');
  }

  const day = rest.match(DAY);
  if (day) {
    const resolved = resolveDate(day[1].toLowerCase().replace(/^on /, ''), now);
    if (!resolved) return null;
    date = resolved;
    rest = rest.replace(day[0], ' ');
  }

  const clock = relative ? null : rest.match(AT);
  if (clock) {
    const said = (clock[1] ?? clock[2]).toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    const parsed = parseTimeOfDay(said);
    if (!parsed) return null;
    const explicit = /am|pm/.test(said) || Number(said.split(':')[0]) > 12;
    // Today's bare hour is the next reading of that clock; on another day a
    // small bare hour is the afternoon one — "tomorrow at 4" is not 4am.
    const reading = date === todayKey ? nextReading(parsed.hour, parsed.minute, now, explicit)
      : !explicit && parsed.hour >= 1 && parsed.hour <= 6 ? { hour: parsed.hour + 12, minute: parsed.minute } : parsed;
    time = formatTimeOfDay(reading.hour, reading.minute);
    rest = rest.replace(clock[0], ' ');
  }

  const task = tidy(rest) || (relative && /\b(timer|alarm)\b/i.test(line) ? 'Timer' : '');
  if (!task || task.split(' ').length > 14 || /^(me|it|that|this|something|about it|again|later)$/i.test(task)) return null;
  return { title: task.charAt(0).toUpperCase() + task.slice(1), date, ...(time ? { time } : {}) };
}

/** What she is told, so the reply matches what was actually saved. */
export function reminderSavedAside(ask: ReminderAsk, todayKey: string): string {
  const day = ask.date === todayKey ? 'today' : `on ${ask.date}`;
  const when = ask.time ? `${day} at ${ask.time}` : day;
  return `This is already written down: "${ask.title}", ${when}. It is on the list and you will chase them about it when it comes round. Confirm it in your own way in one short line — do not offer to set it, do not call a tool for it, and do not change the time.`;
}
