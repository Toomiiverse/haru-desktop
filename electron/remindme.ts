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


/**
 * A reminder she promised in her own words.
 *
 * "I'll set the reminder at 6:54 AM sharp — don't be late." Twice in one
 * evening, and nothing was written: the time was in her offer and the user
 * only said "yes please", so reminderAsk above had nothing to read, and the
 * model never called the tool. Her promise is the plainest possible statement
 * of what should exist, so it is read back off her reply and kept — the one
 * case where her output, not their input, is the source, because the
 * alternative is a reminder that exists only in the conversation.
 */
const PROMISED = /\b(?:i(?:'|’)?ll|i will|i(?:'|’)?ve|i have|consider it|reminder(?:'s| is)?)\s+(?:go(?:ing)? (?:to|and) )?(?:(?:set|put|add|write|note|log)(?:ting)?\s+(?:you\s+)?(?:up\s+)?(?:a |the |that |your )?(?:reminder|alarm|note)s?\s*(?:down\s+)?(?:for|at|@)|remind(?:ing)?\s+you\s+(?:about\s+\S+\s+)?(?:at|@|for)|set(?:ting)?\s+(?:for|at|@))\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/i;

export function reminderPromised(herReply: string, now: Date): { time: string; date: string } | null {
  const m = PROMISED.exec((herReply ?? '').replace(/[‘’]/g, "'"));
  if (!m) return null;
  const raw = m[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
  const parts = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(raw);
  if (!parts) return null;
  let hour = Number(parts[1]); const minute = Number(parts[2] ?? '0');
  if (hour > 23 || minute > 59) return null;
  const meridiem = parts[3];
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  // No meridiem: the next reading of that clock from now.
  if (!meridiem && hour <= 12) {
    const asIs = hour * 60 + minute, later = (hour + 12) * 60 + minute, nowMin = now.getHours() * 60 + now.getMinutes();
    if (asIs <= nowMin && hour < 12 && later > nowMin) hour += 12;
  }
  const when = new Date(now.getTime()); when.setHours(hour, minute, 0, 0);
  const tomorrow = /\btomorrow\b/i.test(herReply) || when.getTime() <= now.getTime();
  if (tomorrow && when.getTime() <= now.getTime() + 60_000) when.setDate(when.getDate() + 1);
  else if (tomorrow && /\btomorrow\b/i.test(herReply) && when.getDate() === now.getDate()) when.setDate(when.getDate() + 1);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { time: `${h12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`, date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` };
}

/** What the reminder is for, from what they said: the last thing with a time or an obligation in it. */
export function promisedTitle(theirRecent: string[]): string {
  const said = [...theirRecent].reverse().find(text => text.trim().split(/\s+/).length >= 4 && !/^(?:yes|yeah|yep|sure|ok(?:ay)?|please|do it|go on|thanks)\b/i.test(text.trim()) && !/\?\s*$/.test(text.trim()));
  if (!said) return 'What you asked her to remind you about';
  const cut = said.replace(/^(?:kinda sucks because |it sucks because |well,? |so,? |anyway,? )/i, '').replace(/^i (?:have|need|\'ve got|got|ve got) to /i, '').replace(/\s+as we have .*$/i, '').replace(/\s+because .*$/i, '').trim();
  const title = cut.charAt(0).toUpperCase() + cut.slice(1);
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title;
}


/**
 * She offered, they said yes: that is a reminder.
 *
 * "I'll remind you at 6:54 AM if you need it." / "Yes please." The offer has
 * the time and their answer has the consent, and neither message on its own
 * reads as a request — so nothing was written and she said "done" to an
 * empty list. Read together, before she answers, so her reply is about a
 * reminder that exists.
 */
const OFFERED = /\b(?:(?:want|like|need) me to|shall i|should i|do you want (?:me to |a )?|i(?:'|’)?ll|i can|i could)\s+(?:set (?:you )?(?:up )?(?:a |the )?(?:reminder|alarm)(?: for you)?\s*(?:for|at|@)|remind you(?: about \S+(?: \S+){0,4})?\s+(?:at|@|for)|(?:set|wake you|nudge you|ping you)\s+(?:up\s+)?(?:for|at|@))\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/i;

export function reminderOffered(herLine: string, now: Date): { time: string; date: string } | null {
  const line = (herLine ?? '').replace(/[‘’]/g, "'");
  if (!OFFERED.test(line)) return null;
  // Same clock reading as a promise, once the offer's shape has been recognised.
  const m = OFFERED.exec(line)!;
  return reminderPromised(`I'll set the reminder at ${m[1]}${/\btomorrow\b/i.test(line) ? ' tomorrow' : ''}`, now);
}

/** "Yes please", "sure", "do it", "you can set a reminder for me can't you" — consent, not a new ask. */
export function acceptsOffer(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[!.]+$/, '');
  if (!t || t.length > 90) return false;
  if (/^(?:yes|yeah|yep|yup|ya|sure|ok|okay|please|please do|yes please|do it|go on|go for it|sounds good|that works|do that|thanks|thank you|alright|all right|fine)(?:[,!. ]+(?:please|thanks|haru|do it|go on|that would be great))*\s*(?:haru)?$/i.test(t)) return true;
  return /\b(?:you can|can you|could you|would you|will you)\b.*\b(?:reminder|remind|alarm)\b/i.test(t) || /\bset (?:it|one|that)\b/i.test(t);
}

/**
 * A reminder made of her offer and their yes, or null. `herPrevious` is her
 * last reply before this message of theirs; `theirRecent` their last few.
 */
export function acceptedOffer(latest: string, herPrevious: string | undefined, theirRecent: string[], now: Date): ReminderAsk | null {
  if (!herPrevious || !acceptsOffer(latest)) return null;
  const offer = reminderOffered(herPrevious, now);
  if (!offer) return null;
  return { title: promisedTitle(theirRecent), date: offer.date, time: offer.time };
}
