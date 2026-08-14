// All helpers here work in local time. `Date#toISOString()` and `new Date('YYYY-MM-DD')`
// both convert through UTC, which shifts the calendar day near midnight in most timezones —
// exactly the kind of off-by-one that's easy to miss and wrong for a calendar view.

export function toISODate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseISODate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export interface CalendarCell { date: string; day: number; inMonth: boolean }

export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: toISODate(d), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

export function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function dayLabel(iso: string) {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** How much of the calendar you are looking at. */
export type CalendarView = 'day' | 'week' | 'month' | 'year';

export function shiftISODate(iso: string, days: number) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Sunday-first, matching the grid's own column order. */
export function startOfWeek(iso: string) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() - d.getDay());
  return toISODate(d);
}

export function weekOf(iso: string): string[] {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => shiftISODate(start, i));
}

/**
 * Every date the current view covers, so the agenda below can show the whole of
 * what is being looked at rather than only the one day that happens to be
 * selected. A week view listing a single day's items is the sort of thing that
 * reads as broken.
 */
export function datesInView(view: CalendarView, selected: string): (date: string) => boolean {
  if (view === 'day') return date => date === selected;
  if (view === 'week') { const days = new Set(weekOf(selected)); return date => days.has(date); }
  const [year, month] = selected.split('-');
  if (view === 'month') return date => date.startsWith(`${year}-${month}`);
  return date => date.startsWith(`${year}-`);
}

/** What the agenda calls the stretch it is showing. */
export function rangeLabel(view: CalendarView, selected: string) {
  if (view === 'day') return dayLabel(selected);
  if (view === 'week') {
    const days = weekOf(selected);
    const from = parseISODate(days[0]);
    const to = parseISODate(days[6]);
    const same = from.getMonth() === to.getMonth();
    const start = from.toLocaleDateString(undefined, { day: 'numeric', ...(same ? {} : { month: 'short' }) });
    return `${start} – ${to.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  }
  const [year, month] = selected.split('-').map(Number);
  if (view === 'month') return monthLabel(year, month - 1);
  return String(year);
}
