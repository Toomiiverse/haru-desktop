// Haru's memory. Pure logic — the store and the model calls live in main.ts, so
// what gets remembered, what surfaces and what is forgotten can all be exercised
// without either.
//
// Two tiers, and the distinction is about lifetime rather than importance:
//
//   short term  the current conversation, plus one-line summaries of recent
//               days, which is what lets her say "yesterday you mentioned…"
//   long term   typed records that outlive any conversation
//
// Recurrence is not a separate store. Repeating something bumps a counter on the
// record that already exists, so a topic that keeps coming up is simply one that
// has been mentioned often — no classifier, no guessing.

export const MEMORY_KINDS = ['preference', 'relationship', 'event', 'fact'] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export type MemoryRecord = {
  id: string;
  text: string;
  kind: MemoryKind;
  /** Who or what it concerns — a person, a pet, a project. */
  subject?: string;
  createdAt: string;
  lastSeenAt: string;
  /** How many times this has come up. 1 means mentioned once. */
  mentions: number;
};

export type SessionSummary = {
  /** The chat day this covers. */
  day: string;
  summary: string;
  createdAt: string;
};

/** Mentioned this many times or more and it is something they keep returning to. */
export const RECURRING_THRESHOLD = 3;

// Identity-defining records are always in the prompt; the rest compete for room.
const ALWAYS_INCLUDED: MemoryKind[] = ['preference', 'relationship'];

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'my', 'me', 'i', 'you', 'your', 'it', 'that', 'this', 'they', 'them', 'has', 'have', 'had', 'do', 'does', 'did', 'so', 'if', 'as', 'by', 'from', 'up', 'out', 'not', 'can', 'will', 'just', 'what', 'when', 'how', 'who']);

export function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

// Compared on content words so "Has a dog called Rex" and "has a dog named Rex"
// count as the same thing rather than accumulating as two. The bar sits at 0.6
// because that pair shares two words of three — a stricter 0.7 split them, while
// genuinely different facts ("a dog called Rex" against "a cat called Mabel")
// only reach 0.33 and stay apart.
const SAME_MEMORY_OVERLAP = 0.6;

export function isSameMemory(a: string, b: string) {
  const left = keywords(a);
  const right = keywords(b);
  if (!left.size || !right.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.max(left.size, right.size) >= SAME_MEMORY_OVERLAP;
}

/**
 * Whether this is worth keeping at all.
 *
 * There was no gate here, and it showed: of eleven things she had chosen to
 * remember about someone she had talked to for a week, six carried no
 * information. "They are your user and they exist." "Lives in a city." "They
 * have finished what they are doing." "They sometimes express themselves with an
 * 'Oh'." Each one then took a place in the prompt that a real fact could have
 * had, and crowded out the four that were any use.
 *
 * The model cannot be relied on to judge this. Told to remember what matters it
 * still writes down that the user exists, because a tool it has been given is a
 * tool it wants to call. So the judgement happens here, on the text, where it
 * can be measured.
 *
 * Written as three things to reject rather than a test of worth. Proving a fact
 * valuable is not possible from the sentence alone; noticing that it says
 * nothing usually is.
 */

/** True of nearly everyone, and therefore true of no one in particular. */
const UNIVERSAL = /\b(exists?|(is|are) (a|your) (user|person|human)|has feelings|uses? (slang|informal|casual)|appreciat\w+ when thanked|likes? (being )?(thanked|helped)|(is|are) (friendly|polite|nice|kind)|sometimes (say|says|express\w*|use|uses)|express\w* (themsel\w+|him|her)|responds? (well|politely)|communicates)\b/i;

/**
 * A place with no name in it.
 *
 * "Lives in a city" is the shape: grammatically a fact about where someone
 * lives, carrying nothing that distinguishes them from four billion people.
 * Named places are exactly the opposite and are caught by namesSomething.
 */
const NOWHERE_IN_PARTICULAR = /\blives?\b[^.]{0,20}\b(somewhere|a (city|town|house|flat|place|country)|the (city|country))\b/i;

/**
 * Describes a moment rather than a person. A memory whose truth expires by
 * tomorrow is a note, and it will still be in the prompt next month asserting
 * that they have just finished something.
 */
const TRANSIENT = /\b(today|right now|currently|at the moment|just (now|finished|did)|this (morning|afternoon|evening)|tonight|seems?|appears? to be|is (feeling|doing|being)|have finished|has finished|are doing)\b/i;

/**
 * Something nameable in it — a proper noun, a number, a quoted title.
 *
 * This is what rescues "currently reading Oyasumi Punpun Ch. 1" from the
 * transient rule: the wording is about now, but it names a thing, and knowing
 * what someone reads outlives the chapter they are on. Without a name, a
 * sentence about right now is only about right now.
 */
function namesSomething(text: string): boolean {
  // A capital that is not simply the start of the sentence.
  if (/\S\s+[A-Z][a-z]{2,}/.test(text)) return true;
  return /\d/.test(text);
}

export function isWorthRemembering(text: string): boolean {
  const clean = (text ?? '').trim();
  if (!clean) return false;
  // Length turned out to be a bad proxy for worth at every threshold tried.
  // Three words lost "Allergic to shellfish"; two lost "Vegetarian". Both are
  // among the most useful things anyone could tell her, and both are shorter
  // than the junk. So this only requires that there is a word in there at all,
  // and the vague entries are caught by what they say rather than by size.
  if (keywords(clean).size < 1) return false;
  if (UNIVERSAL.test(clean) || NOWHERE_IN_PARTICULAR.test(clean)) return false;
  if (TRANSIENT.test(clean) && !namesSomething(clean)) return false;
  return true;
}

/**
 * Adds a memory, or records another mention of one already held. Returns the
 * updated list and whether this was new, so the caller can tell the model
 * whether it has just learned something or merely repeated itself.
 */
export function rememberInto(
  memories: MemoryRecord[],
  incoming: { text: string; kind: MemoryKind; subject?: string; id: string; now: string },
): { memories: MemoryRecord[]; created: boolean; record: MemoryRecord } {
  const text = incoming.text.trim();
  const existing = memories.find(memory => isSameMemory(memory.text, text));
  if (existing) {
    const updated: MemoryRecord = {
      ...existing,
      // The newer phrasing wins when it carries more detail.
      text: text.length > existing.text.length ? text : existing.text,
      subject: existing.subject ?? incoming.subject,
      lastSeenAt: incoming.now,
      mentions: existing.mentions + 1,
    };
    return { memories: memories.map(memory => memory.id === existing.id ? updated : memory), created: false, record: updated };
  }
  const record: MemoryRecord = {
    id: incoming.id, text, kind: incoming.kind, subject: incoming.subject,
    createdAt: incoming.now, lastSeenAt: incoming.now, mentions: 1,
  };
  return { memories: [...memories, record], created: true, record };
}

// Forgetting favours things said once and long ago; something raised repeatedly
// survives even when it has not come up lately.
export function pruneMemories(memories: MemoryRecord[], limit: number): MemoryRecord[] {
  if (memories.length <= limit) return memories;
  const scored = memories.map(memory => ({
    memory,
    score: memory.mentions * 2
      + (ALWAYS_INCLUDED.includes(memory.kind) ? 3 : 0)
      + new Date(memory.lastSeenAt).getTime() / 1e12,
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(entry => entry.memory);
}

export function recurringMemories(memories: MemoryRecord[]) {
  return memories.filter(memory => memory.mentions >= RECURRING_THRESHOLD)
    .sort((a, b) => b.mentions - a.mentions);
}

/**
 * Chooses what to put in front of her for this message. Preferences and
 * relationships always go in — they shape how she talks regardless of subject.
 * Everything else has to earn its place by relating to what was just said, so a
 * long memory does not crowd out the conversation.
 */
export function selectMemories(memories: MemoryRecord[], message: string, limit = 14): MemoryRecord[] {
  const always = memories.filter(memory => ALWAYS_INCLUDED.includes(memory.kind));
  const rest = memories.filter(memory => !ALWAYS_INCLUDED.includes(memory.kind));
  const asked = keywords(message);
  const ranked = rest
    .map(memory => {
      const overlap = [...keywords(memory.text)].filter(word => asked.has(word)).length;
      return { memory, score: overlap * 10 + memory.mentions };
    })
    // Something mentioned repeatedly stays available even with nothing in common
    // with this message; a one-off needs to actually be relevant.
    .filter(entry => entry.score >= 10 || entry.memory.mentions >= RECURRING_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.memory);
  return [...always, ...ranked].slice(0, limit);
}

function describe(memory: MemoryRecord) {
  const recurring = memory.mentions >= RECURRING_THRESHOLD ? ` [comes up often, ${memory.mentions} times]` : '';
  const subject = memory.subject ? ` (${memory.subject})` : '';
  return `${memory.text}${subject}${recurring}`;
}

/**
 * The memory block for the system prompt. Grouped by kind because an
 * undifferentiated list reads as trivia, whereas "how they like to be spoken to"
 * is an instruction.
 */
export function formatMemoryPrompt(memories: MemoryRecord[], sessions: SessionSummary[]): string {
  const parts: string[] = [];
  const byKind = (kind: MemoryKind) => memories.filter(memory => memory.kind === kind);

  const preferences = byKind('preference');
  if (preferences.length) parts.push(`How they like things: ${preferences.map(describe).join('; ')}.`);
  const relationships = byKind('relationship');
  if (relationships.length) parts.push(`People and pets in their life: ${relationships.map(describe).join('; ')}.`);
  const events = byKind('event');
  if (events.length) parts.push(`Things going on for them: ${events.map(describe).join('; ')}.`);
  const facts = byKind('fact');
  if (facts.length) parts.push(`Other things you know about them: ${facts.map(describe).join('; ')}.`);

  if (sessions.length) {
    const recent = sessions.slice(-4).map(session => `${session.day}: ${session.summary}`).join(' | ');
    parts.push(`Earlier conversations — ${recent}.`);
    parts.push('Refer back to those naturally when they are relevant, the way someone would who was there. Do not list them back or announce that you remember.');
  }
  return parts.join(' ');
}

// Kept tight on purpose: this is recalled months later as a single line, so it
// has to be worth the space it takes.
export function summaryPrompt() {
  return [
    'Summarise this conversation in one sentence, under 25 words, in the third person, as a note to your future self.',
    'Record what the user was doing or dealing with, not what you said back.',
    'Skip greetings and small talk. If nothing of substance happened, reply with exactly: nothing notable.',
    'Reply with the sentence only.',
  ].join(' ');
}

export function isWorthKeeping(summary: string) {
  const clean = summary.trim().toLowerCase().replace(/[.!]+$/, '');
  return clean.length > 0 && clean !== 'nothing notable' && clean.length < 300;
}

// Old flat records predate kinds and counters; they are read forward rather than
// dropped, since they are the only history an existing user has.
export function migrateMemories(saved: unknown, now: string): MemoryRecord[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Partial<MemoryRecord>;
    if (typeof record.text !== 'string' || !record.text.trim()) return [];
    return [{
      id: typeof record.id === 'string' ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: record.text.trim(),
      kind: MEMORY_KINDS.includes(record.kind as MemoryKind) ? record.kind as MemoryKind : 'fact',
      subject: typeof record.subject === 'string' ? record.subject : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : (typeof record.createdAt === 'string' ? record.createdAt : now),
      mentions: typeof record.mentions === 'number' && record.mentions > 0 ? record.mentions : 1,
    }];
  });
}
