// Pure date helpers for the main process. Deliberately free of electron imports
// so the logic can be exercised directly in plain Node.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A month by name, as a capturing group — "oct", "october", "sept". Shared with the reminder patterns so they agree on what a date looks like. */
export const MONTH_PATTERN = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase());

/**
 * A real calendar day as written on a record: YYYY-MM-DD and nothing else.
 * The round trip through toISOString is what refuses "2026-02-30" — V8 parses
 * it as 2 March, and a memory dated that way would render as a day that was
 * never said. One helper for the sorter, the blocks and search_chats alike, so
 * a date the tool would refuse cannot be stored on a record by another door.
 */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

// Reads the wall-clock date/time in `timeZone` as local Date fields, so day-boundary
// math (getDate/getHours/etc.) reflects that zone regardless of the OS's own timezone.
export function zonedNow(timeZone: string, at: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return new Date(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

export function localDateKey(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Kept items store a human time like "8:00 AM"; Google Calendar wants 24-hour
// clock fields. These two are the boundary between the formats.
export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const text = input.trim().toLowerCase().replace(/\./g, '');
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return { hour, minute };
}

export function formatTimeOfDay(hour: number, minute: number) {
  const meridiem = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

// Date arithmetic is done here, not by the model. Asked to convert "thursday"
// into a calendar date the model was reliably a day out, and spelling the whole
// calendar out in the prompt did not fix it — so the chat tool passes the user's
// own wording through and this resolves it, which is deterministic and testable.
export function resolveDate(input: string, now: Date): string | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (days: number) => { const day = new Date(today); day.setDate(day.getDate() + days); return localDateKey(day); };

  if (text === 'today' || text === 'tonight') return shift(0);
  if (text === 'tomorrow') return shift(1);
  if (/^(the )?day after tomorrow$/.test(text)) return shift(2);
  const inDays = text.match(/^in (\d{1,3}) days?$/);
  if (inDays) return shift(Number(inDays[1]));

  const weekday = text.match(/^(this |next |on |this coming )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekday) {
    const delta = (WEEKDAYS.indexOf(weekday[2]) - today.getDay() + 7) % 7;
    // "next thursday" said on a Thursday means the following week, not today.
    return shift(weekday[1]?.trim() === 'next' && delta === 0 ? 7 : delta);
  }

  const dayOfMonth = text.match(/^(?:the )?(\d{1,2})(?:st|nd|rd|th)?$/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      const candidate = new Date(today.getFullYear(), today.getMonth(), day);
      // A day-of-month already past refers to next month.
      if (candidate.getTime() < today.getTime()) candidate.setMonth(candidate.getMonth() + 1);
      // Guards against overflow, e.g. the 31st rolling into the next month.
      if (candidate.getDate() === day) return localDateKey(candidate);
    }
  }

  // A calendar date: "the 6th of october", "6 oct", "october 6th", "oct 6, 2027",
  // "6/10" (day first, as it is written here). Nothing above read one, so
  // "remind me to do my car registration on the 6th of October" was filed for
  // the day it was said with the date left in the title (2026-09-11). Without a
  // year, a date already past is next year's.
  const dayFirst = text.match(new RegExp(`^(?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${MONTH_PATTERN}(?:,? (\\d{4}))?$`, 'i'));
  const monthFirst = text.match(new RegExp(`^(?:on )?${MONTH_PATTERN} (?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$`, 'i'));
  const numeric = text.match(/^(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  const parts = dayFirst ? { day: Number(dayFirst[1]), month: monthIndex(dayFirst[2]), year: dayFirst[3] }
    : monthFirst ? { day: Number(monthFirst[2]), month: monthIndex(monthFirst[1]), year: monthFirst[3] }
    : numeric ? { day: Number(numeric[1]), month: Number(numeric[2]) - 1, year: numeric[3] } : null;
  if (parts && parts.month >= 0 && parts.month <= 11 && parts.day >= 1 && parts.day <= 31) {
    const year = parts.year ? Number(parts.year.length === 2 ? `20${parts.year}` : parts.year) : today.getFullYear();
    const candidate = new Date(year, parts.month, parts.day);
    if (!parts.year && candidate.getTime() < today.getTime()) candidate.setFullYear(year + 1);
    if (candidate.getDate() === parts.day) return localDateKey(candidate);
  }
  return null;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const RELATIVE = new RegExp([
  'the day before yesterday', 'the day after tomorrow', 'yesterday', 'last night', 'tomorrow',
  '(?:last|next) (?:week|month|year)',
  `(?:last|next) (${WEEKDAYS.join('|')})`,
  `(\\d{1,3}|${Object.keys(COUNTS).join('|')}) (day|week|month|year)s? ago`,
].map(part => `\\b${part}\\b`).join('|'), 'gi');

/**
 * "Yesterday" in a message from three weeks ago, with the day it meant written
 * beside it: `yesterday (Mon 1 Sep)`.
 *
 * An old exchange is shown dated, but the words inside it still count from the
 * day they were said, and the reader counts from today — the same mistake that
 * had her do calendar sums in her head and land a day out (see resolveDate).
 * So the sum is done here, once, for the phrases that fix a day, a week, a month
 * or a year. What they do not fix is left alone: "today" is the date already on
 * the exchange, and a bare "friday" could be either side of it depending on the
 * tense around it.
 */
export function withRelativeDates(text: string, dayKey: string): string {
  const said = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!said || !text) return text;
  const base = Date.UTC(Number(said[1]), Number(said[2]) - 1, Number(said[3]));
  const on = (days: number) => new Date(base + days * 86_400_000);
  const day = (date: Date) => `${SHORT_DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`;
  const week = (date: Date) => `week of ${day(on(Math.round((date.getTime() - base) / 86_400_000) - ((date.getUTCDay() + 6) % 7)))}`;
  const month = (shift: number) => {
    const date = new Date(Date.UTC(Number(said[1]), Number(said[2]) - 1 + shift, 1));
    return date.getUTCFullYear() === Number(said[1]) ? LONG_MONTHS[date.getUTCMonth()] : `${LONG_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  };
  const year = Number(said[1]);
  return text.replace(RELATIVE, (phrase: string, weekday?: string, count?: string, unit?: string) => {
    const words = phrase.toLowerCase().replace(/\s+/g, ' ');
    let meant: string | null = null;
    if (words === 'the day before yesterday') meant = day(on(-2));
    else if (words === 'the day after tomorrow') meant = day(on(2));
    else if (words === 'yesterday' || words === 'last night') meant = day(on(-1));
    else if (words === 'tomorrow') meant = day(on(1));
    else if (words === 'last week') meant = week(on(-7));
    else if (words === 'next week') meant = week(on(7));
    else if (words === 'last month') meant = month(-1);
    else if (words === 'next month') meant = month(1);
    else if (words === 'last year') meant = String(year - 1);
    else if (words === 'next year') meant = String(year + 1);
    else if (weekday) {
      const today = on(0).getUTCDay();
      const wanted = WEEKDAYS.indexOf(weekday.toLowerCase());
      // Last friday said on a Friday is a week back; next friday, a week on.
      meant = words.startsWith('last') ? day(on(-(((today - wanted + 7) % 7) || 7))) : day(on(((wanted - today + 7) % 7) || 7));
    } else if (count && unit) {
      const many = COUNTS[count.toLowerCase()] ?? Number(count);
      const kind = unit.toLowerCase();
      if (kind === 'day') meant = day(on(-many));
      else if (kind === 'week') meant = week(on(-7 * many));
      else if (kind === 'month') meant = month(-many);
      else meant = String(year - many);
    }
    return meant ? `${phrase} (${meant})` : phrase;
  });
}
