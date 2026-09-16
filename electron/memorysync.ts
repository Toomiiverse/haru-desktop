// One memory, two machines.
//
// The desk and the server are the same Haru running in two places, and both of
// them write memories: a thing said to the phone forms one in the server's
// store, a thing said at the desk forms one here. Neither knew about the other,
// which is the same split check-ins had before checkinsource.ts, and the same
// answer applies — ids are made where a memory is written and never travel, so
// the same id arriving twice is the same memory, and that is the whole dedupe.
//
// What makes memories harder than check-ins is that they are not append-only.
// A check-in is a note that gets edited; a memory decays, gains mentions, and
// gets folded into other memories by consolidation. Merging two independently
// consolidated stores is a genuinely hard problem — A superseded by B here, B
// merged into C there — and this file does not solve it. It sidesteps it:
// consolidation runs on the desk alone (nothing exposes it over the web API),
// so supersededBy, mergedFrom and conflictsWith are only ever written in one
// place. Whichever side holds them is the side that has seen a tidy, so they
// are carried across rather than being overwritten by the copy that has not.
//
// With that settled, the merge is a union by id where the newer copy wins, and
// it converges no matter which machine runs it or in what order.

import { migrateMemories, tidyEvidence, type EvidenceEntry, type MemoryRecord } from './memory';

export type MergeReport = {
  memories: MemoryRecord[];
  added: number;
  updated: number;
};

/** One observed moment, identified by when and what it was, so the same moment
 *  arriving from both machines is kept once. */
function evidenceKey(entry: EvidenceEntry): string {
  return `${entry.at}|${entry.kind}|${entry.source}|${entry.detail ?? ''}`;
}

function mergeEvidence(mine: EvidenceEntry[] = [], theirs: EvidenceEntry[] = []): EvidenceEntry[] {
  const byKey = new Map<string, EvidenceEntry>();
  for (const entry of [...mine, ...theirs]) byKey.set(evidenceKey(entry), entry);
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function sortingOf(newer: MemoryRecord, older: MemoryRecord): Pick<MemoryRecord, 'category' | 'when'> {
  const sorted = newer.category ? newer : older.category ? older : null;
  if (!sorted) return {};
  return sorted.when ? { category: sorted.category, when: sorted.when } : { category: sorted.category };
}

/**
 * Two copies of one memory, reconciled.
 *
 * Every rule here is symmetric — reconcile(a, b) and reconcile(b, a) give the
 * same record — because both machines run this and they have to agree without
 * talking about it.
 */
function reconcile(mine: MemoryRecord, theirs: MemoryRecord): MemoryRecord {
  // The newer sighting wins the fields a conversation moves: the text as it was
  // last phrased, confidence, importance, and the decay status.
  const newer = theirs.lastSeenAt > mine.lastSeenAt ? theirs : mine;
  const older = newer === mine ? theirs : mine;
  return {
    ...newer,
    // Born when it was first written down, wherever that was.
    createdAt: older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt,
    // Both machines counted real mentions; neither total is the whole truth and
    // the larger is the closer one.
    mentions: Math.max(mine.mentions, theirs.mentions),
    // Tidied as a read tidies it, so the desk's untidied log does not read as a
    // change on every pull.
    evidence: tidyEvidence(mergeEvidence(mine.evidence, theirs.evidence)),
    // Consolidation's work, carried rather than overwritten — see the header.
    supersededBy: mine.supersededBy ?? theirs.supersededBy,
    mergedFrom: mine.mergedFrom ?? theirs.mergedFrom,
    conflictsWith: mine.conflictsWith ?? theirs.conflictsWith,
    // The sorting, from the newer copy that has one. The desk's older code
    // drops both fields on read, so its copy of a record arrives without them
    // however recently it was seen, and must not unsort what was sorted here.
    ...sortingOf(newer, older),
  };
}

/**
 * Fold another machine's memories into this one's.
 *
 * `theirs` is unknown on purpose: it arrives off the network, and migrateMemories
 * is already the gate that turns arbitrary JSON into records or drops it. Nothing
 * that fails it reaches the store.
 */
export function mergeMemories(mine: MemoryRecord[], theirs: unknown, now: string): MergeReport {
  // Both sides, not just the one off the wire. getMemories already migrates
  // what it reads, so in the app this changes nothing — but reconcile compares
  // the two records field by field, and a local copy that had not been through
  // the same derivation would make the result depend on which machine ran the
  // merge. That is exactly the property this is supposed to have.
  const held = migrateMemories(mine, now);
  const incoming = migrateMemories(theirs, now);
  const byId = new Map(held.map(memory => [memory.id, memory]));
  let added = 0;
  let updated = 0;
  for (const other of incoming) {
    const mineNow = byId.get(other.id);
    if (!mineNow) {
      byId.set(other.id, other);
      added += 1;
      continue;
    }
    const merged = reconcile(mineNow, other);
    // Cheap for a list capped at MAX_MEMORIES, and it keeps a pull that changed
    // nothing from broadcasting a change and re-embedding every record.
    if (JSON.stringify(merged) !== JSON.stringify(mineNow)) {
      byId.set(other.id, merged);
      updated += 1;
    }
  }
  return { memories: [...byId.values()], added, updated };
}

/** Whether a sync actually brought anything back, for a log worth reading. */
export function describeMerge(report: MergeReport): string {
  const parts: string[] = [];
  if (report.added) parts.push(`${report.added} new memor${report.added === 1 ? 'y' : 'ies'}`);
  if (report.updated) parts.push(`${report.updated} updated`);
  return parts.join(', ');
}
