import {corePolicySync} from './core-policy-sync';
import { docDigest } from './core-store';
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

import { EMOTIONS, localEmotion, type EmotionName } from './emotion';
import { CATEGORY_MEANING, categoryOf, isCategory, isDay, type Category } from './categories';

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
  /** Last substantive edit; sightings do not change this revision. */
  updatedAt?: string;
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
  /**
   * The mood the user was in when this was written, and how strongly — stamped
   * at write time from their message by localEmotion/readTone. Retrieval
   * favours a memory that matched how the moment felt, not just what was said:
   * an irritated "never mind" should surface the memory that was made the last
   * time it stung, even when the words do not overlap. Untagged records fall
   * back to the neutral baseline, so this never hurts what has none.
   */
  emotion?: EmotionName;
  emotionIntensity?: number;
  /** The observed moments behind this memory, oldest first. */
  evidence?: EvidenceEntry[];
  /** Ids of memories folded into this one by consolidation. */
  mergedFrom?: string[];
  /** Ids of memories that claim the opposite of this one. */
  conflictsWith?: string[];
  /**
   * What this is, finer than `kind`, as sorted by the model (categories.ts).
   * Absent until it has been sorted; categoryOf guesses in the meantime.
   */
  category?: Category;
  /** For a plan or an event, the day it is or was (YYYY-MM-DD), when one could be worked out. */
  when?: string;
};

export type SessionSummary = {
  /** The chat day this covers. */
  day: string;
  summary: string;
  createdAt: string;
};

/** A finished month, folded from its day notes — the L1 layer. Nothing is
 *  discarded by the fold: the day notes stay in sessions, the raw days stay in
 *  the archive, and recall still searches both. This is the compact layer the
 *  prompt reads for anything older than the recent-day window. */
export type MonthNote = {
  /** The month this covers, YYYY-MM. */
  month: string;
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
  return corePolicySync<ReturnType<typeof daysRaised>>('memory-policy.daysRaised', [memory]);
}

export function isRecurring(memory: MemoryRecord): boolean {
  return corePolicySync<ReturnType<typeof isRecurring>>('memory-policy.isRecurring', [memory]);
}

// Anchored loosely rather than at the start: "so do you remember" and "wait,
// what did I say about" both ask the same thing partway into a sentence.
const EXPLICIT_RECALL = /\b(do you remember|d'?you remember|remember when|remember what|we (talked|spoke) about|we discussed|you know how (i|we)|what did (i|you) say about|what did i tell you about|last time (we|i)|recall when|recall what)\b/i;

/** Asking her to reach back rather than just answer from what's in front of her — worth a wider search than the usual per-message budget. */
export function isExplicitRecall(text: string): boolean {
  return corePolicySync<ReturnType<typeof isExplicitRecall>>('memory-policy.isExplicitRecall', [text]);
}

/** How many memories a turn gets when they've explicitly asked her to recall something, instead of the usual `selectMemories` default. */
export const DEEP_RECALL_LIMIT = 36;

// The records that shape how she talks whatever the subject: his rules for her,
// his tastes and his people. Everything else competes for room.
const ALWAYS_INCLUDED: Category[] = ['instruction', 'preference', 'person'];

/**
 * How much a record matters, from what it is.
 *
 * The stored importance was scored once, at write time, from the kind the
 * writer chose and a regex over the words — so "Works a long day from 10am to
 * 4pm, then an event" scored 0.85 for the word "work" and was never going to
 * fade, while a one-day schedule is exactly what should. Once a record has been
 * sorted, its category says how long it deserves: rules, people and who he is
 * for good; tastes and the two of them for a long while; plans and things under
 * way while they last; a day's event never permanently; passing not at all.
 * Derived rather than written back, so sorting a record never has to win a sync.
 */
export function importanceOf(memory: MemoryRecord, now?: Date): number {
  return corePolicySync<ReturnType<typeof importanceOf>>('memory-policy.importanceOf', [memory, now]);
}

export const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'my', 'me', 'i', 'you', 'your', 'it', 'that', 'this', 'they', 'them', 'has', 'have', 'had', 'do', 'does', 'did', 'so', 'if', 'as', 'by', 'from', 'up', 'out', 'not', 'can', 'will', 'just', 'what', 'when', 'how', 'who']);

export function keywords(text: string): Set<string> {
  return new Set(corePolicySync<string[]>('memory-policy.keywords', [text]));
}

/** Conservative identity: keep names, numbers and polarity. Similar topics are
 * not identical claims. Only a trailing explanatory clause may add detail. */
function claimWords(text: string): string[] {
  return text.toLowerCase().replace(/[’]/g, "'")
    .replace(/\b(?:doesn't|don't|isn't|aren't|can't|cannot)\b/g, ' not ')
    .replace(/\b(?:called|named)\b/g, 'name')
    .match(/[\p{L}\p{N}']+/gu)?.filter(word => word === 'not' || !STOP_WORDS.has(word))
    .filter(word => !['user', 'they', 'their'].includes(word)) ?? [];
}

export function isSameMemory(a: string, b: string): boolean {
  return corePolicySync<ReturnType<typeof isSameMemory>>('memory-policy.isSameMemory', [a, b]);
}

function assertionWords(text: string): string[] {
  // A named relative can be expressed in either direction without changing
  // who the name belongs to. Keep this rewrite limited to explicit copulas.
  text = text.replace(/^\s*([\p{L}][\p{L}'-]*(?: [\p{L}][\p{L}'-]*){0,2}) is (?:my|their|the user's) (brother|sister|mother|father|girlfriend|boyfriend|partner|wife|husband|friend)\b/iu, 'My $2 is $1');
  return claimWords(text.replace(/\b(?:I'm|I am)\b/gi, 'I').replace(/\b(?:actually|correction|update|remember|in real life)\b/gi, ' ').replace(/\b(?:prefers?|wants?)\b/gi, 'prefer').replace(/\b(?:does not like|do not like|dislikes?|hate[sd]?)\b/gi, 'not like')
    .replace(/\b(?:please stop|stop) (?:calling|being called)\b/gi, 'not like name')
    .replace(/\b(?:goes by|call me)\b/gi, 'name')
    .replace(/\b(?:calling)\b/gi, 'name')
    .replace(/\b(?:real|please|being|shifts?|name)\b/gi, ' '))
    .filter(word => word !== 'name')
    .map(word => word.length > 3 ? word.replace(/(?:ing|ed|s)$/, '') : word);
}

/** Only attributable assertions can become personal facts. This deliberately
 * refuses uncertain paraphrases rather than treating lexical overlap as proof. */
export function isInTheirWords(fact: string, said: string): boolean {
  return corePolicySync<ReturnType<typeof isInTheirWords>>('memory-policy.isInTheirWords', [fact, said]);
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
].join('|'), 'i');

export function isAboutTheConversation(text: string): boolean {
  return corePolicySync<ReturnType<typeof isAboutTheConversation>>('memory-policy.isAboutTheConversation', [text]);
}

/**
 * Her own nagging, written down as though it were a fact about them.
 *
 * "Don't be late for the motherboard pickup" is not something she learned; it
 * is something she wanted to say, filed where facts go. It was one of the
 * fourteen above and belongs with them.
 *
 * Asked separately from the rest, because the same wording means the opposite
 * thing depending on who wrote it. Preferences.md is the user's own page and
 * its instructions ask for exactly this form — "one bullet per preference: what
 * Haru should do or avoid" — so three of his five bullets were refused on every
 * hourly sync, 93 times each in one log, and the tally called them repeats.
 * `remember_about_user` is told to save it when they tell her to stop doing
 * something ("or you will do the same thing again tomorrow"), which is the same
 * sentence again. In their words it is the most binding kind of memory there is.
 */
const HER_OWN_NAGGING = /^\s*(don['’]?t|do not|never|remember to|make sure|be sure|hurry|get on with|go and|pick up|call|buy|finish)\b/i;

export function readsAsHerNagging(text: string): boolean {
  return corePolicySync<ReturnType<typeof readsAsHerNagging>>('memory-policy.readsAsHerNagging', [text]);
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
  return corePolicySync<ReturnType<typeof bansATopic>>('memory-policy.bansATopic', [text]);
}

/** `meantAsARule` is a line somebody set on purpose rather than a note she
 *  composed about them: his vault pages, the desk's add box, what
 *  `remember_about_user` is handed when they say to stop doing something, and
 *  her own standings about how she is treated. All of those are imperative by
 *  nature, which is the one shape the nagging test refuses. */
export function isWorthRemembering(text: string, options: { meantAsARule?: boolean } = {}): boolean {
  return corePolicySync<ReturnType<typeof isWorthRemembering>>('memory-policy.isWorthRemembering', [text, options]);
}

/**
 * Adds a memory, or records another mention of one already held. Returns the
 * updated list and whether this was new, so the caller can tell the model
 * whether it has just learned something or merely repeated itself.
 */
export function rememberInto(
  memories: MemoryRecord[],
  incoming: { text: string; kind: MemoryKind; subject?: string; id: string; now: string; source?: MemorySource; predicate?: string; object?: string; evidenceDetail?: string; emotion?: EmotionName; emotionIntensity?: number; resighting?: boolean; category?: Category; when?: string },
): { memories: MemoryRecord[]; created: boolean; record: MemoryRecord } {
  return corePolicySync<ReturnType<typeof rememberInto>>('memory-policy.rememberInto', [memories, incoming]);
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
  return corePolicySync<PruneResult>('memory-policy.pruneMemories', [memories, limit, new Date()]);
}

/** Categories the cap never takes while anything else can go: who he is, his
 *  people, his rules and tastes, the two of them, and what he taught her. */
const LASTING: Category[] = ['identity', 'person', 'instruction', 'preference', 'shared', 'knowledge'];

function pruneScore(memory: MemoryRecord): number {
  const now = new Date();
  const importance = importanceOf(memory, now);
  const confidence = memory.confidence ?? 0.5;
  // Sorted as not worth keeping: first out, whatever its counts say.
  if (categoryOf(memory) === 'passing') return -1 / (1 + memory.mentions);
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
  return corePolicySync<ReturnType<typeof applyDecay>>('memory-policy.applyDecay', [memories, now]);
}

export function recurringMemories(memories: MemoryRecord[]) {
  return corePolicySync<MemoryRecord[]>('memory-policy.recurringMemories', [memories]);
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
  return corePolicySync<ReturnType<typeof findSuperseded>>('memory-policy.findSuperseded', [memories, hint]);
}

/** Preserve history; never turn a record into its own replacement or a cycle. */
export function supersede(memories: MemoryRecord[], oldId: string, newId: string, now = new Date().toISOString()): MemoryRecord[] {
  return corePolicySync<ReturnType<typeof supersede>>('memory-policy.supersede', [memories, oldId, newId, now]);
}

/**
 * Chooses what to put in front of her for this message. Preferences and
 * relationships always go in — they shape how she talks regardless of subject.
 * Everything else has to earn its place by relating to what was just said, so a
 * long memory does not crowd out the conversation.
 */
export function selectMemories(memories: MemoryRecord[], message: string, limit = 14): MemoryRecord[] {
  return corePolicySync<ReturnType<typeof selectMemories>>('memory-policy.selectMemories', [memories, message, limit]);
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
  return corePolicySync<ReturnType<typeof memoryHalfLifeDays>>('memory-policy.memoryHalfLifeDays', [importance]);
}

export function memoryRecency(lastSeenAt: string, now: Date, halfLifeDays: number): number {
  return corePolicySync<ReturnType<typeof memoryRecency>>('memory-policy.memoryRecency', [lastSeenAt, now, halfLifeDays]);
}

/** Memories at or above this importance are always offered, like preferences. */
export const ALWAYS_IMPORTANT = 0.8;

/** How much a memory type is worth when the topic matches at all. */
function typeWeight(category: Category): number {
  switch (category) {
    case 'instruction':
    case 'preference':
    case 'person': return 1;
    case 'identity':
    case 'shared':
    case 'knowledge': return 0.9;
    case 'plan':
    case 'ongoing':
    case 'event': return 0.85;
    case 'passing': return 0;
  }
}

/** A dormant memory has to be clearly on-topic to come back, not just vaguely
 *  related — silence since then means the tie has to be argued for. One shared
 *  content word out of three is enough to argue with. */
const DORMANT_ADMISSION = 0.25;

// -- entity signal -------------------------------------------------------------
//
// The triples (subject/predicate/object) are written by the model and read
// nowhere — this is the read side. A memory's entities are the proper nouns of
// its text plus the words of its triple; a query's are the proper nouns of the
// message. A shared entity boosts a memory the keywords would miss: "They run
// the shop together" (subject: PC Project) surfaces for "how is the PC Project
// doing" even though the two share no content words. The same signal Graphiti
// and Mem0 buy with a graph database, done with what is already on the record.

/**
 * Proper-noun candidates in a line. A capitalised word is an entity only when
 * every occurrence of it is capitalised — "The bins go out. The shop…" has
 * "the" lowercase twice, so neither capital is a name; "Emma", capitalised
 * every time, is.
 */
export function entityTerms(text: string): Set<string> {
  return new Set(corePolicySync<string[]>('memory-policy.entityTerms', [text]));
}

/** Everything a memory can be named by: its proper nouns plus its triple's words. */
export function memoryEntities(memory: MemoryRecord): Set<string> {
  return new Set(corePolicySync<string[]>('memory-policy.memoryEntities', [memory]));
}

/** How much of what the query names this memory is named by, 0..1. Nothing on
 *  either side to compare means no signal at all. */
export function entityScore(query: string, memory: MemoryRecord): number {
  return corePolicySync<ReturnType<typeof entityScore>>('memory-policy.entityScore', [query, memory]);
}

export type RetrieveOptions = {
  limit?: number;
  /**
   * How related a record that is not always offered has to be — the best of
   * its semantic, keyword and entity match — to come back at all. Zero (the
   * default) keeps the old rule, where any overlap counted: fine for a tool
   * asking about one topic, too loose for the prompt, where "good morning"
   * shares a word with half of what she knows.
   */
  floor?: number;
  /**
   * The message just sent, on its own, beside the query it is part of. The
   * query is his last few lines run together, which is what lets "how did we
   * fix it?" find anything — but it also means three earlier lines about
   * something else dilute the one he just asked: with real earlier lines in
   * front of them, questions about a remembered thing found it 26 times in 35
   * instead of 35 (2026-09-17). Each signal is taken as the better of the two.
   */
  focus?: { message: string; semantic?: Map<string, number> };
  /** id → semantic similarity (0..1), computed by the caller with an embedder.
   *  Absent or missing ids fall back to the keyword score. */
  semantic?: Map<string, number>;
  now?: Date;
};

export type RetrievalFactors = {
  semantic: number;
  keyword: number;
  relevance: number;
  entity: number;
  emotion: number;
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
  return corePolicySync<ScoredMemory[]>('memory-policy.retrieveMemories', [memories, message, {...options, now:options.now ?? new Date(), semantic:options.semantic ? [...options.semantic] : undefined, focus:options.focus ? {...options.focus, semantic:options.focus.semantic ? [...options.focus.semantic] : undefined} : undefined}]);
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
  return corePolicySync<ReturnType<typeof calibrateSimilarity>>('memory-policy.calibrateSimilarity', [cosine]);
}

/** Precompute id → semantic similarity for every memory that has a vector:
 *  the cosine to the query's own embedding, calibrated so unrelated is zero. */
export function semanticSimilarities(memories: MemoryRecord[], queryVector: number[], vectors: Map<string, number[]>): Map<string, number> {
  // 3490: the policy reads only each memory's id, and the vectors (≈325 KB as JSON) change only when a memory is embedded,
  // so they cross as a document reference (sent once per version). Twice a turn this was ~55 ms.
  const list = [...vectors];
  return new Map(corePolicySync<[string, number][]>('memory-policy.semanticSimilarities', [memories.map(m => ({ id: m.id })), queryVector, { $doc: 'memory-vectors', digest: docDigest(list), body: list }]));
}

/** 3490: the migrated records for a saved memories document, recomputed only when that document changes. getMemories()
 *  migrated on every read: eleven policy calls a turn carrying the 40 KB document each (~35 ms). Callers get a copy. */
export function memoriesReader(read: () => unknown, migrate: (saved: unknown, now: string) => MemoryRecord[] = migrateMemories): () => MemoryRecord[] {
  let held: { key: string; value: MemoryRecord[] } | null = null;
  return () => {
    const saved = read();
    const key = docDigest(saved);
    if (!held || held.key !== key) held = { key, value: migrate(saved, new Date().toISOString()) };
    return structuredClone(held.value);
  };
}

/** Cosine similarity between two memory vectors; undefined when either side
 *  has none, so callers can fall back to keyword scoring. */
export function vectorSimilarity(a: number[] | undefined, b: number[] | undefined): number | undefined {
  return corePolicySync<number | null>('memory-policy.vectorSimilarity', [a, b]) ?? undefined;
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
  return corePolicySync<ReturnType<typeof formatMemoryPrompt>>('memory-policy.formatMemoryPrompt', [memories, sessions]);
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
  return corePolicySync<string>('memory-policy.summaryPrompt', []);
}

/**
 * The L1 fold: a finished month's day notes, condensed to one line of her own.
 *
 * The day notes are already third-person and factual, so the fold has less to
 * be careful about than a raw transcript — it keeps what held, drops what
 * passed, and must not invent a name or number the days never carried.
 */
export function monthFoldPrompt(month: string) {
  return corePolicySync<string>('memory-policy.monthFoldPrompt', [month]);
}

/** Said again, harder, when the first answer came back addressed to somebody. */
export const THIRD_PERSON_AGAIN = 'That was addressed to a person. Write it again about the user in the third person, using "they", with no "you" or "your" anywhere.';

/**
 * Whether a note talks to somebody instead of about them. Used to catch the
 * drift the prompt above is meant to prevent — a deterministic backstop behind
 * an instruction, because the instruction demonstrably was not enough.
 */
export function readsAsSecondPerson(text: string): boolean {
  return corePolicySync<ReturnType<typeof readsAsSecondPerson>>('memory-policy.readsAsSecondPerson', [text]);
}

export function isWorthKeeping(summary: string) {
  return corePolicySync<boolean>('memory-policy.isWorthKeeping', [summary]);
}

/**
 * The second pass over a finished day: not a summary of what was said, but the
 * one-off events worth promoting from that day into long-term memory. Kept
 * separate from summaryPrompt because the summary is a single line for recall
 * while this feeds the memory engine.
 */
export function eventsPrompt() {
  return corePolicySync<string>('memory-policy.eventsPrompt', []);
}

/** One extracted event line, cleaned for the memory gate. */
export function eventCandidates(reply: string): string[] {
  return corePolicySync<ReturnType<typeof eventCandidates>>('memory-policy.eventCandidates', [reply]);
}

// -- forming memories from a day ------------------------------------------------

/** Categories a day's conversation can form; passing is what is left out. */
export const FORMED: Category[] = ['identity', 'person', 'preference', 'instruction', 'plan', 'event', 'ongoing', 'shared', 'knowledge'];
/** How much of a day one call reads. A long day is several windows, not its first six thousand characters. */
export const FORMATION_WINDOW = 8000;
/** How many a day may form, across all its windows. */
export const MEMORIES_PER_DAY = 10;

/**
 * What a finished day taught her about him, of every kind.
 *
 * The pass this replaces asked for events only, three a day, from the first
 * 6,000 characters. On the 27B brain it formed nothing at all: replayed over
 * six real days from September, not one line survived, while the same days
 * held a customer's build fixed by the wrong boot drive, an early Father's Day
 * dinner with his mum and Johnny, and how to flash an MSI BIOS from a USB stick.
 * And nothing else writes conversation memories in practice — the hosted brain
 * has not called remember_about_user once in the log (2026-09-17). So the whole
 * day is read, a window at a time, for anything worth keeping, each line with
 * its category and day, and what she already knows is listed so it is not
 * written down again.
 */
export function formationPrompt(day: string, known: string[], userName = ''): string {
  return corePolicySync<ReturnType<typeof formationPrompt>>('memory-policy.formationPrompt', [day, known, userName]);
}

export type FormedNote = { category: Category; when?: string; note: string };

/** The day's notes, read strictly: a line not in the shape, or in a category a day cannot form, is left out. */
export function readFormation(answer: string): FormedNote[] {
  return corePolicySync<ReturnType<typeof readFormation>>('memory-policy.readFormation', [answer]);
}

/** A day's labelled lines in windows of at most `size` characters, whole lines only. */
export function formationWindows(lines: string[], size = FORMATION_WINDOW): string[] {
  return corePolicySync<ReturnType<typeof formationWindows>>('memory-policy.formationWindows', [lines, size]);
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
  return corePolicySync<ReturnType<typeof isWorthAnEvent>>('memory-policy.isWorthAnEvent', [text]);
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
  return corePolicySync<ReturnType<typeof closesEvent>>('memory-policy.closesEvent', [title, text]);
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
  {
    const result = corePolicySync<ReturnType<typeof closeEvents>>('memory-policy.closeEvents', [memories, title, now, done]);
    return {...result, memories:result.changed.length ? result.memories : memories};
  }
}

// Old flat records predate kinds and counters; they are read forward rather than
// dropped, since they are the only history an existing user has.
export function migrateMemories(saved: unknown, now: string): MemoryRecord[] {
  return corePolicySync<MemoryRecord[]>('memory-policy.migrateMemories', [saved, now, Array.isArray(saved) ? saved.map(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`) : []]);
}

/**
 * The evidence log without its hourly echoes: every entry that says something
 * — a statement, a confirmation, a contradiction, a merge, a closing — plus the
 * first repeat of each day. That keeps daysRaised exactly what it was, which
 * is what the log is read for, and drops the rest: 353 hourly repeats from the
 * vault sync on "Haru, with one r" were most of memories.json (2026-09-17).
 * The desk's older copy still sends the long logs; they are tidied here, on
 * the way in, every time.
 */
export function tidyEvidence(entries: EvidenceEntry[]): EvidenceEntry[] {
  return corePolicySync<ReturnType<typeof tidyEvidence>>('memory-policy.tidyEvidence', [entries]);
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
  return corePolicySync<ReturnType<typeof baseConfidence>>('memory-policy.baseConfidence', [source]);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Confidence grows with every consistent repeat, capped so no memory is ever
 *  held as certain beyond reasonable doubt. */
export function mentionConfidence(mentions: number, base: number): number {
  return corePolicySync<ReturnType<typeof mentionConfidence>>('memory-policy.mentionConfidence', [mentions, base]);
}

export function withConfirmation(confidence: number): number {
  return corePolicySync<ReturnType<typeof withConfirmation>>('memory-policy.withConfirmation', [confidence]);
}

export function withContradiction(confidence: number): number {
  return corePolicySync<ReturnType<typeof withContradiction>>('memory-policy.withContradiction', [confidence]);
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
  return corePolicySync<ReturnType<typeof scoreImportance>>('memory-policy.scoreImportance', [kind, text]);
}

// -- memory types ------------------------------------------------------------

/** How a memory behaves, derived from its kind and wording. */
export function guessMemoryType(kind: MemoryKind, text: string): MemoryType {
  return corePolicySync<ReturnType<typeof guessMemoryType>>('memory-policy.guessMemoryType', [kind, text]);
}

// A tendency rather than a stance: "usually", "commonly", "tends to" describe
// how the user goes about things; "does not like to X" is a preference about
// how Haru behaves, not a pattern of the user's own doing.
const PROCEDURAL_WORDING = /\b(often|usually|commonly|always|tends? to|prefers? to|typically)\b/i;

/** Shared write-path retention limit. Protected records may exceed it. */
export const MEMORY_CAP = 400;
