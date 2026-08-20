// Pure date helpers for the main process. Deliberately free of electron imports
// so the logic can be exercised directly in plain Node.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Reads the wall-clock date/time in `timeZone` as local Date fields, so day-boundary
// math (getDate/getHours/etc.) reflects that zone regardless of the OS's own timezone.
export function zonedNow(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return new Date(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

export function localDateKey(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  return null;
}

// Reminder times arrive as the user's own wording, passed straight through by the
// chat tool ("8:00 AM", "8pm", "20:30"), so they are parsed here rather than
// constrained at the tool boundary — the model is worse at reformatting a time
// than at repeating one.
export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^at /, '');
  if (text === 'noon' || text === 'midday') return { hour: 12, minute: 0 };
  if (text === 'midnight') return { hour: 0, minute: 0 };
  const match = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.replace(/\./g, '');
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

// Turns a kept item's stored date and free-form time into the concrete moment it
// comes due. All-day items resolve to `allDayHour` rather than midnight, which
// would fire while the user is asleep; an unparseable time falls back there too,
// since the user still asked to be reminded that day.
export function dueDateTime(date: string, time: string | undefined, allDayHour: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const clock = (time && parseTimeOfDay(time)) || { hour: allDayHour, minute: 0 };
  const due = new Date(year, month - 1, day, clock.hour, clock.minute, 0, 0);
  return Number.isNaN(due.getTime()) ? null : due;
}
