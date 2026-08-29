// Consolidation: the periodic review that keeps the memory list honest.
//
// Runs on stored records, never on the write path — rememberInto still handles
// the moment a fact arrives; this is the slower look at what accumulated. It
// detects duplicates, near-duplicates (by keyword overlap or, when an embedder
// is available, semantic similarity), and contradictions, and it merges rather
// than deletes so provenance survives: the merged record carries the ids it
// came from, and the evidence log keeps the observations behind both.
//
// Everything here is deterministic. A model is not consulted for what is
// worth believing or what belongs together — the same judgement memory.ts
// refuses to hand it (see isWorthRemembering).

import { isSameMemory, keywords, type EvidenceEntry, type MemoryKind, type MemoryRecord } from './memory';

/** The overlap at which two differently-worded records are the same fact.
 *  Higher than isSameMemory's 0.6 on purpose: that bar is for the write path,
 *  where a false merge loses information; this one only runs on review. */
const OVERLAP_MERGE = 0.75;

/** Semantic similarity (cosine) at which two records say the same thing even
 *  with no words in common — "nagged" and "corrected" do not overlap but mean
 *  the same stance. Only used when the caller can provide an embedder. */
const SEMANTIC_MERGE = 0.75;

/**
 * Kinds a cosine alone may not merge.
 *
 * Cosine at 0.75 is a loose bar on one-line records: it is what folded "Set up
 * TV power connector, TV works fine now" into "Get the TV power connector done"
 * in the live store. On an event that costs a tense; on a preference it would
 * cost one of two standing instructions — "does not like to be corrected" and
 * "prefers not to be nagged" read as the same stance to an embedder and are not
 * the same request. These are the always-included kinds, the ones prune already
 * refuses to touch, so they merge on shared words or not at all.
 */
const KEYWORDS_ONLY_MERGE: MemoryKind[] = ['preference', 'relationship'];

/** How much of the two records' words must coincide before a polarity
 *  difference is a contradiction rather than a coincidence. */
const CONTRADICTION_OVERLAP = 0.5;

const NEGATIVE = /\b(do(?:es)?n'?t|do not|does not|not|never|dislikes?|hates?|stopped|quit|avoids?|refuses?|prefers? not to)\b/i;
const POSITIVE = /\b(likes?|loves?|enjoys?|uses?|wants?|prefers?|is a|is the|has|had|does)\b/i;

export function polarity(text: string): 'positive' | 'negative' | 'neutral' {
  if (NEGATIVE.test(text)) return 'negative';
  if (POSITIVE.test(text)) return 'positive';
  return 'neutral';
}

export function isContradictory(a: MemoryRecord, b: MemoryRecord): boolean {
  const left = keywords(a.text);
  const right = keywords(b.text);
  if (!left.size || !right.size) return false;
  const shared = [...left].filter(word => right.has(word)).length;
  const overlap = shared / Math.max(left.size, right.size);
  if (overlap < CONTRADICTION_OVERLAP) return false;
  const aPolarity = polarity(a.text);
  const bPolarity = polarity(b.text);
  return (aPolarity === 'positive' && bPolarity === 'negative') || (aPolarity === 'negative' && bPolarity === 'positive');
}

export function overlapScore(a: MemoryRecord, b: MemoryRecord): number {
  const left = keywords(a.text);
  const right = keywords(b.text);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.max(left.size, right.size);
}

/**
 * The text the merged record keeps: the longer of the two, and only that.
 *
 * It used to append the shorter one behind " Also: " whenever the shorter had a
 * word the longer lacked, so that no distinct information was lost. Two things
 * were wrong with that. Records only merge at 0.75 overlap or better, so the
 * shorter is by construction the same fact in other words and the "distinct"
 * word is usually a verb form — the live store held "Set up TV power connector,
 * TV works fine now Also: Get the TV power connector done." And it compounded:
 * every further merge appended again, so the store closure became one record
 * saying the same thing three times, in three tenses, one of them addressed to
 * the user. That text is what she reads out.
 *
 * Nothing is lost by dropping it. mergePair writes the folded wording into the
 * evidence log — which is what the comment here used to claim mergedFrom did,
 * while mergedFrom only ever held the ids of records that no longer exist.
 */
export function mergeText(a: string, b: string): string {
  return a.length >= b.length ? a : b;
}

function mergePair(primary: MemoryRecord, other: MemoryRecord, now: string): MemoryRecord {
  const evidence: EvidenceEntry[] = [
    ...(primary.evidence ?? []),
    ...(other.evidence ?? []),
    // The folded record leaves the list entirely, so this entry is the only
    // place its wording survives. mergedFrom keeps its id, which by then points
    // at nothing.
    { at: now, kind: 'merge', source: other.source ?? 'conversation', detail: `folded in: ${other.text}` },
  ];
  return {
    id: primary.id,
    text: mergeText(primary.text, other.text),
    kind: (primary.kind === 'preference' || other.kind === 'preference') ? 'preference'
      : (primary.kind === 'relationship' || other.kind === 'relationship') ? 'relationship'
      : primary.kind === 'fact' || other.kind === 'fact' ? 'fact'
      : 'event',
    subject: primary.subject ?? other.subject,
    predicate: primary.predicate ?? other.predicate,
    object: primary.object ?? other.object,
    createdAt: primary.createdAt,
    lastSeenAt: primary.lastSeenAt > other.lastSeenAt ? primary.lastSeenAt : other.lastSeenAt,
    mentions: primary.mentions + other.mentions,
    confidence: Math.max(primary.confidence ?? 0.5, other.confidence ?? 0.5),
    importance: Math.max(primary.importance ?? 0.4, other.importance ?? 0.4),
    source: primary.source ?? other.source,
    status: primary.status ?? 'active',
    memoryType: primary.memoryType ?? other.memoryType,
    evidence,
    mergedFrom: [...(primary.mergedFrom ?? []), other.id],
    conflictsWith: primary.conflictsWith,
  };
}

export type ConsolidationChange = {
  kind: 'merged' | 'conflict';
  keptId: string;
  mergedIds: string[];
  at: string;
  detail: string;
};

export type ConsolidateOptions = {
  now?: string;
  /** Semantic similarity between two records, when an embedder is available.
   *  Absent → keyword overlap only. */
  similarity?: (a: MemoryRecord, b: MemoryRecord) => number | undefined;
};

export type ConsolidationResult = {
  memories: MemoryRecord[];
  changes: ConsolidationChange[];
};

/**
 * Review the active memories: merge duplicates and near-duplicates, flag
 * contradictions (and lower the older claim's confidence). Returns the new
 * list and what changed, for the log and the inspector.
 */
export function consolidateMemories(memories: MemoryRecord[], options: ConsolidateOptions = {}): ConsolidationResult {
  const now = options.now ?? new Date().toISOString();
  const changes: ConsolidationChange[] = [];
  // Superseded and archived records are history, not candidates — the sweep
  // must not tidy away something that was deliberately shelved.
  const active = memories.filter(memory => !memory.supersededBy && memory.status !== 'archived');
  const working = active.map(memory => ({ ...memory }));
  const removed = new Set<number>();
  let changed = false;

  for (let i = 0; i < working.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < working.length; j++) {
      if (removed.has(j)) continue;
      const primary = working[i];
      const other = working[j];

      const same = isSameMemory(primary.text, other.text);
      const overlap = overlapScore(primary, other);
      const semantic = options.similarity ? options.similarity(primary, other) : undefined;
      const bySemanticsAlone = semantic !== undefined && semantic >= SEMANTIC_MERGE
        && !KEYWORDS_ONLY_MERGE.includes(primary.kind) && !KEYWORDS_ONLY_MERGE.includes(other.kind);
      const nearEnough = overlap >= OVERLAP_MERGE || bySemanticsAlone;

      if (isContradictory(primary, other)) {
        // The older claim loses confidence; both stay, marked, so the conflict
        // is visible rather than silently resolved.
        const older = primary.createdAt <= other.createdAt ? primary : other;
        const younger = older === primary ? other : primary;
        older.confidence = Math.max(0.1, (older.confidence ?? 0.5) - 0.3);
        older.conflictsWith = [...new Set([...(older.conflictsWith ?? []), younger.id])];
        younger.conflictsWith = [...new Set([...(younger.conflictsWith ?? []), older.id])];
        changes.push({
          kind: 'conflict', keptId: younger.id, mergedIds: [older.id], at: now,
          detail: `"${older.text.slice(0, 60)}" contradicts "${younger.text.slice(0, 60)}" — the older claim is now held with less confidence`,
        });
        changed = true;
        continue;
      }

      if (same || nearEnough) {
        // The record with more mentions becomes the survivor; its id is the
        // one the retrieval vectors and the UI already know.
        const primaryKept = primary.mentions >= other.mentions;
        const kept = primaryKept ? primary : other;
        const folded = primaryKept ? other : primary;
        const merged = mergePair(kept, folded, now);
        working[primaryKept ? i : j] = merged;
        removed.add(primaryKept ? j : i);
        changes.push({
          kind: 'merged', keptId: merged.id, mergedIds: [folded.id], at: now,
          detail: `"${folded.text.slice(0, 60)}" merged into "${kept.text.slice(0, 60)}"`,
        });
        changed = true;
      }
    }
  }

  const kept = working.filter((_, index) => !removed.has(index));
  return {
    memories: changed ? [...kept, ...memories.filter(memory => memory.supersededBy || memory.status === 'archived')] : memories,
    changes,
  };
}