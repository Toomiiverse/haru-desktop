import {corePolicySync} from './core-policy-sync';
import {agendaClock} from './core-agenda-lifecycle';
// Something on the calendar, an hour out and then a quarter of an hour out.
//
// The task chaser (reminders.ts) deals in what is due and overdue and how
// many times she has said so; this is the plainer thing before that — a heads
// up at set leads for anything with a time today, event or task, once per lead.

export type Dated = { id: string; title: string; date: string; time?: string; kind?: string; done?: boolean };
export type Upcoming = { item: Dated; inMinutes: number; lead: number };

export const LEADS_MIN = [60, 15] as const;
/** A lead fires within this many minutes after its mark, so a 5-minute tick cannot miss it. */
const LEAD_SLACK_MIN = 10;

function parseTime(time: string): number | null {
  const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]); const minute = Number(m[2] ?? 0);
  const half = m[3]?.toLowerCase();
  if (half === 'pm' && hour < 12) hour += 12;
  if (half === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function upcomingToMention(items: Dated[], now: Date, todayKey: string, marked: Record<string, number[]>): Upcoming | null {
  return corePolicySync<any>('agenda-life.upcoming',[items,agendaClock(now),todayKey,marked]);
}

export function markMentioned(marked: Record<string, number[]>, id: string, lead: number, keep: string[]): Record<string, number[]> {
  return corePolicySync<any>('agenda-life.markUpcoming',[marked,id,lead,keep]);
}
