// What she brings up when nothing on their list needs her.
//
// Left alone with nothing to chase, she does not sit quietly; she reaches for
// something she knows — a person in their life, a thing they were doing, a
// day they had — and needles them with it until they answer. This picks the
// something. Pure: memories and days in, one of them out, and the last few
// she used kept out of the draw so a long silence does not get the same jab
// four times.

export type Remembered = { id: string; text: string; kind?: string; status?: string; importance?: number };
export type Day = { day: string; summary: string };
export type Something = { id: string; text: string; from: 'memory' | 'day' };

/** Days this far back are still worth a remark; older than that is memories' job. */
export const DAYS_WORTH_RAISING = 10;
/** How many recent picks are kept out of the next draw. */
export const REMEMBERED_PICKS = 6;

const dayDistance = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * A memory that is about her, or about nothing — "they are thanking you",
 * "nothing notable", "Discord opened and closed" — is no material for a jab
 * at their life. The store keeps these; this draw does not.
 */
const NOTHING_TO_SAY = /\b(haru|you are|you're|helpful|thank(s|ing|ed)?|noted|nothing notable|opened and closed|no issues|not shared)\b/i;
/** A preference wearing a fact's clothes — how they like to be treated is not a thing about their life either. */
const HOW_TO_TREAT_THEM = /\b(does not (want|like)|doesn'?t (want|like)|prefers? not|wants? (haru|you|to be)|likes? to be|corrected|reminded of tasks)\b/i;
const MIN_WORDS = 4;
/** Memories with no score are taken as middling; a day's summary sits above most of them. */
const DEFAULT_IMPORTANCE = 0.5, DAY_IMPORTANCE = 0.6;

export function pickToBringUp(memories: Remembered[], days: Day[], recent: string[], todayKey: string, random: () => number = Math.random): Something | null {
  const worth = (text: string) => text.trim().split(/\s+/).length >= MIN_WORDS && !NOTHING_TO_SAY.test(text) && !HOW_TO_TREAT_THEM.test(text);
  const facts = memories
    .filter(m => m.text && worth(m.text) && (m.status === undefined || m.status === 'active') && m.kind !== 'preference')
    .map(m => ({ thing: { id: m.id, text: m.text.trim(), from: 'memory' as const }, weight: m.importance ?? DEFAULT_IMPORTANCE }));
  const recentDays = days
    .filter(d => d.summary && d.day && d.day < todayKey && dayDistance(d.day, todayKey) <= DAYS_WORTH_RAISING && worth(d.summary))
    .map(d => ({ thing: { id: `day:${d.day}`, text: d.summary.trim(), from: 'day' as const }, weight: DAY_IMPORTANCE }));
  const all = [...facts, ...recentDays].filter(entry => entry.weight > 0);
  if (!all.length) return null;
  const fresh = all.filter(entry => !recent.includes(entry.thing.id));
  const pool = fresh.length ? fresh : all;
  // Weighted by how much it matters: what she has to say about their
  // girlfriend or their company should come up more than the HDMI cable.
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of pool) { roll -= entry.weight; if (roll < 0) return entry.thing; }
  return pool[pool.length - 1].thing;
}
