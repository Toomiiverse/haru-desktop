import {corePolicySync} from './core-policy-sync';
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof daysRaised>>('memory-policy.daysRaised', [memory]);
  const evidence = memory.evidence ?? [];
  if (!evidence.length) return memory.mentions;
  return new Set(evidence.map(entry => entry.at.slice(0, 10))).size;
}

export function isRecurring(memory: MemoryRecord): boolean {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isRecurring>>('memory-policy.isRecurring', [memory]);
  return daysRaised(memory) >= RECURRING_THRESHOLD;
}

// Anchored loosely rather than at the start: "so do you remember" and "wait,
// what did I say about" both ask the same thing partway into a sentence.
const EXPLICIT_RECALL = /\b(do you remember|d'?you remember|remember when|remember what|we (talked|spoke) about|we discussed|you know how (i|we)|what did (i|you) say about|what did i tell you about|last time (we|i)|recall when|recall what)\b/i;

/** Asking her to reach back rather than just answer from what's in front of her — worth a wider search than the usual per-message budget. */
export function isExplicitRecall(text: string): boolean {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isExplicitRecall>>('memory-policy.isExplicitRecall', [text]);
  return EXPLICIT_RECALL.test(text);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof importanceOf>>('memory-policy.importanceOf', [memory, now]);
  const stored = memory.importance ?? 0.4;
  if (!isCategory(memory.category)) return stored;
  switch (categoryOf(memory, now)) {
    case 'instruction': return Math.max(stored, 0.85);
    case 'person':
    case 'identity': return Math.max(stored, 0.8);
    case 'preference':
    case 'shared': return 0.7;
    case 'knowledge':
    case 'plan': return 0.5;
    case 'ongoing': return 0.45;
    case 'event': return Math.min(stored, 0.6);
    case 'passing': return 0.1;
  }
}

export const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'my', 'me', 'i', 'you', 'your', 'it', 'that', 'this', 'they', 'them', 'has', 'have', 'had', 'do', 'does', 'did', 'so', 'if', 'as', 'by', 'from', 'up', 'out', 'not', 'can', 'will', 'just', 'what', 'when', 'how', 'who']);

export function keywords(text: string): Set<string> {
  if ((true as boolean)) return new Set(corePolicySync<string[]>('memory-policy.keywords', [text]));
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word)),
  );
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isSameMemory>>('memory-policy.isSameMemory', [a, b]);
  const canonical = (s: string) => claimWords(s).join(' ');
  if (canonical(a) === canonical(b)) return true;
  if (claimWords(a).includes('not') !== claimWords(b).includes('not')) return false;
  // Appositive detail is allowed only after an identical main claim.
  const left = a.split(',')[0], right = b.split(',')[0];
  return canonical(left) === canonical(right) && canonical(left).length > 0
    && (a === left || b === right);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isInTheirWords>>('memory-policy.isInTheirWords', [fact, said]);
  const wanted = assertionWords(fact ?? '');
  if (!wanted.length || !said?.trim()) return false;
  let fictional = false;
  const spans = said.split(/(?<=[.!?])\s+|(?=\b(?:but my real|in real life|outside (?:the|my) (?:story|play|novel))\b)/i);
  return spans.some(span => {
    if (/\b(?:my real|in real life|outside (?:the|my) (?:story|play|novel))\b/i.test(span)) fictional = false;
    if (/\b(?:story|novel|screenplay|script|character|narrator|fictional|hypothetical|pretend|imagine|role.?play)\b/i.test(span)) fictional = true;
    if (fictional || /["“”`]|^\s*>|\?|\b(?:if|maybe|perhaps|might|suppose|joking|joke|example)\b/i.test(span)) return false;
    const heard = assertionWords(span);
    if (wanted.includes('not') !== heard.includes('not')) return false;
    // Subject and object must stay together, in order. A friend's claim or
    // another pet's name cannot be borrowed from elsewhere in the sentence.
    return wanted.every((word, index) => heard[index] === word);
  });
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isAboutTheConversation>>('memory-policy.isAboutTheConversation', [text]);
  return ABOUT_THE_CONVERSATION.test((text ?? '').trim());
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof readsAsHerNagging>>('memory-policy.readsAsHerNagging', [text]);
  return HER_OWN_NAGGING.test((text ?? '').trim());
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof bansATopic>>('memory-policy.bansATopic', [text]);
  return A_BAN.test((text ?? '').trim());
}

/** `meantAsARule` is a line somebody set on purpose rather than a note she
 *  composed about them: his vault pages, the desk's add box, what
 *  `remember_about_user` is handed when they say to stop doing something, and
 *  her own standings about how she is treated. All of those are imperative by
 *  nature, which is the one shape the nagging test refuses. */
export function isWorthRemembering(text: string, options: { meantAsARule?: boolean } = {}): boolean {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isWorthRemembering>>('memory-policy.isWorthRemembering', [text, options]);
  const clean = (text ?? '').trim();
  if (!clean) return false;
  if (!options.meantAsARule && readsAsHerNagging(clean)) return false;
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
  incoming: { text: string; kind: MemoryKind; subject?: string; id: string; now: string; source?: MemorySource; predicate?: string; object?: string; evidenceDetail?: string; emotion?: EmotionName; emotionIntensity?: number; resighting?: boolean; category?: Category; when?: string },
): { memories: MemoryRecord[]; created: boolean; record: MemoryRecord } {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof rememberInto>>('memory-policy.rememberInto', [memories, incoming]);
  const text = incoming.text.trim();
  const existing = memories.find(memory => !memory.supersededBy && memory.status !== 'archived' && isSameMemory(memory.text, text));
  // The same line read off the same page again. The vault sync does that every
  // hour, and each pass used to count as him saying it again: "Haru, with one r"
  // reached 354 mentions and 354 evidence entries, most of memories.json by
  // size, from a page nobody had touched. Still seen — it is on the page — but
  // not said again.
  if (existing && incoming.resighting && existing.text === text) {
    const seen: MemoryRecord = { ...existing, lastSeenAt: incoming.now };
    return { memories: memories.map(memory => memory.id === existing.id ? seen : memory), created: false, record: seen };
  }
  const source = incoming.source ?? 'conversation';
  // A model repeating a guess is not independent evidence. Replaying the same
  // attributed source is likewise idempotent, including across a restart.
  if (existing && (source === 'inferred' || source === 'activity'
    || incoming.evidenceDetail && existing.evidence?.some(e => e.source === source && e.detail === incoming.evidenceDetail))) {
    return { memories, created: false, record: existing };
  }
  if (existing) {
    const promoted = source === 'explicit' && existing.source !== 'explicit';
    const base = baseConfidence(promoted ? source : existing.source ?? 'conversation');
    const updated: MemoryRecord = {
      ...existing,
      source: promoted ? source : existing.source,
      updatedAt: incoming.now,
      // The newer phrasing wins when it carries more detail.
      text: text.length > existing.text.length ? text : existing.text,
      subject: existing.subject ?? incoming.subject,
      predicate: existing.predicate ?? incoming.predicate,
      object: existing.object ?? incoming.object,
      // The first sighting's mood stands; a repeat in a fresh mood is new
      // evidence for the same claim, not a relabel.
      emotion: existing.emotion ?? incoming.emotion,
      emotionIntensity: Math.max(existing.emotionIntensity ?? 0, incoming.emotionIntensity ?? 0),
      lastSeenAt: incoming.now,
      mentions: existing.mentions + 1,
      // A consistent repeat is fresh evidence for the same claim.
      confidence: promoted ? base : Math.max(existing.confidence ?? base, base),
      evidence: [...(existing.evidence ?? []), incoming.evidenceDetail
        ? { at: incoming.now, kind: 'repeat', source, detail: incoming.evidenceDetail }
        : { at: incoming.now, kind: 'repeat', source }],
      importance: Math.max(existing.importance ?? 0, scoreImportance(existing.kind, existing.text)),
      // Said again, so it is current again: a dormant record that came back up
      // stayed dormant for good before, since decay only ever moves one way.
      // Not one that was ticked off — talking about a done thing does not undo
      // it — and not an archived one, which was shelved on purpose: taken off
      // his page, or found wrong, and a line that matches it is no reason to
      // put it back.
      status: existing.status === 'dormant' && existing.evidence?.at(-1)?.kind !== 'closed' ? 'active' : existing.status,
      // Sorted already stays sorted; the day is added if it was missing.
      ...(existing.category ?? incoming.category ? { category: existing.category ?? incoming.category } : {}),
      ...(existing.when ?? (isDay(incoming.when) ? incoming.when : undefined) ? { when: existing.when ?? incoming.when } : {}),
    };
    return { memories: memories.map(memory => memory.id === existing.id ? updated : memory), created: false, record: updated };
  }
  const record: MemoryRecord = {
    id: incoming.id,
    text,
    kind: incoming.kind,
    subject: incoming.subject,
    predicate: incoming.predicate,
    object: incoming.object,
    emotion: incoming.emotion,
    emotionIntensity: incoming.emotionIntensity,
    createdAt: incoming.now,
    updatedAt: incoming.now,
    lastSeenAt: incoming.now,
    mentions: 1,
    confidence: baseConfidence(source),
    importance: scoreImportance(incoming.kind, text),
    source,
    status: 'active',
    memoryType: guessMemoryType(incoming.kind, text),
    ...(isCategory(incoming.category) ? { category: incoming.category } : {}),
    ...(isCategory(incoming.category) && isDay(incoming.when) ? { when: incoming.when } : {}),
    evidence: [incoming.evidenceDetail
      ? { at: incoming.now, kind: source === 'inferred' ? 'inference' : 'statement', source, detail: incoming.evidenceDetail }
      : { at: incoming.now, kind: source === 'inferred' ? 'inference' : 'statement', source }],
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
  if ((true as boolean)) return corePolicySync<PruneResult>('memory-policy.pruneMemories', [memories, limit, new Date()]);
  if (memories.length <= limit) return { memories, evicted: [] };
  const archived = memories.filter(memory => memory.status === 'archived');
  const rest = memories.filter(memory => memory.status !== 'archived');
  // Sorted records by what they are; unsorted ones by the old rule, since a
  // category guessed from a kind is not enough to make anything permanent.
  const untouchable = rest.filter(memory => isCategory(memory.category)
    ? LASTING.includes(categoryOf(memory)) || importanceOf(memory) >= ALWAYS_IMPORTANT
    : memory.kind === 'preference' || memory.kind === 'relationship' || (memory.importance ?? 0) >= ALWAYS_IMPORTANT);
  const touchable = rest.filter(memory => !untouchable.includes(memory));
  if (touchable.length <= limit - untouchable.length - archived.length) return { memories, evicted: [] };
  const scored = touchable.map(memory => ({ memory, score: pruneScore(memory) })).sort((a, b) => b.score - a.score);
  const keepCount = Math.max(0, limit - untouchable.length - archived.length);
  const kept = scored.slice(0, keepCount).map(entry => entry.memory);
  const evicted = scored.slice(keepCount).map(entry => entry.memory);
  if (!evicted.length) return { memories, evicted: [] };
  return { memories: [...kept, ...untouchable, ...archived], evicted };
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof applyDecay>>('memory-policy.applyDecay', [memories, now]);
  const transitions: DecayTransition[] = [];
  const forgotten: ForgettingEntry[] = [];
  const out: MemoryRecord[] = [];
  for (const memory of memories) {
    if (memory.supersededBy || memory.status === 'archived') {
      out.push(memory);
      continue;
    }
    const importance = importanceOf(memory, now);
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
  if ((true as boolean)) return corePolicySync<MemoryRecord[]>('memory-policy.recurringMemories', [memories]);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof findSuperseded>>('memory-policy.findSuperseded', [memories, hint]);
  const active = memories.filter(memory => !memory.supersededBy && memory.status !== 'archived');
  const exact = active.filter(memory => isSameMemory(memory.text, hint));
  if (exact.length === 1) return exact[0];
  const asked = claimWords(hint);
  if (!asked.length) return null;
  const matches = active.filter(memory => {
    const held = claimWords(memory.text);
    return asked.includes('not') === held.includes('not') && asked.every(word => held.includes(word));
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Preserve history; never turn a record into its own replacement or a cycle. */
export function supersede(memories: MemoryRecord[], oldId: string, newId: string, now = new Date().toISOString()): MemoryRecord[] {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof supersede>>('memory-policy.supersede', [memories, oldId, newId, now]);
  if (oldId === newId || !memories.some(m => m.id === newId)) return memories;
  const seen = new Set([oldId]);
  let cursor: string | undefined = newId;
  while (cursor) {
    if (seen.has(cursor)) return memories;
    seen.add(cursor);
    cursor = memories.find(m => m.id === cursor)?.supersededBy;
  }
  return memories.map(memory => memory.id === oldId ? { ...memory, supersededBy: newId, updatedAt: now } : memory);
}

/**
 * Chooses what to put in front of her for this message. Preferences and
 * relationships always go in — they shape how she talks regardless of subject.
 * Everything else has to earn its place by relating to what was just said, so a
 * long memory does not crowd out the conversation.
 */
export function selectMemories(memories: MemoryRecord[], message: string, limit = 14): MemoryRecord[] {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof selectMemories>>('memory-policy.selectMemories', [memories, message, limit]);
  // Superseded records are history, not current knowledge — they stay in the
  // store for findSuperseded to search, but never surface in a prompt.
  const active = memories.filter(memory => !memory.supersededBy && categoryOf(memory) !== 'passing');
  const always = active.filter(memory => ALWAYS_INCLUDED.includes(categoryOf(memory)));
  const rest = active.filter(memory => !ALWAYS_INCLUDED.includes(categoryOf(memory)));
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof memoryHalfLifeDays>>('memory-policy.memoryHalfLifeDays', [importance]);
  if (importance >= 0.8) return 10 * 365;
  if (importance >= 0.5) return 180;
  return 45;
}

export function memoryRecency(lastSeenAt: string, now: Date, halfLifeDays: number): number {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof memoryRecency>>('memory-policy.memoryRecency', [lastSeenAt, now, halfLifeDays]);
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return 0;
  const days = Math.max(0, (now.getTime() - seen) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
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
  if ((true as boolean)) return new Set(corePolicySync<string[]>('memory-policy.entityTerms', [text]));
  const words = String(text ?? '').split(/\s+/)
    .map(word => word.replace(/[^a-zA-Z'’]/g, ''))
    .filter(word => word.length >= 3);
  const lower = new Map<string, number>();
  for (const word of words) {
    const key = word.toLowerCase();
    lower.set(key, (lower.get(key) ?? 0) + 1);
  }
  const capped = new Map<string, number>();
  for (const word of words) {
    if (!/^[A-Z][a-z'’]*$/.test(word)) continue;
    const key = word.toLowerCase();
    capped.set(key, (capped.get(key) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [key, count] of capped) {
    if (STOP_WORDS.has(key)) continue;
    if (lower.get(key) === count) out.add(key);
  }
  return out;
}

/** Everything a memory can be named by: its proper nouns plus its triple's words. */
export function memoryEntities(memory: MemoryRecord): Set<string> {
  if ((true as boolean)) return new Set(corePolicySync<string[]>('memory-policy.memoryEntities', [memory]));
  const out = entityTerms(memory.text);
  for (const part of [memory.subject, memory.object, memory.predicate]) {
    if (!part) continue;
    for (const word of keywords(part)) out.add(word);
  }
  return out;
}

/** How much of what the query names this memory is named by, 0..1. Nothing on
 *  either side to compare means no signal at all. */
export function entityScore(query: string, memory: MemoryRecord): number {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof entityScore>>('memory-policy.entityScore', [query, memory]);
  const asked = entityTerms(query);
  const held = memoryEntities(memory);
  if (!asked.size || !held.size) return 0;
  const shared = [...asked].filter(word => held.has(word)).length;
  return Math.min(1, shared / asked.size);
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
  if ((true as boolean)) return corePolicySync<ScoredMemory[]>('memory-policy.retrieveMemories', [memories, message, {...options, now:options.now ?? new Date(), semantic:options.semantic ? [...options.semantic] : undefined, focus:options.focus ? {...options.focus, semantic:options.focus.semantic ? [...options.focus.semantic] : undefined} : undefined}]);
  const now = options.now ?? new Date();
  // Fourteen was the budget when an eight-thousand-token local model answered
  // every turn. She holds fifty-odd records and the window is a million.
  const limit = options.limit ?? 22;
  const asked = keywords(message);
  // The mood of the message, for the emotion signal: a memory written in the
  // same mood gets a small boost, so what stung before surfaces when it stings
  // again. Heuristic and cheap — localEmotion is pure text work.
  const queryEmotion = localEmotion(message);
  const always: ScoredMemory[] = [];
  const scored: ScoredMemory[] = [];

  for (const memory of memories) {
    if (memory.supersededBy) continue;                    // replaced — history only
    if (memory.status === 'archived') continue;           // shelved — must be unarchived deliberately
    const category = categoryOf(memory, now);
    if (category === 'passing') continue;                 // sorted as not worth keeping
    const importance = importanceOf(memory, now);
    const confidence = memory.confidence ?? 0.5;
    const focus = options.focus;
    const keyword = Math.max(asked.size ? keywordSimilarity(message, memory.text) : 0, focus?.message ? keywordSimilarity(focus.message, memory.text) : 0);
    const semantic = Math.max(options.semantic?.get(memory.id) ?? keyword, focus?.semantic?.get(memory.id) ?? 0);
    // The two new signals share a tenth of the relevance, so neither can move
    // a ranking the words disagree with — they settle the ties the words leave.
    const entity = Math.max(entityScore(message, memory), focus?.message ? entityScore(focus.message, memory) : 0);
    const affinity = memory.emotion && memory.emotion === queryEmotion
      ? 0.5 + 0.5 * (memory.emotionIntensity ?? 0.5)
      : 0.15;
    const relevance = 0.4 * semantic + 0.3 * keyword + 0.2 * typeWeight(category) + 0.05 * entity + 0.05 * affinity;
    const recency = memoryRecency(memory.lastSeenAt, now, memoryHalfLifeDays(importance));
    const entry: ScoredMemory = {
      memory,
      score: relevance * (0.4 + 0.6 * importance) * (0.5 + 0.5 * confidence) * recency,
      factors: {
        semantic, keyword, relevance,
        entity,
        emotion: affinity,
        importance: 0.4 + 0.6 * importance,
        confidence: 0.5 + 0.5 * confidence,
        recency,
        type: typeWeight(category),
      },
    };
    // Preferences, relationships and anything of high importance shape how she
    // talks whatever the topic is. Everything else has to actually relate to
    // what was said — keyword or semantic overlap — or be something that keeps
    // coming back on its own.
    const keptAlive = ALWAYS_INCLUDED.includes(category) || importance >= ALWAYS_IMPORTANT;
    const floor = options.floor ?? 0;
    const match = Math.max(semantic, keyword, floor > 0 ? entity : 0);
    const related = floor > 0 ? match >= floor : match > 0 || isRecurring(memory);
    if (keptAlive) always.push(entry);
    else if (memory.status === 'dormant' ? match >= Math.max(DORMANT_ADMISSION, floor) : related) scored.push(entry);
  }

  // One ranking, not two buckets in series: a highly relevant memory ranks
  // above an important one that has nothing to do with the question.
  //
  // The records that shape how she talks — his rules, his tastes, his people —
  // are promised a place whatever the message, but never more than half the
  // budget while there is anything else to show. The promise used to be kept by
  // displacing the weakest other entry, one at a time, with no end: twenty
  // preferences and relationships against a limit of twelve displaced every
  // record the message was about, and the human block, which leaves those kinds
  // to blocks of their own, rendered no memories at all. "When is my
  // psychologist appointment" had the rescheduled appointment on record, first
  // in the semantic ranking, and got none of it (2026-09-17).
  const byScore = (a: ScoredMemory, b: ScoredMemory) => b.score - a.score;
  const promised = always.filter(entry => ALWAYS_INCLUDED.includes(categoryOf(entry.memory, now))).sort(byScore);
  const promisedIds = new Set(promised.map(entry => entry.memory.id));
  const others = [...always, ...scored].filter(entry => !promisedIds.has(entry.memory.id)).sort(byScore);
  const kept = others.slice(0, Math.min(others.length, Math.floor(limit / 2)));
  const out = [...kept, ...promised.slice(0, limit - kept.length)];
  for (const entry of others.slice(kept.length)) {
    if (out.length >= limit) break;
    out.push(entry);
  }
  return out.sort(byScore);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof calibrateSimilarity>>('memory-policy.calibrateSimilarity', [cosine]);
  return Math.max(0, Math.min(1, (cosine - SEMANTIC_FLOOR) / (1 - SEMANTIC_FLOOR)));
}

/** Precompute id → semantic similarity for every memory that has a vector:
 *  the cosine to the query's own embedding, calibrated so unrelated is zero. */
export function semanticSimilarities(memories: MemoryRecord[], queryVector: number[], vectors: Map<string, number[]>): Map<string, number> {
  if ((true as boolean)) return new Map(corePolicySync<[string, number][]>('memory-policy.semanticSimilarities', [memories, queryVector, [...vectors]]));
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
  if ((true as boolean)) return corePolicySync<number | null>('memory-policy.vectorSimilarity', [a, b]) ?? undefined;
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof formatMemoryPrompt>>('memory-policy.formatMemoryPrompt', [memories, sessions]);
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
  if ((true as boolean)) return corePolicySync<string>('memory-policy.summaryPrompt', []);
  return [
    'Summarise this conversation in one sentence, under 25 words, as a note to your future self.',
    'The note is about the user. Call them "they" — never "you" or "your", which in your own notes mean you, Haru.',
    'Record what they were doing or dealing with, not what you said back.',
    'Skip greetings and small talk. If nothing of substance happened, reply with exactly: nothing notable.',
    'Reply with the sentence only.',
  ].join(' ');
}

/**
 * The L1 fold: a finished month's day notes, condensed to one line of her own.
 *
 * The day notes are already third-person and factual, so the fold has less to
 * be careful about than a raw transcript — it keeps what held, drops what
 * passed, and must not invent a name or number the days never carried.
 */
export function monthFoldPrompt(month: string) {
  if ((true as boolean)) return corePolicySync<string>('memory-policy.monthFoldPrompt', [month]);
  return [
    `These are her own one-line notes on the days of ${month}.`,
    'Fold them into one sentence, under 30 words, as a note to her future self: what happened that held, what is still open, and nothing invented — every name, place, number and outcome must already be in the notes.',
    'The notes are in the third person; stay that way. Reply with the sentence only.',
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof readsAsSecondPerson>>('memory-policy.readsAsSecondPerson', [text]);
  return /\b(you|your|yours|yourself|you're|you've|you'll|you'd)\b/i.test(text);
}

export function isWorthKeeping(summary: string) {
  if ((true as boolean)) return corePolicySync<boolean>('memory-policy.isWorthKeeping', [summary]);
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
  if ((true as boolean)) return corePolicySync<string>('memory-policy.eventsPrompt', []);
  return [
    'List the events from this conversation worth remembering, one per line, under 15 words each, as a note to your future self.',
    // Her own life was being filed as his. On 2026-09-15 she said "I finally
    // started Chainsaw Man last night" and "I'm logging off at 23:40", and the
    // 9B wrote it down as "They started Chainsaw Man late at night despite
    // logging off at 23:40" — every line had to be about them, so her lines
    // became theirs. The labels were already right; the rule about them was
    // never said.
    'The transcript says who spoke: lines starting "They:" are the user, lines starting "Haru:" are you.',
    'Each line is about the user. Call them "they" — never "you" or "your", which in your own notes mean you, Haru.',
    'What Haru says about herself — what she read or watched, when she sleeps or logs off, her plans and opinions — is your own life, not theirs: never write it as something they did.',
    'Only note something about them that their own lines, or what they had open, show actually happened; not what Haru asked, guessed or suggested.',
    'Include only what will still matter in a month: decisions made, projects completed or changed, notable personal events, lasting changes to their setup or plans.',
    'Skip routine errands, reminders, small talk and passing feelings.',
    'If nothing qualifies, reply with exactly: nothing notable.',
    'Reply with the lines only.',
  ].join(' ');
}

/** One extracted event line, cleaned for the memory gate. */
export function eventCandidates(reply: string): string[] {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof eventCandidates>>('memory-policy.eventCandidates', [reply]);
  return reply
    .split('\n')
    .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(line => line.length > 0 && !/^nothing notable$/i.test(line))
    .map(line => line.replace(/[.!]+$/, ''))
    .filter(line => line.length > 0);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof formationPrompt>>('memory-policy.formationPrompt', [day, known, userName]);
  const weekday = isDay(day) ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' }) : '';
  const name = userName.trim();
  return [
    'You are Haru, going back over part of a day of conversation with the user you live with, writing down what is worth remembering about them.',
    ...(name ? [`The user is ${name}.`] : []),
    'The transcript says who spoke: lines starting "They:" are the user, lines starting "Haru:" are you.',
    'What Haru says about herself — what she read or watched, when she sleeps or logs off, her plans and opinions — is your own life, not theirs: never write it as something they did.',
    'Only note what their own lines, or what they had open, show. Haru\'s lines are only there to make sense of theirs: what Haru asked, guessed, suggested, explained, or said they had said is not something they said, unless their own reply confirms it.',
    'If they mix up a name, a word or a message, that is a slip, not something to remember.',
    '',
    'Write each note as one line: <category> | <when> | <note>',
    ...FORMED.map(category => `${category} — ${CATEGORY_MEANING[category]}.`),
    '',
    'The note: under 20 words, about the user as "they", never "you" or "your"; people, places and things by name; still clear on its own months from now.',
    `WHEN: for a plan or an event, the calendar day as YYYY-MM-DD. This conversation was on ${weekday} ${day}, so "tomorrow" is the day after it. Otherwise -.`,
    'Keep only what would still matter a month from now. Skip small talk, passing moods, errands finished in the moment and what was on the screen for a moment.',
    ...(known.length ? ['Haru already knows these, so leave them out unless the day changed one:', ...known.map(text => `- ${text}`)] : []),
    '',
    'At most 6 lines, the ones that matter most. If nothing qualifies, reply with exactly: nothing notable.',
  ].join('\n');
}

export type FormedNote = { category: Category; when?: string; note: string };

/** The day's notes, read strictly: a line not in the shape, or in a category a day cannot form, is left out. */
export function readFormation(answer: string): FormedNote[] {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof readFormation>>('memory-policy.readFormation', [answer]);
  const out: FormedNote[] = [];
  for (const raw of String(answer ?? '').split('\n')) {
    const match = raw.trim().replace(/^[-*\d.)\s]+(?=[a-z])/i, '').match(/^([a-z]+)\s*\|\s*(\S+)\s*\|\s*(.+)$/i);
    if (!match) continue;
    const category = match[1].toLowerCase() as Category;
    const note = match[3].trim().replace(/[.!]+$/, '');
    if (!FORMED.includes(category) || note.length < 4) continue;
    out.push(isDay(match[2]) && (category === 'plan' || category === 'event') ? { category, when: match[2], note } : { category, note });
  }
  return out;
}

/** A day's labelled lines in windows of at most `size` characters, whole lines only. */
export function formationWindows(lines: string[], size = FORMATION_WINDOW): string[] {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof formationWindows>>('memory-policy.formationWindows', [lines, size]);
  const windows: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (current.length && length + line.length + 1 > size) {
      windows.push(current.join('\n'));
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length) windows.push(current.join('\n'));
  return windows;
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof isWorthAnEvent>>('memory-policy.isWorthAnEvent', [text]);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof closesEvent>>('memory-policy.closesEvent', [title, text]);
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
  if ((true as boolean)) {
    const result = corePolicySync<ReturnType<typeof closeEvents>>('memory-policy.closeEvents', [memories, title, now, done]);
    return {...result, memories:result.changed.length ? result.memories : memories};
  }
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
  if ((true as boolean)) return corePolicySync<MemoryRecord[]>('memory-policy.migrateMemories', [saved, now, Array.isArray(saved) ? saved.map(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`) : []]);
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
      ...(typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt)) ? { updatedAt: record.updatedAt } : {}),
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
      emotion: EMOTIONS.includes(record.emotion as EmotionName) ? record.emotion as EmotionName : undefined,
      emotionIntensity: typeof record.emotionIntensity === 'number' && Number.isFinite(record.emotionIntensity)
        ? Math.min(1, Math.max(0, record.emotionIntensity))
        : undefined,
      evidence: Array.isArray(record.evidence)
        ? tidyEvidence(record.evidence.filter(entry => entry && typeof entry.at === 'string' && EVIDENCE_KINDS.includes(entry.kind)))
        : [{ at: createdAt, kind: record.source === 'inferred' ? 'inference' : 'statement', source: record.source ?? 'conversation' }],
      mergedFrom: Array.isArray(record.mergedFrom) ? record.mergedFrom.filter(id => typeof id === 'string') : undefined,
      conflictsWith: Array.isArray(record.conflictsWith) ? record.conflictsWith.filter(id => typeof id === 'string') : undefined,
      // Carried like the two above it. Left out, every read quietly revived what
      // had been replaced: "lives in Manchester" came back alongside "lives in
      // Sheffield", and the next write put the resurrection on disk.
      supersededBy: typeof record.supersededBy === 'string' ? record.supersededBy : undefined,
      // Checked like kind is, so a value this code does not know is dropped
      // rather than trusted; left off entirely when absent, so a record that
      // has not been sorted reads back exactly as it was written.
      ...(isCategory(record.category) ? { category: record.category } : {}),
      ...(isDay(record.when) ? { when: record.when } : {}),
    }];
  });
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof tidyEvidence>>('memory-policy.tidyEvidence', [entries]);
  const days = new Set<string>();
  const kept: EvidenceEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'repeat') { kept.push(entry); continue; }
    const day = entry.at.slice(0, 10);
    if (days.has(day)) continue;
    days.add(day);
    kept.push(entry);
  }
  return kept;
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof baseConfidence>>('memory-policy.baseConfidence', [source]);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof mentionConfidence>>('memory-policy.mentionConfidence', [mentions, base]);
  const gained = Math.max(0, (mentions - 1)) * CONFIDENCE.repeatedStep;
  return round2(Math.min(CONFIDENCE.max, Math.max(CONFIDENCE.min, base + gained)));
}

export function withConfirmation(confidence: number): number {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof withConfirmation>>('memory-policy.withConfirmation', [confidence]);
  return round2(Math.min(CONFIDENCE.max, confidence + CONFIDENCE.confirmationStep));
}

export function withContradiction(confidence: number): number {
  if ((true as boolean)) return corePolicySync<ReturnType<typeof withContradiction>>('memory-policy.withContradiction', [confidence]);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof scoreImportance>>('memory-policy.scoreImportance', [kind, text]);
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
  if ((true as boolean)) return corePolicySync<ReturnType<typeof guessMemoryType>>('memory-policy.guessMemoryType', [kind, text]);
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

/** Shared write-path retention limit. Protected records may exceed it. */
export const MEMORY_CAP = 400;
