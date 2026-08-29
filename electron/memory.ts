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

/** Where a memory came from. Reliable sources start with higher confidence. */
export type MemorySource = typeof MEMORY_SOURCES[number];

/** Lifecycle state. DORMANT and ARCHIVED are set by decay, never silently. */
export type MemoryStatus = typeof MEMORY_STATUSES[number];

/** The kind of knowing, alongside the interaction kind in `kind`. */
export type MemoryType = typeof MEMORY_TYPES[number];

/**
 * Listed once and derived into the type, not spelled out twice.
 *
 * migrateMemories validates evidence against this list on every read, and it
 * used to carry its own copy of the five original kinds. Adding 'merge' to the
 * union alone would have compiled cleanly and then silently dropped every merge
 * entry on the next load — and since the folded record's wording now lives only
 * there, that would have quietly lost the thing it exists to keep. Found by the
 * session next door, which had just fixed the same shape in asides.ts, where a
 * short SOURCES list rewrote three real sources to 'other' on every read.
 */
export const EVIDENCE_KINDS = ['statement', 'repeat', 'confirmation', 'contradiction', 'inference', 'merge', 'closed'] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];

export const MEMORY_SOURCES = ['conversation', 'explicit', 'inferred', 'activity', 'import'] as const;
export const MEMORY_STATUSES = ['active', 'dormant', 'archived'] as const;
export const MEMORY_TYPES = ['semantic', 'episodic', 'procedural', 'relational'] as const;

/** One observed moment behind a memory — what makes it worth believing. */
export type EvidenceEntry = {
  at: string;
  kind: EvidenceKind;
  source: MemorySource;
  detail?: string;
};

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
  /**
   * Set to the id of whatever replaced this once it goes out of date — "uses
   * Ubuntu" superseded by "switched the server to Debian". Kept rather than
   * deleted, since it is still true history, just no longer current; it stops
   * surfacing in selectMemories but survives a prune the same as anything else.
   */
  supersededBy?: string;
  // v2 — filled by migrateMemories for legacy records; optional so old data
  // stays valid without a rewrite.
  /** How much evidence this memory has behind it, 0..1. */
  confidence?: number;
  /** How much this matters independent of recency, 0..1. */
  importance?: number;
  source?: MemorySource;
  status?: MemoryStatus;
  memoryType?: MemoryType;
  /** Optional triple slots so relational memories can later become a graph. */
  predicate?: string;
  object?: string;
  /** The observed moments behind this memory, oldest first. */
  evidence?: EvidenceEntry[];
  /** Ids of memories folded into this one by consolidation. */
  mergedFrom?: string[];
  /** Ids of memories that claim the opposite of this one. */
  conflictsWith?: string[];
};

export type SessionSummary = {
  /** The chat day this covers. */
  day: string;
  summary: string;
  createdAt: string;
};

/** Raised on this many separate days or more and it is something they keep returning to. */
export const RECURRING_THRESHOLD = 3;

/**
 * How many separate days something has come up.
 *
 * `mentions` counts every repeat, and a merge adds the folded record's count
 * on top — so one day that was summarised four times over (the 08-29 crash
 * loop) left "closing the store" with eight mentions from a single
 * conversation, and eight mentions made it "recurring": admitted to every
 * prompt whatever the message, for as long as its half-life lasts. Something
 * that keeps coming up is something raised on different days, so this counts
 * days across the evidence log instead. Records with no evidence log — legacy
 * ones, and fixtures — fall back to mentions, which is all they have.
 */
export function daysRaised(memory: MemoryRecord): number {
  const evidence = memory.evidence ?? [];
  if (!evidence.length) return memory.mentions;
  return new Set(evidence.map(entry => entry.at.slice(0, 10))).size;
}

export function isRecurring(memory: MemoryRecord): boolean {
  return daysRaised(memory) >= RECURRING_THRESHOLD;
}

// Anchored loosely rather than at the start: "so do you remember" and "wait,
// what did I say about" both ask the same thing partway into a sentence.
const EXPLICIT_RECALL = /\b(do you remember|d'?you remember|remember when|remember what|we (talked|spoke) about|we discussed|you know how (i|we)|what did (i|you) say about|what did i tell you about|last time (we|i)|recall when|recall what)\b/i;

/** Asking her to reach back rather than just answer from what's in front of her — worth a wider search than the usual per-message budget. */
export function isExplicitRecall(text: string): boolean {
  return EXPLICIT_RECALL.test(text);
}

/** How many memories a turn gets when they've explicitly asked her to recall something, instead of the usual `selectMemories` default. */
export const DEEP_RECALL_LIMIT = 30;

// Identity-defining records are always in the prompt; the rest compete for room.
const ALWAYS_INCLUDED: MemoryKind[] = ['preference', 'relationship'];

export const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'my', 'me', 'i', 'you', 'your', 'it', 'that', 'this', 'they', 'them', 'has', 'have', 'had', 'do', 'does', 'did', 'so', 'if', 'as', 'by', 'from', 'up', 'out', 'not', 'can', 'will', 'just', 'what', 'when', 'how', 'who']);

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
/**
 * About the conversation, or about her, rather than about them.
 *
 * The fourth class, found by reading the store after three weeks: of
 * thirty-four records, fourteen were not about the user's life at all. "The
 * PC Project comes up often, 3 times" is a note about her own memory — and
 * because it contains the word "project" it scored importance 0.8 and would
 * never have decayed. "They are thanking you", "They occasionally say you are
 * helpful" are about her. "Nothing notable", "Discord opened and closed",
 * "Procrastination noted", "details not shared" are a summariser with nothing
 * to say, saying so. "Don't be late for the motherboard pickup" is her own
 * nagging written down as if it were a fact. None of the other three gates
 * caught any of them, because each is a well-formed sentence that names
 * something.
 *
 * Patterned on those records, not on a theory of junk: eight of the
 * fourteen are refused here (the other six were stale or already on the
 * agenda, which is not this gate's business), and none of the twenty that
 * were kept is touched — tests/memory.test.ts holds both lists.
 */
const ABOUT_THE_CONVERSATION = new RegExp([
  // Her, as the subject: thanked, praised, found helpful.
  String.raw`\bthank(s|ing|ed)? you\b`,
  String.raw`\b(say|says|said|find|finds|found|think|thinks|thought) (that )?(you|haru) (are|is|were|was)\b`,
  String.raw`\byou('re| are) (helpful|useful|right|great|funny|annoying)\b`,
  // Her own memory, as the subject: how often something has come up.
  String.raw`\bcomes? up (often|a lot|again|repeatedly)\b`,
  String.raw`\b(mentioned|raised|came up|brought up) (\d+|several|many|multiple|a few) times\b`,
  String.raw`\b\d+ times\b`,
  // A summariser with nothing to say.
  String.raw`^\s*nothing (notable|eventful|new|much|specific|in particular|happened)\b`,
  String.raw`\bopened and closed\b`,
  String.raw`\bnoted\.?\s*$`,
  // Anchored to the start with no clause break allowed, so "details not
  // shared" as the whole record is refused while "Rental inspection
  // completed, but details not shared" — an event with a summariser's
  // shrug folded onto it — keeps its event.
  String.raw`^[^.,;:]{0,40}\b(details|specifics|nothing) (were |was )?not (shared|given|provided|mentioned)\b`,
  String.raw`^[^.,;:]{0,40}\bno (details|specifics) (shared|given|provided)\b`,
  // A guess at their state this minute.
  String.raw`\b(might|may) be (low|down|tired|busy|fine|ok|okay)\b`,
  String.raw`\bbrings? (up|about) a (good|bad) mood\b`,
  // Her own nagging, written down as a fact about them.
  String.raw`^\s*(don['’]?t|do not|never|remember to|make sure|be sure|hurry|get on with|go and|pick up|call|buy|finish)\b`,
].join('|'), 'i');

export function isAboutTheConversation(text: string): boolean {
  return ABOUT_THE_CONVERSATION.test((text ?? '').trim());
}

function namesSomething(text: string): boolean {
  // A capital that is not simply the start of the sentence.
  if (/\S\s+[A-Z][a-z]{2,}/.test(text)) return true;
  return /\d/.test(text);
}

/**
 * A memory whose whole content is an instruction not to mention something.
 *
 * These look like the most useful memory in the store and are the worst thing in
 * it. "Don't mention the jellyfish PC" was written down after the user said
 * exactly that, kept deliberately as a guard, and put the word "jellyfish" into
 * every prompt from then on — the only concrete noun in the line. A day later
 * she opened with a fact about jellyfish. Telling a model not to mention
 * something is how you make sure it is thinking about it.
 *
 * The subject being dropped is what has to go, not be written down. Refusing the
 * memory is right: what the user actually wants is enforced by not carrying the
 * topic forward, and pushback.ts already handles being told to drop something.
 */
// Verb stems rather than exact words: the instruction arrives as "stop
// mentioning", "don't bring up" and "no more talking about" in roughly equal
// measure, and \bmention\b does not match "mentioning".
const A_BAN = /^\s*(do ?n'?t|do not|never|stop|no more|quit|avoid)\b.{0,14}?\b(mention\w*|talk\w*\s+about|bring\w*\s+up|say\w*|discuss\w*|rais\w+|refer\w*\s+to|go(ing)?\s+on\s+about)\b/i;

export function bansATopic(text: string): boolean {
  return A_BAN.test((text ?? '').trim());
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
  if (bansATopic(clean)) return false;
  if (isAboutTheConversation(clean)) return false;
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
  incoming: { text: string; kind: MemoryKind; subject?: string; id: string; now: string; source?: MemorySource; predicate?: string; object?: string; evidenceDetail?: string },
): { memories: MemoryRecord[]; created: boolean; record: MemoryRecord } {
  const text = incoming.text.trim();
  const existing = memories.find(memory => isSameMemory(memory.text, text));
  if (existing) {
    const base = baseConfidence(existing.source ?? 'conversation');
    const updated: MemoryRecord = {
      ...existing,
      // The newer phrasing wins when it carries more detail.
      text: text.length > existing.text.length ? text : existing.text,
      subject: existing.subject ?? incoming.subject,
      predicate: existing.predicate ?? incoming.predicate,
      object: existing.object ?? incoming.object,
      lastSeenAt: incoming.now,
      mentions: existing.mentions + 1,
      // A consistent repeat is fresh evidence for the same claim.
      confidence: mentionConfidence(existing.mentions + 1, base),
      evidence: [...(existing.evidence ?? []), incoming.evidenceDetail
        ? { at: incoming.now, kind: 'repeat', source: existing.source ?? 'conversation', detail: incoming.evidenceDetail }
        : { at: incoming.now, kind: 'repeat', source: existing.source ?? 'conversation' }],
      importance: Math.max(existing.importance ?? 0, scoreImportance(existing.kind, existing.text)),
    };
    return { memories: memories.map(memory => memory.id === existing.id ? updated : memory), created: false, record: updated };
  }
  const source = incoming.source ?? 'conversation';
  const record: MemoryRecord = {
    id: incoming.id,
    text,
    kind: incoming.kind,
    subject: incoming.subject,
    predicate: incoming.predicate,
    object: incoming.object,
    createdAt: incoming.now,
    lastSeenAt: incoming.now,
    mentions: 1,
    confidence: baseConfidence(source),
    importance: scoreImportance(incoming.kind, text),
    source,
    status: 'active',
    memoryType: guessMemoryType(incoming.kind, text),
    evidence: [incoming.evidenceDetail
      ? { at: incoming.now, kind: 'statement', source, detail: incoming.evidenceDetail }
      : { at: incoming.now, kind: 'statement', source }],
  };
  return { memories: [...memories, record], created: true, record };
}

// Forgetting favours things said once and long ago; something raised repeatedly
// survives even when it has not come up lately. Pruning only ever happens when
// the list is over the cap, and it now uses the full lifecycle score — an
// important, well-evidenced memory outlives a trivial one that happens to have
// been mentioned recently. Preference, relationship and high-importance
// records are never pruned while anything else can go first, and archived
// records are never pruned at all — shelving is deliberate, and deliberate is
// not evictable.
export type PruneResult = {
  memories: MemoryRecord[];
  /** What the cap took. The caller logs these rather than letting them vanish. */
  evicted: MemoryRecord[];
};

export function pruneMemories(memories: MemoryRecord[], limit: number): PruneResult {
  if (memories.length <= limit) return { memories, evicted: [] };
  const archived = memories.filter(memory => memory.status === 'archived');
  const rest = memories.filter(memory => memory.status !== 'archived');
  const untouchable = rest.filter(memory => memory.kind === 'preference' || memory.kind === 'relationship' || (memory.importance ?? 0) >= ALWAYS_IMPORTANT);
  const touchable = rest.filter(memory => !untouchable.includes(memory));
  if (touchable.length <= limit - untouchable.length - archived.length) return { memories, evicted: [] };
  const scored = touchable.map(memory => ({ memory, score: pruneScore(memory) })).sort((a, b) => b.score - a.score);
  const keepCount = Math.max(0, limit - untouchable.length - archived.length);
  const kept = scored.slice(0, keepCount).map(entry => entry.memory);
  const evicted = scored.slice(keepCount).map(entry => entry.memory);
  if (!evicted.length) return { memories, evicted: [] };
  return { memories: [...kept, ...untouchable, ...archived], evicted };
}

function pruneScore(memory: MemoryRecord): number {
  const importance = memory.importance ?? 0.4;
  const confidence = memory.confidence ?? 0.5;
  const now = new Date();
  return (memory.mentions + 1)
    * (0.5 + importance)
    * (0.4 + confidence)
    * memoryRecency(memory.lastSeenAt, now, 60);
}

// -- decay and forgetting -----------------------------------------------------

/** Why a memory stopped being part of her current knowledge. Every departure
 *  lands in the forgetting log so forgetting is explainable, never silent. */
export type ForgetReason = 'decay' | 'consolidation' | 'supersession' | 'explicit' | 'prune';

export type ForgettingEntry = {
  /** The id of the record that left. */
  id: string;
  /** What it said, so the log reads on its own. */
  text: string;
  at: string;
  reason: ForgetReason;
  detail?: string;
};

export type DecayTransition = {
  id: string;
  from: MemoryStatus;
  to: MemoryStatus;
  halfLives: number;
};

export type DecayResult = {
  memories: MemoryRecord[];
  transitions: DecayTransition[];
  /** Records that reached the end of their half-lives and left entirely. The
   *  caller logs these; they are not deleted without a trace. */
  forgotten: ForgettingEntry[];
};

/**
 * The controlled forgetting pass. A memory moves ACTIVE → DORMANT after two
 * half-lives without being seen, → ARCHIVED after four, and is forgotten after
 * six — but only if its importance allows it. High-importance records
 * (>= 0.8, effectively permanent, ten-year half-life) never leave ACTIVE on
 * their own; superseded and archived records are history and are left alone.
 */
export function applyDecay(memories: MemoryRecord[], now: Date): DecayResult {
  const transitions: DecayTransition[] = [];
  const forgotten: ForgettingEntry[] = [];
  const out: MemoryRecord[] = [];
  for (const memory of memories) {
    if (memory.supersededBy || memory.status === 'archived') {
      out.push(memory);
      continue;
    }
    const importance = memory.importance ?? 0.4;
    if (importance >= ALWAYS_IMPORTANT) {
      out.push(memory);
      continue;
    }
    const status = memory.status ?? 'active';
    const seen = Date.parse(memory.lastSeenAt);
    const days = Number.isFinite(seen) ? Math.max(0, (now.getTime() - seen) / 86_400_000) : 0;
    const halfLives = days / memoryHalfLifeDays(importance);
    if (halfLives >= 6) {
      forgotten.push({ id: memory.id, text: memory.text, at: now.toISOString(), reason: 'decay', detail: `idle for ${Math.round(halfLives)} half-lives` });
      continue;
    }
    let next: MemoryStatus = status;
    if (halfLives >= 4) next = 'archived';
    else if (halfLives >= 2) next = 'dormant';
    if (next !== status) {
      transitions.push({ id: memory.id, from: status, to: next, halfLives });
      out.push({ ...memory, status: next });
    } else {
      out.push(memory);
    }
  }
  return { memories: out, transitions, forgotten };
}

export function recurringMemories(memories: MemoryRecord[]) {
  return memories.filter(isRecurring)
    .sort((a, b) => daysRaised(b) - daysRaised(a));
}

/**
 * Which active memory a new fact replaces, if any.
 *
 * Matched by containment rather than a tuned overlap score: every word the
 * hint names has to actually be present in the old record's text. That is a
 * deliberately narrow bar — a vague paraphrase like "the old configuration"
 * will not find anything, on purpose, because keyword matching has no way to
 * know that means Ubuntu. It works because the model is not guessing blind:
 * the memory it means to replace is already sitting in its own prompt, so it
 * can hand back a word actually drawn from it ("Ubuntu"), not a description of
 * it. When more than one active memory contains the hint, the one with the
 * fewest words left over wins — the more specific match.
 */
export function findSuperseded(memories: MemoryRecord[], hint: string): MemoryRecord | null {
  const asked = keywords(hint);
  if (!asked.size) return null;
  let best: MemoryRecord | null = null;
  let bestExtra = Infinity;
  for (const memory of memories) {
    if (memory.supersededBy) continue; // already replaced — nothing left here to supersede again
    const held = keywords(memory.text);
    if (![...asked].every(word => held.has(word))) continue;
    const extra = held.size - asked.size;
    if (extra < bestExtra) { bestExtra = extra; best = memory; }
  }
  return best;
}

/** Marks one memory as replaced by another. Both records stay in the list. */
export function supersede(memories: MemoryRecord[], oldId: string, newId: string): MemoryRecord[] {
  return memories.map(memory => memory.id === oldId ? { ...memory, supersededBy: newId } : memory);
}

/**
 * Chooses what to put in front of her for this message. Preferences and
 * relationships always go in — they shape how she talks regardless of subject.
 * Everything else has to earn its place by relating to what was just said, so a
 * long memory does not crowd out the conversation.
 */
export function selectMemories(memories: MemoryRecord[], message: string, limit = 14): MemoryRecord[] {
  // Superseded records are history, not current knowledge — they stay in the
  // store for findSuperseded to search, but never surface in a prompt.
  const active = memories.filter(memory => !memory.supersededBy);
  const always = active.filter(memory => ALWAYS_INCLUDED.includes(memory.kind));
  const rest = active.filter(memory => !ALWAYS_INCLUDED.includes(memory.kind));
  const asked = keywords(message);
  const ranked = rest
    .map(memory => {
      const overlap = [...keywords(memory.text)].filter(word => asked.has(word)).length;
      return { memory, score: overlap * 10 + memory.mentions };
    })
    // Something mentioned repeatedly stays available even with nothing in common
    // with this message; a one-off needs to actually be relevant.
    .filter(entry => entry.score >= 10 || isRecurring(entry.memory))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.memory);
  return [...always, ...ranked].slice(0, limit);
}

// -- unified retrieval --------------------------------------------------------

/**
 * Retrieval that scores what to show for a message the way the lifecycle says
 * it should: relevance (semantic and keyword) is weighted by importance,
 * confidence and recency, so an important fact mentioned months ago beats a
 * trivia from yesterday when both are on-topic, and recency alone never
 * decides anything.
 */

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

function keywordSimilarity(query: string, text: string): number {
  const asked = [...keywords(query)];
  const held = keywords(text);
  if (!asked.length || !held.size) return 0;
  const matched = asked.filter(word => held.has(word)).length;
  return Math.min(1, matched / asked.length);
}

/** How long a memory of this importance stays vivid. */
export function memoryHalfLifeDays(importance: number): number {
  if (importance >= 0.8) return 10 * 365;
  if (importance >= 0.5) return 180;
  return 45;
}

export function memoryRecency(lastSeenAt: string, now: Date, halfLifeDays: number): number {
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return 0;
  const days = Math.max(0, (now.getTime() - seen) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
}

/** Memories at or above this importance are always offered, like preferences. */
export const ALWAYS_IMPORTANT = 0.8;

/** How much a memory type is worth when the topic matches at all. */
function typeWeight(kind: MemoryKind): number {
  switch (kind) {
    case 'preference': return 1;
    case 'relationship': return 1;
    case 'fact': return 0.9;
    case 'event': return 0.85;
  }
}

/** A dormant memory has to be clearly on-topic to come back, not just vaguely
 *  related — silence since then means the tie has to be argued for. One shared
 *  content word out of three is enough to argue with. */
const DORMANT_ADMISSION = 0.25;

export type RetrieveOptions = {
  limit?: number;
  /** id → semantic similarity (0..1), computed by the caller with an embedder.
   *  Absent or missing ids fall back to the keyword score. */
  semantic?: Map<string, number>;
  now?: Date;
};

export type RetrievalFactors = {
  semantic: number;
  keyword: number;
  relevance: number;
  importance: number;
  confidence: number;
  recency: number;
  type: number;
};

export type ScoredMemory = {
  memory: MemoryRecord;
  score: number;
  factors: RetrievalFactors;
};

export function retrieveMemories(memories: MemoryRecord[], message: string, options: RetrieveOptions = {}): ScoredMemory[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 14;
  const asked = keywords(message);
  const always: ScoredMemory[] = [];
  const scored: ScoredMemory[] = [];

  for (const memory of memories) {
    if (memory.supersededBy) continue;                    // replaced — history only
    if (memory.status === 'archived') continue;           // shelved — must be unarchived deliberately
    const importance = memory.importance ?? 0.4;
    const confidence = memory.confidence ?? 0.5;
    const keyword = asked.size ? keywordSimilarity(message, memory.text) : 0;
    const semantic = options.semantic?.get(memory.id) ?? keyword;
    const relevance = 0.45 * semantic + 0.35 * keyword + 0.2 * typeWeight(memory.kind);
    const recency = memoryRecency(memory.lastSeenAt, now, memoryHalfLifeDays(importance));
    const entry: ScoredMemory = {
      memory,
      score: relevance * (0.4 + 0.6 * importance) * (0.5 + 0.5 * confidence) * recency,
      factors: {
        semantic, keyword, relevance,
        importance: 0.4 + 0.6 * importance,
        confidence: 0.5 + 0.5 * confidence,
        recency,
        type: typeWeight(memory.kind),
      },
    };
    // Preferences, relationships and anything of high importance shape how she
    // talks whatever the topic is. Everything else has to actually relate to
    // what was said — keyword or semantic overlap — or be something that keeps
    // coming back on its own.
    const keptAlive = memory.kind === 'preference' || memory.kind === 'relationship' || importance >= ALWAYS_IMPORTANT;
    const related = Math.max(semantic, keyword) > 0 || isRecurring(memory);
    if (keptAlive) always.push(entry);
    else if (memory.status === 'dormant' ? Math.max(semantic, keyword) >= DORMANT_ADMISSION : related) scored.push(entry);
  }

  // One ranking, not two buckets in series: a highly relevant memory ranks
  // above an important one that has nothing to do with the question.
  const ranked = [...always, ...scored].sort((a, b) => b.score - a.score);
  const out: ScoredMemory[] = [];
  for (const entry of ranked) {
    if (out.length >= limit) break;
    out.push(entry);
  }
  // The always-included guarantee: if one of them was crowded out by the cut,
  // it displaces the weakest non-always entry rather than vanishing. The
  // guarantee is narrower than the eligibility above: a high-importance fact
  // may be offered without being on-topic, but only preferences and
  // relationships — the records that shape how she talks — are promised a
  // slot. With a user who runs a company, most facts score 0.8 (work, project,
  // business are all "important" words), and guaranteeing every one of them
  // left one slot in twelve for whatever the message was actually about.
  const guaranteed = always.filter(entry => ALWAYS_INCLUDED.includes(entry.memory.kind));
  const alwaysIds = new Set(guaranteed.map(entry => entry.memory.id));
  const present = new Set(out.map(entry => entry.memory.id));
  for (const entry of guaranteed.sort((a, b) => b.score - a.score)) {
    if (present.has(entry.memory.id)) continue;
    const weakest = [...out].reverse().find(candidate => !alwaysIds.has(candidate.memory.id));
    if (weakest) {
      out.splice(out.indexOf(weakest), 1, entry);
      present.add(entry.memory.id);
    } else if (out.length < limit) {
      out.push(entry);
      present.add(entry.memory.id);
    }
  }
  return out;
}

/**
 * The cosine below which a query and a memory are simply unrelated.
 *
 * Measured against the live store with nomic-embed-text (2026-08-29): pairs
 * with nothing in common sat at 0.33–0.42, "2+2" against every memory topped
 * out at 0.49, and the genuinely related pairs — the store cleaning to the
 * closure, "how is emma" to the relationship, "what anime" to the favourites
 * list — came in at 0.57–0.71. Raw cosine is never zero, so without a floor
 * every record read as related and the relevance gate in retrieveMemories
 * admitted all of them: the prompt was the top fourteen by importance, the
 * same fourteen for "hey" as for anything else. Above the floor the score is
 * rescaled to 0..1 so the weights in the relevance formula keep their meaning.
 * Specific to the embedding model; re-measure if that changes.
 */
export const SEMANTIC_FLOOR = 0.45;

export function calibrateSimilarity(cosine: number): number {
  return Math.max(0, Math.min(1, (cosine - SEMANTIC_FLOOR) / (1 - SEMANTIC_FLOOR)));
}

/** Precompute id → semantic similarity for every memory that has a vector:
 *  the cosine to the query's own embedding, calibrated so unrelated is zero. */
export function semanticSimilarities(memories: MemoryRecord[], queryVector: number[], vectors: Map<string, number[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const memory of memories) {
    const vector = vectors.get(memory.id);
    if (vector) out.set(memory.id, calibrateSimilarity(cosineSimilarity(vector, queryVector)));
  }
  return out;
}

/** Cosine similarity between two memory vectors; undefined when either side
 *  has none, so callers can fall back to keyword scoring. */
export function vectorSimilarity(a: number[] | undefined, b: number[] | undefined): number | undefined {
  if (!a || !b) return undefined;
  return cosineSimilarity(a, b);
}

function describe(memory: MemoryRecord) {
  const recurring = isRecurring(memory) ? ` [comes up often, on ${daysRaised(memory)} separate days]` : '';
  const subject = memory.subject ? ` (${memory.subject})` : '';
  const important = (memory.importance ?? 0) >= 0.8 ? ' [important to them]' : '';
  // Uncertainty is worth naming; certainty is the default and stays silent so
  // the block does not grow into trivia.
  const uncertain = (memory.confidence ?? 1) < 0.6 ? ` [not certain — ${Math.round((memory.confidence ?? 0) * 100)}%]` : '';
  const stale = memory.status === 'dormant' ? ' [has not come up in a while]' : '';
  return `${memory.text}${subject}${recurring}${important}${uncertain}${stale}`;
}

/**
 * The memory block for the system prompt. Grouped by kind because an
 * undifferentiated list reads as trivia, whereas "how they like to be spoken to"
 * is an instruction.
 */
/** How far back "earlier conversations" reaches in the prompt, in days. */
export const RECENT_SESSION_DAYS = 7;

/** Whole days between two YYYY-MM-DD keys, never negative. */
function dayDistance(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

export function formatMemoryPrompt(memories: MemoryRecord[], sessions: SessionSummary[]): string {
  const newestDay = sessions.map(session => session.day).filter(Boolean).sort().at(-1);
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

  // The last few days, by date. The array is not in date order — days are
  // summarised as they are archived and backfilled later — so the last four
  // by position once held a summary three weeks old, and she opened on a party
  // from it. And a week is as far back as "earlier conversations" should
  // reach unprompted; anything older is for memories, not for small talk.
  const recentDays = [...sessions]
    .filter(session => !session.day || !newestDay || dayDistance(session.day, newestDay) <= RECENT_SESSION_DAYS)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-4);
  if (recentDays.length) {
    const recent = recentDays.map(session => `${session.day}: ${session.summary}`).join(' | ');
    parts.push(`Earlier conversations — ${recent}.`);
    parts.push('Refer back to those naturally when they are relevant, the way someone would who was there. Do not list them back or announce that you remember.');
  }
  return parts.join(' ');
}

// Kept tight on purpose: this is recalled months later as a single line, so it
// has to be worth the space it takes.
/**
 * The person is pinned rather than merely requested. "In the third person" was
 * already in here and the model drifted anyway: of 26 stored summaries, five
 * said "you". Worse, they did not agree on who "you" was — "You were dealing
 * with reminders about The PC Project" meant the user, "You reminded them about
 * Scarlett's birthday party" meant Haru. These lines go into her own system
 * prompt, where "you" is unambiguously her, so the first kind quietly tells her
 * she did the user's day.
 *
 * "They" rather than a name: the transcript is labelled `They:` for the same
 * reason, so the word the note should use is the word the input already uses.
 */
export function summaryPrompt() {
  return [
    'Summarise this conversation in one sentence, under 25 words, as a note to your future self.',
    'The note is about the user. Call them "they" — never "you" or "your", which in your own notes mean you, Haru.',
    'Record what they were doing or dealing with, not what you said back.',
    'Skip greetings and small talk. If nothing of substance happened, reply with exactly: nothing notable.',
    'Reply with the sentence only.',
  ].join(' ');
}

/** Said again, harder, when the first answer came back addressed to somebody. */
export const THIRD_PERSON_AGAIN = 'That was addressed to a person. Write it again about the user in the third person, using "they", with no "you" or "your" anywhere.';

/**
 * Whether a note talks to somebody instead of about them. Used to catch the
 * drift the prompt above is meant to prevent — a deterministic backstop behind
 * an instruction, because the instruction demonstrably was not enough.
 */
export function readsAsSecondPerson(text: string): boolean {
  return /\b(you|your|yours|yourself|you're|you've|you'll|you'd)\b/i.test(text);
}

export function isWorthKeeping(summary: string) {
  const clean = summary.trim().toLowerCase().replace(/[.!]+$/, '');
  return clean.length > 0 && clean !== 'nothing notable' && clean.length < 300;
}

/**
 * The second pass over a finished day: not a summary of what was said, but the
 * one-off events worth promoting from that day into long-term memory. Kept
 * separate from summaryPrompt because the summary is a single line for recall
 * while this feeds the memory engine.
 */
export function eventsPrompt() {
  return [
    'List the events from this conversation worth remembering, one per line, under 15 words each, as a note to your future self.',
    'Each line is about the user. Call them "they" — never "you" or "your", which in your own notes mean you, Haru.',
    'Include only what will still matter in a month: decisions made, projects completed or changed, notable personal events, lasting changes to their setup or plans.',
    'Skip routine errands, reminders, small talk and passing feelings.',
    'If nothing qualifies, reply with exactly: nothing notable.',
    'Reply with the lines only.',
  ].join(' ');
}

/** One extracted event line, cleaned for the memory gate. */
export function eventCandidates(reply: string): string[] {
  return reply
    .split('\n')
    .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(line => line.length > 0 && !/^nothing notable$/i.test(line))
    .map(line => line.replace(/[.!]+$/, ''))
    .filter(line => line.length > 0);
}

/**
 * The stricter gate for episodic extraction. A finished day's events are
 * promoted only when they are actually events: something that happened to the
 * user, nameable, and not a passing moment. Instructions to Haru are refused —
 * "Haru to research X" is a task or a preference, not something that happened
 * in their life — and generic moments ("Tommy cleaned up the room", "Tommy
 * feels tired") are refused too. The write path keeps its own isWorthRemembering
 * gate; this one runs first, on the extraction's output.
 */
const GENERIC_MOMENT = /\b(procrastinat\w*|feel\w*|struggl\w*|annoyed|bored|tired|cleaned?|dodged?|avoided?|monitor\w*|remind\w*)\b/i;

export function isWorthAnEvent(text: string): boolean {
  const clean = (text ?? '').trim();
  if (!isWorthRemembering(clean)) return false;
  // A sentence addressed to Haru is material for the preference/task systems,
  // not an event in the user's life.
  if (/^haru\b/i.test(clean)) return false;
  // Nor is one addressed to the user. "You're closing the store from Monday to
  // Tuesday" reached the store this way and then read, in her own prompt, as
  // something she was doing — the same drift the summary prompt now pins.
  if (readsAsSecondPerson(clean)) return false;
  // A passing moment stays a moment even when it names the subject — "work
  // emails" in a procrastination sentence does not make it an event.
  if (GENERIC_MOMENT.test(clean)) return false;
  // Otherwise it has to name something concrete — a proper noun, a number, a
  // quoted title — or be about something that matters long-term.
  if (IMPORTANT_TOPICS.test(clean) || namesSomething(clean)) return true;
  return false;
}

/**
 * Words that say something was done rather than what was done. Stripped from a
 * finished item's title before matching, because they are the half that never
 * appears in the memory: "Get the TV power connector done" is remembered as
 * "Set up TV power connector, TV works fine now".
 */
const TASK_VERBS = new Set(['get', 'got', 'getting', 'done', 'doing', 'finish', 'finished', 'complete', 'completed', 'pick', 'picked', 'picking', 'sort', 'sorted', 'make', 'made', 'take', 'taken', 'need', 'needs', 'must', 'should', 'today', 'tomorrow', 'tonight']);

/**
 * Whether ticking `title` off finishes what `text` remembers.
 *
 * Full coverage rather than a ratio, and the title's words rather than the
 * record's: the title is the short side, and asking "is every real word of the
 * finished thing in this memory" is a question with an obvious right answer,
 * where a ratio is a threshold to argue about. It errs towards closing nothing
 * — a memory left open is the state everything was already in, while closing
 * the wrong one takes something true out of her prompt.
 */
export function closesEvent(title: string, text: string): boolean {
  const wanted = [...keywords(title)].filter(word => !TASK_VERBS.has(word));
  if (!wanted.length) return false;
  const has = keywords(text);
  return wanted.every(word => has.has(word));
}

/**
 * A thing she was told is finished stops being volunteered.
 *
 * applyDecay retires a memory for going quiet, which is the wrong reason for an
 * event that is simply over: "Rental inspection went well" and "Fan hub
 * installation postponed" competed for room in every prompt until their 45-day
 * clock ran out, six weeks after they stopped being news. Ticking the item off
 * is the moment the answer is known, and nothing was listening for it — not one
 * record in the live store had ever been closed.
 *
 * Dormant rather than archived: she still knows it happened and will say so if
 * asked, she just stops bringing it up. Reversible, because a tick can be
 * undone and then it was never finished at all.
 */
export function closeEvents(memories: MemoryRecord[], title: string, now: string, done = true): { memories: MemoryRecord[]; changed: MemoryRecord[] } {
  const from: MemoryStatus = done ? 'active' : 'dormant';
  const to: MemoryStatus = done ? 'dormant' : 'active';
  const changed: MemoryRecord[] = [];
  const out = memories.map(memory => {
    if (memory.kind !== 'event' || (memory.status ?? 'active') !== from) return memory;
    if (memory.supersededBy || !closesEvent(title, memory.text)) return memory;
    const updated: MemoryRecord = {
      ...memory,
      status: to,
      evidence: [...(memory.evidence ?? []), {
        at: now, kind: 'closed' as const, source: memory.source ?? 'conversation',
        detail: done ? `"${title}" ticked off` : `"${title}" un-ticked`,
      }],
    };
    changed.push(updated);
    return updated;
  });
  return { memories: changed.length ? out : memories, changed };
}

// Old flat records predate kinds and counters; they are read forward rather than
// dropped, since they are the only history an existing user has.
export function migrateMemories(saved: unknown, now: string): MemoryRecord[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Partial<MemoryRecord>;
    if (typeof record.text !== 'string' || !record.text.trim()) return [];
    const mentions = typeof record.mentions === 'number' && record.mentions > 0 ? record.mentions : 1;
    const kind = MEMORY_KINDS.includes(record.kind as MemoryKind) ? record.kind as MemoryKind : 'fact';
    const text = record.text.trim();
    const createdAt = typeof record.createdAt === 'string' ? record.createdAt : now;
    return [{
      id: typeof record.id === 'string' ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      kind,
      subject: typeof record.subject === 'string' ? record.subject : undefined,
      createdAt,
      lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : (typeof record.createdAt === 'string' ? record.createdAt : now),
      mentions,
      // v2 fields. Legacy records have none of them; they are derived here so
      // old data gains the new lifecycle without being rewritten by hand, and
      // the derivation is idempotent — a record that already has a field keeps
      // it.
      confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.min(1, Math.max(0, record.confidence))
        : mentionConfidence(mentions, baseConfidence('conversation')),
      importance: typeof record.importance === 'number' && Number.isFinite(record.importance)
        ? Math.min(1, Math.max(0, record.importance))
        : scoreImportance(kind, text),
      source: MEMORY_SOURCES.includes(record.source as MemorySource) ? record.source as MemorySource : 'conversation',
      status: MEMORY_STATUSES.includes(record.status as MemoryStatus) ? record.status as MemoryStatus : 'active',
      memoryType: MEMORY_TYPES.includes(record.memoryType as MemoryType) ? record.memoryType as MemoryType : guessMemoryType(kind, text),
      predicate: typeof record.predicate === 'string' ? record.predicate : undefined,
      object: typeof record.object === 'string' ? record.object : undefined,
      evidence: Array.isArray(record.evidence)
        ? record.evidence.filter(entry => entry && typeof entry.at === 'string' && EVIDENCE_KINDS.includes(entry.kind))
        : [{ at: createdAt, kind: 'statement', source: 'conversation' }],
      mergedFrom: Array.isArray(record.mergedFrom) ? record.mergedFrom.filter(id => typeof id === 'string') : undefined,
      conflictsWith: Array.isArray(record.conflictsWith) ? record.conflictsWith.filter(id => typeof id === 'string') : undefined,
      // Carried like the two above it. Left out, every read quietly revived what
      // had been replaced: "lives in Manchester" came back alongside "lives in
      // Sheffield", and the next write put the resurrection on disk.
      supersededBy: typeof record.supersededBy === 'string' ? record.supersededBy : undefined,
    }];
  });
}

// -- confidence --------------------------------------------------------------

export const CONFIDENCE = {
  explicitBase: 0.9,
  conversationBase: 0.8,
  inferredBase: 0.55,
  activityBase: 0.45,
  repeatedStep: 0.03,
  confirmationStep: 0.05,
  contradictionPenalty: 0.3,
  max: 0.98,
  min: 0.1,
} as const;

/** How believable a brand-new memory is, from where it came. */
export function baseConfidence(source: MemorySource): number {
  switch (source) {
    case 'explicit': return CONFIDENCE.explicitBase;
    case 'inferred': return CONFIDENCE.inferredBase;
    case 'activity': return CONFIDENCE.activityBase;
    case 'import': return CONFIDENCE.conversationBase;
    default: return CONFIDENCE.conversationBase;
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Confidence grows with every consistent repeat, capped so no memory is ever
 *  held as certain beyond reasonable doubt. */
export function mentionConfidence(mentions: number, base: number): number {
  const gained = Math.max(0, (mentions - 1)) * CONFIDENCE.repeatedStep;
  return round2(Math.min(CONFIDENCE.max, Math.max(CONFIDENCE.min, base + gained)));
}

export function withConfirmation(confidence: number): number {
  return round2(Math.min(CONFIDENCE.max, confidence + CONFIDENCE.confirmationStep));
}

export function withContradiction(confidence: number): number {
  return round2(Math.max(CONFIDENCE.min, confidence - CONFIDENCE.contradictionPenalty));
}

// -- importance --------------------------------------------------------------

/**
 * Importance is independent of recency on purpose: a fact mentioned yesterday
 * must not outrank one from months ago that shapes every conversation. These
 * are deterministic heuristics rather than another model call — the judgement
 * has to be explainable and cheap (memory.ts already refuses to trust the
 * model with worthiness, see isWorthRemembering).
 */

/**
 * Two tiers where there was one.
 *
 * One list held health, "never forget", birthdays and addresses alongside
 * project, company, work and job — and every match scored 0.8, which is the
 * tier that never decays and is offered on every turn whatever the message.
 * For a user who runs a company that meant most of what he said was
 * permanent: "wants 6 mailboxes total for The PC Project" was in the prompt
 * for "2+2", and would have been in it in ten years. The word "project"
 * was doing what only "allergic" should.
 *
 * LASTING is what must never be forgotten and shapes every conversation:
 * health, the things they said mattered, dates, contact details, and who
 * they are — founder, director, owner — since identity outlives the work.
 * LIVING is the work itself: real, worth 0.6 (a 180-day half-life, offered
 * when the message touches it), and allowed to fade when it is over.
 */
const LASTING_TOPICS = /\b(medicat\w+|allerg\w+|diabet\w+|health\w+|diagnos\w+|therap\w+|important\b|never\s+forget|birthday\w*|anniversar\w*|wedding\w*|address\b|phone\w*\s+number\b|founder\w*|founded|co-?founder\w*|ceo\b|director\w*|owner\w*|owns\s+(a|the)\b)\b/i;

const LIVING_TOPICS = /\b(project\w*|compan\w+|business\w*|work\b|job\b|income\w*|rent\w*|mortgage\w*|deadline\w*)\b/i;

/** Either tier — what isWorthAnEvent means by "about something that matters". */
const IMPORTANT_TOPICS = new RegExp(`${LASTING_TOPICS.source}|${LIVING_TOPICS.source}`, 'i');

const TRIVIAL_TOPICS = /\b(youtube|video\b|clip\b|stream\b|episode\b|manga\b|anime\b|game\b|steam\b|browser\b|tab\b|window\b|download\w*|watched\b|played\b)\b/i;

export function scoreImportance(kind: MemoryKind, text: string): number {
  const said = text ?? '';
  switch (kind) {
    // These shape how she talks to him — always in the prompt, so they are
    // always important.
    case 'preference': return 0.85;
    case 'relationship': return 0.8;
    // A moment in time matters while it is current and as history afterwards.
    case 'event': return 0.45;
    default: {
      if (LASTING_TOPICS.test(said)) return 0.8;
      if (LIVING_TOPICS.test(said)) return 0.6;
      if (TRIVIAL_TOPICS.test(said)) return 0.2;
      // Something nameable — a person, a place, a project — is worth more than
      // a generic sentence about now.
      if (namesSomething(said)) return 0.6;
      return 0.4;
    }
  }
}

// -- memory types ------------------------------------------------------------

/** How a memory behaves, derived from its kind and wording. */
export function guessMemoryType(kind: MemoryKind, text: string): MemoryType {
  switch (kind) {
    case 'relationship': return 'relational';
    case 'event': return 'episodic';
    case 'preference': return PROCEDURAL_WORDING.test(text ?? '') ? 'procedural' : 'semantic';
    default: return PROCEDURAL_WORDING.test(text ?? '') ? 'procedural' : 'semantic';
  }
}

// A tendency rather than a stance: "usually", "commonly", "tends to" describe
// how the user goes about things; "does not like to X" is a preference about
// how Haru behaves, not a pattern of the user's own doing.
const PROCEDURAL_WORDING = /\b(often|usually|commonly|always|tends? to|prefers? to|typically)\b/i;
