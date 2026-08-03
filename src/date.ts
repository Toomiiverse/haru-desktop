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
