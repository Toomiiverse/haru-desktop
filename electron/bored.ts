// What she brings up when nothing on their list needs her.
//
// Left alone with nothing to chase, she does not sit quietly; she reaches for
// something she knows — a person in their life, a thing they were doing, a
// day they had — and needles them with it until they answer. This picks the
// something. Pure: memories and days in, one of them out, and the last few
// she used kept out of the draw so a long silence does not get the same jab
// four times.

export type Remembered = { id: string; text: string; kind?: string; category?: string; status?: string; importance?: number; lastSeenAt?: string; createdAt?: string };

/** An event is on her mind for this long; after that it is a thing that happened, not a thing to raise. */
export const EVENT_FRESH_DAYS = 3;
/**
 * A fact written as a live observation goes stale as fast as an event does.
 *
 * "They are currently designing clothing in a 3D modeling software and have
 * taken 20 screenshots of their work" was five days old, filed as a `fact`, and
 * so never aged out — the draw handed it over in the present tense and she sent
 * "you've had 29 minutes to send a screenshot of that 3D modeling nonsense" to a
 * man at breakfast, about a screenshot he had never promised (2026-09-20).
 * Durable facts — where they work, what hardware they own — are not this; a
 * snapshot of what was on their screen an hour ago is.
 */
export const SNAPSHOT_FRESH_DAYS = 1;
export type Day = { day: string; summary: string };
export type Something = { id: string; text: string; from: 'memory' | 'day' | 'task'; daysOld?: number; perishable?: boolean };

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
/**
 * The shape of a moment written down as though it were permanent: "currently",
 * "right now", "is playing", "have taken 20 screenshots". The extractor writes
 * what it saw on the screen in the present continuous and the store keeps it
 * forever, so the tense has to be what dates it.
 */
const SNAPSHOT = /\b(currently|right now|at the moment|just now|today|this (?:morning|afternoon|evening))\b|\b(?:is|are|was|were)\s+\w+ing\b|\bhave taken \d+\b|\b\d+ screenshots?\b|\bhas \d+ .{0,20}\bopen\b/i;
/** Memories with no score are taken as middling; a day's summary sits above most of them. */
const DEFAULT_IMPORTANCE = 0.5, DAY_IMPORTANCE = 0.6;

/**
 * Whether this is the kind of thing that stops being true.
 *
 * What they are partway through, what happened on a day, what they were doing
 * when she last looked. Not who they live with, what company they founded or
 * what they have been diagnosed with — dating those was worse than the fault
 * it was meant to fix: "Is in a relationship with Emma Wilson since 18th of
 * June, 2024 (you last saw this 30 days ago — it is what was true then)" invites
 * her to hedge about his girlfriend, and 25 of the 36 topics in the draw were
 * being stamped that way.
 */
const PERISHABLE = new Set(['ongoing', 'event', 'plan']);

function perishes(memory: Remembered): boolean {
  if (memory.category) return PERISHABLE.has(memory.category);
  // Before the sorter has placed it, the kind and the wording are all there is.
  return memory.kind === 'event' || SNAPSHOT.test(memory.text ?? '');
}

/**
 * How old the thing she is about to raise actually is.
 *
 * The draw hands her the text and nothing else, so a fact from Tuesday reads
 * exactly like a fact from ten minutes ago and she speaks it as live — "you've
 * had 29 minutes to send a screenshot of that 3D modeling nonsense" about a
 * screen she last saw five days earlier. A day's summary already reads as past;
 * a memory does not, so only a memory gets dated.
 *
 * Whose it is has to be said first. The first wording ran "it is what was true
 * then, not what they are doing now", and the very first nudge to carry it came
 * back as "I spent the last 21 minutes staring at a RAM stick on a Gigabyte
 * board, trying to figure out why it wouldn't POST" — his evening, told back as
 * hers (2026-09-20). Told only that a thing is not what they are doing, she
 * found someone else for it to belong to, and the six nudges before that one,
 * with no date on them at all, were all correctly about him.
 */
export function ageNote(thing: Something | null | undefined): string {
  if (!thing || thing.from !== 'memory' || !thing.perishable) return '';
  const days = thing.daysOld ?? 0;
  if (days <= 1) return '';
  return ` (theirs, and you last saw it ${days} days ago — so talk about it as something of theirs you noticed then, not as what they are doing this minute, and never as something they owe you)`;
}

export function pickToBringUp(memories: Remembered[], days: Day[], recent: string[], todayKey: string, random: () => number = Math.random): Something | null {
  const worth = (text: string) => text.trim().split(/\s+/).length >= MIN_WORDS && !NOTHING_TO_SAY.test(text) && !HOW_TO_TREAT_THEM.test(text);
  const ageOf = (m: Remembered) => dayDistance((m.lastSeenAt ?? m.createdAt ?? '').slice(0, 10) || todayKey, todayKey);
  const facts = memories
    .filter(m => m.text && worth(m.text) && (m.status === undefined || m.status === 'active') && m.kind !== 'preference')
    // A week-old plan raised as "the store cleaning you're avoiding" was a
    // memory of an event that had long since happened. Events go stale, and so
    // does anything phrased as what they are doing this minute.
    .filter(m => m.kind !== 'event' || ageOf(m) <= EVENT_FRESH_DAYS)
    .filter(m => !SNAPSHOT.test(m.text) || ageOf(m) <= SNAPSHOT_FRESH_DAYS)
    .map(m => ({ thing: { id: m.id, text: m.text.trim(), from: 'memory' as const, daysOld: Math.max(0, ageOf(m)), perishable: perishes(m) }, weight: m.importance ?? DEFAULT_IMPORTANCE }));
  const recentDays = days
    .filter(d => d.summary && d.day && d.day < todayKey && dayDistance(d.day, todayKey) <= DAYS_WORTH_RAISING && worth(d.summary))
    .map(d => ({ thing: { id: `day:${d.day}`, text: d.summary.trim(), from: 'day' as const, daysOld: Math.max(0, dayDistance(d.day, todayKey)) }, weight: DAY_IMPORTANCE }));
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

/** How far back her own openings are held against her. */
export const OPENINGS_DAYS = 5;
/** How many of them the prompt carries. */
export const OPENINGS_LIMIT = 8;

/** The first clause of a line — the part that sets its shape. */
function opening(text: string): string {
  const first = (text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s|\s[\u2014\u2013]\s|,\s/)[0] ?? '';
  if (first.length <= 62) return first;
  const cut = first.slice(0, 62);
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}\u2026`;
}

/** How many words in make a shape; past that it is the same sentence with more on the end. */
const SHAPE_WORDS = 7;

/**
 * Two openings are the same shape when only the nouns and numbers differ.
 *
 * The placeholders are upper case and the punctuation comes off first — strip
 * it last and the strip eats them, which is how six identical openings came
 * back as six distinct shapes the first time this ran.
 */
export function shapeOf(text: string): string {
  return opening(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\b\d+\b/g, '#')
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fourty|fifty|sixty)(?:\s+(?:one|two|three|four|five|six|seven|eight|nine))?\b/g, '#')
    .replace(/\ban?\b/g, '#')
    .replace(/\b(?:minutes?|hours?|seconds?|days?|weeks?)\b/g, 'TIME')
    // The boundary is a lookbehind rather than \b: "#" is not a word character,
    // so "\b#" never matched "at # screen" and "a screen for an hour" came back
    // a different shape from "that screen for forty-eight minutes".
    .replace(/(?<=^|\s)(?:the|that|this|those|these|your|my|his|her|their|#)\s+[a-z0-9' ]{1,24}?(?=\s(?:for|since|without|and|while|like|yet|but|so)\b|$)/g, 'THING')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, SHAPE_WORDS)
    .join(' ');
}

/**
 * Her own recent openings, so she stops writing the same sentence with new
 * nouns in it.
 *
 * "You've been staring at that screen for forty-eight minutes", then the screen
 * again, then a screen, then that 3D software, then your phone, then "that shop
 * floor for two hours" — six of forty idle nudges in four days, and the last one
 * went to a man eating breakfast two hours before his shift (2026-09-20). Her
 * style sheet already says no catchphrase; nothing showed her she had one,
 * because the prompt only ever carried what she had said *today*, and a template
 * that fires once a day is invisible at that range. echoesAside will not catch
 * it either: it compares lines, and every one of these is a different line.
 */
export function openingsToAvoid(lines: { at: string; text: string }[], nowMs: number, days = OPENINGS_DAYS, limit = OPENINGS_LIMIT): string {
  const since = nowMs - days * 86_400_000;
  const recent = lines.filter(line => { const at = Date.parse(line.at); return Number.isFinite(at) && at <= nowMs && at >= since; });
  // A one-word clause ("Happytel, Rockingham.") is not a shape anyone repeats;
  // listing it only crowds out the ones she does.
  const byShape = new Map<string, { text: string; used: number; at: number }>();
  for (const line of recent) {
    const shape = shapeOf(line.text);
    if (shape.split(' ').length < 4) continue;
    // Newest wording wins the slot, so the list reads as what she is doing
    // lately, but the count of the shape carries over.
    byShape.set(shape, { text: opening(line.text), used: (byShape.get(shape)?.used ?? 0) + 1, at: Date.parse(line.at) });
  }
  // The ones she has actually repeated come first, not merely the latest.
  //
  // Taking the newest N was nearly useless here: she writes around nine of
  // these a day, so eight slots held less than a day of shapes and a template
  // that fires once a day fell off the list before it could be held against
  // her. Checked against the live log on 2026-09-20 the "staring at X for N
  // minutes" shape — the whole reason for this — had already dropped out.
  // A shape used twice is a habit forming and a shape used six times is the
  // catchphrase; recency only breaks ties.
  const openings = [...byShape.values()]
    .sort((a, b) => b.used - a.used || b.at - a.at)
    .slice(0, limit)
    .sort((a, b) => a.at - b.at)
    .map(entry => entry.used > 1 ? `${entry.text}" — ${entry.used} times` : `${entry.text}"`);
  if (!openings.length) return '';
  return [
    'Openings you have already used in the last few days:',
    openings.map(text => `- "${text}`).join('\n'),
    'Do not open on the shape of any of them. Swapping the noun or the number does not make it a new sentence — "you have been staring at that screen for forty minutes" and "you have been staring at that shop floor for two hours" are one line said twice, and saying it daily is the catchphrase you are not supposed to have. Start somewhere else entirely.',
  ].join('\n');
}
