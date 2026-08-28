// What she brings up when nothing on their list needs her.
//
// Left alone with nothing to chase, she does not sit quietly; she reaches for
// something she knows — a person in their life, a thing they were doing, a
// day they had — and needles them with it until they answer. This picks the
// something. Pure: memories and days in, one of them out, and the last few
// she used kept out of the draw so a long silence does not get the same jab
// four times.

export type Remembered = { id: string; text: string; kind?: string; status?: string };
export type Day = { day: string; summary: string };
export type Something = { id: string; text: string; from: 'memory' | 'day' };

/** Days this far back are still worth a remark; older than that is memories' job. */
export const DAYS_WORTH_RAISING = 10;
/** How many recent picks are kept out of the next draw. */
export const REMEMBERED_PICKS = 6;

const dayDistance = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function pickToBringUp(memories: Remembered[], days: Day[], recent: string[], todayKey: string, random: () => number = Math.random): Something | null {
  const facts: Something[] = memories
    .filter(m => m.text && m.text.trim().length >= 12 && (m.status === undefined || m.status === 'active') && m.kind !== 'preference')
    .map(m => ({ id: m.id, text: m.text.trim(), from: 'memory' as const }));
  const recentDays: Something[] = days
    .filter(d => d.summary && d.day && d.day < todayKey && dayDistance(d.day, todayKey) <= DAYS_WORTH_RAISING)
    .map(d => ({ id: `day:${d.day}`, text: d.summary.trim(), from: 'day' as const }));
  const all = [...facts, ...recentDays];
  if (!all.length) return null;
  const fresh = all.filter(s => !recent.includes(s.id));
  const pool = fresh.length ? fresh : all;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
