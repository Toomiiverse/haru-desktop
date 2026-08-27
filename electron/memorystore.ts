// The live memory layer: the engine in memory.ts, wired to the running app.
//
// Three files carry the word "memory" and they are different things.
// memory.ts is the engine — scoring, decay, consolidation, all pure and all
// tested. store.ts is the files on disk. This is what sits between them: the
// facade the rest of the app reaches for when it wants to read, write or
// render what she knows.
//
// It exists as a factory rather than a module of top-level functions because
// it owns state — the embedding vectors, the query cache, the record of the
// last retrieval — and state that lives at module scope leaks between tests
// and makes them depend on the order they run in.
//
// The semantic layer degrades rather than fails. With no reachable embedder,
// or one that errors, retrieval falls back to keyword scoring and nothing in
// the chat path notices. That is deliberate: a companion whose memory stops
// working because an embedding endpoint went down is worse than one whose
// memory is a little blunter for an evening.

import { randomUUID } from 'node:crypto';
import {
  applyDecay, DEEP_RECALL_LIMIT, isExplicitRecall, isWorthRemembering, migrateMemories,
  pruneMemories, rememberInto, retrieveMemories, vectorSimilarity,
  type ForgettingEntry, type MemoryKind, type MemoryRecord, type MemorySource,
  type RetrievalFactors, type SessionSummary,
} from './memory';
import { consolidateMemories, type ConsolidationChange } from './consolidation';
import { formatMemoryBlocks, type BlockSources, type MemoryBlock } from './blocks';
import type { Embedder } from './embeddings';

/** Capped so the prompt cannot grow without bound as memories accumulate; the
 *  oldest fall away once the list is full. */
export const MAX_MEMORIES = 60;

/** How many query embeddings are kept before the oldest is dropped. */
export const QUERY_CACHE_MAX = 100;

/** How long a change waits before the vectors are rebuilt, so a burst of
 *  writes costs one re-embed rather than one each. */
export const VECTOR_REFRESH_MS = 2000;

export type Profile = { nickname: string; occupation: string; about: string };

export type MemoryStoreDeps = {
  store: {
    getMemories(): MemoryRecord[];
    setMemories(records: MemoryRecord[]): void;
    getSessions(): SessionSummary[];
    getBlocks(): MemoryBlock[];
    setBlocks(blocks: MemoryBlock[]): void;
    appendForgettingLog(entries: ForgettingEntry[]): unknown;
  };
  /** Tell every window something changed, so the inspector never goes stale. */
  broadcast(channel: string, payload: unknown): void;
  /** Null when nothing is reachable, which is what makes the layer optional. */
  embedder(): Embedder | null;
  /** What the block layer may draw on beyond the memories themselves. */
  character(): { identity: string; style: string };
  profile(): Profile;
  following(): { title: string; kind: string; progress?: number }[];
  agenda(): { title: string; kind: string; done: boolean }[];
};

/** What the inspector shows when asked why something was recalled. */
export type LastRetrieval = {
  at: string;
  query: string;
  entries: { id: string; text: string; score: number; factors: RetrievalFactors }[];
};

export function createMemoryStore(deps: MemoryStoreDeps) {
  const { store, broadcast, embedder } = deps;

  /** id → embedding of that memory's text. */
  let vectors = new Map<string, number[]>();
  let vectorTimer: ReturnType<typeof setTimeout> | null = null;
  const queryCache = new Map<string, number[]>();
  let lastRetrieval: LastRetrieval | null = null;

  function getMemories(): MemoryRecord[] {
    return migrateMemories(store.getMemories(), new Date().toISOString());
  }

  function setMemories(items: MemoryRecord[]): void {
    store.setMemories(items);
    scheduleVectorRefresh();
    broadcast('memory:changed', items);
  }

  function getSessions(): SessionSummary[] {
    return store.getSessions();
  }

  function addMemory(
    text: string,
    kind: MemoryKind = 'fact',
    subject?: string,
    extra: { source?: MemorySource; predicate?: string; object?: string } = {},
  ) {
    const fact = text.trim();
    if (!fact) return null;
    // Turned away here rather than in the tool handler, so that nothing which can
    // write a memory can skip the check. Six of her first eleven memories said
    // nothing — that they exist, that they live in a city — and each one held a
    // place in the prompt that a real fact could have had.
    if (!isWorthRemembering(fact)) {
      console.log(`[memory] not worth keeping: "${fact.slice(0, 60)}"`);
      return { created: false, record: null };
    }
    const { memories, created, record } = rememberInto(getMemories(), {
      text: fact, kind, subject, id: randomUUID(), now: new Date().toISOString(),
      source: extra.source, predicate: extra.predicate, object: extra.object,
    });
    const pruned = pruneMemories(memories, MAX_MEMORIES);
    if (pruned.evicted.length) {
      store.appendForgettingLog(pruned.evicted.map(memory => ({
        id: memory.id, text: memory.text, at: new Date().toISOString(), reason: 'prune' as const,
        detail: `evicted at the ${MAX_MEMORIES}-memory cap`,
      })));
    }
    setMemories(pruned.memories);
    return { created, record };
  }

  // -- semantic retrieval ------------------------------------------------------
  // Memories are embedded in the background whenever the list changes, and the
  // latest query is embedded once per turn, so retrieval can weight semantic
  // similarity alongside the keyword score.

  async function refreshVectors(): Promise<void> {
    const model = embedder();
    if (!model) return;
    const memories = getMemories().filter(memory => !memory.supersededBy);
    if (!memories.length) { vectors = new Map(); return; }
    try {
      const embedded = await model.embedBatch(memories.map(memory => memory.text));
      const next = new Map<string, number[]>();
      memories.forEach((memory, index) => next.set(memory.id, embedded[index]));
      vectors = next;
    } catch (error) {
      // Kept, not cleared: yesterday's vectors still score better than none.
      console.warn('[memory] could not embed memories, retrieval will be keyword-only:', error instanceof Error ? error.message : error);
    }
  }

  function scheduleVectorRefresh(): void {
    if (vectorTimer) return;
    vectorTimer = setTimeout(() => {
      vectorTimer = null;
      void refreshVectors();
    }, VECTOR_REFRESH_MS);
  }

  /** Embed the query if the embedder is up; cached so repeated phrasing pays
   *  for its embedding once. */
  async function embedQuery(text: string): Promise<number[] | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const cached = queryCache.get(trimmed);
    if (cached) return cached;
    const model = embedder();
    if (!model) return null;
    try {
      const vector = await model.embed(trimmed);
      const oldest = queryCache.keys().next().value;
      if (queryCache.size >= QUERY_CACHE_MAX && oldest !== undefined) queryCache.delete(oldest);
      queryCache.set(trimmed, vector);
      return vector;
    } catch {
      return null;
    }
  }

  /**
   * The nightly review: duplicates and near-duplicates merge (with provenance),
   * contradictions get flagged and the older claim loses confidence. Uses the
   * memory vectors when they exist, so "nagged" and "corrected" can be seen as
   * the same stance without sharing a word.
   */
  function consolidate(): ConsolidationChange[] {
    const { memories, changes } = consolidateMemories(getMemories(), {
      similarity: (a, b) => vectorSimilarity(vectors.get(a.id), vectors.get(b.id)),
    });
    if (changes.length) {
      setMemories(memories);
      for (const change of changes) console.log(`[memory] ${change.kind}: ${change.detail}`);
    }
    return changes;
  }

  /**
   * The decay pass: low-importance records drift DORMANT → ARCHIVED → forgotten
   * by their half-lives, high-importance ones never move, and everything that
   * leaves is written to the forgetting log first.
   */
  function decay(): void {
    const { memories, transitions, forgotten } = applyDecay(getMemories(), new Date());
    if (!transitions.length && !forgotten.length) return;
    // Straight to the store rather than through setMemories: decay changes
    // nothing about the text, so re-embedding every record would be wasted work.
    store.setMemories(memories);
    broadcast('memory:changed', memories);
    for (const transition of transitions) console.log(`[memory] ${transition.id} ${transition.from} → ${transition.to} (${transition.halfLives.toFixed(1)} half-lives)`);
    if (forgotten.length) {
      store.appendForgettingLog(forgotten.map(entry => ({ ...entry, reason: 'decay' as const })));
      for (const entry of forgotten) console.log(`[memory] forgot: "${entry.text.slice(0, 60)}"`);
    }
  }

  /** Everything the block layer may draw on, straight from the live state. */
  function blockSources(query: string): BlockSources {
    return {
      character: deps.character(),
      profile: deps.profile(),
      memories: getMemories(),
      sessions: getSessions(),
      following: deps.following(),
      agenda: deps.agenda(),
      query,
      now: new Date(),
    };
  }

  /** Write blocks and tell every window, so the inspector never goes stale. */
  function setBlocks(items: MemoryBlock[]): void {
    store.setBlocks(items);
    broadcast('blocks:changed', items);
  }

  function profileSummary(message: string, recentContext = '', semantic?: Map<string, number>): string {
    const query = recentContext ? `${recentContext} ${message}` : message;
    const limit = isExplicitRecall(message) ? DEEP_RECALL_LIMIT : undefined;
    const picked = retrieveMemories(getMemories(), query, { limit, semantic });
    // The last retrieval, kept for the inspector to explain itself: what was
    // asked, what came back, and why each entry scored as it did.
    lastRetrieval = {
      at: new Date().toISOString(),
      query,
      entries: picked.map(entry => ({ id: entry.memory.id, text: entry.memory.text, score: entry.score, factors: entry.factors })),
    };
    // Memory blocks: the Letta-inspired context layer. Values are derived from
    // the deterministic engine on every render — the retrieval above is what
    // decides what the human block shows — so the blocks can never drift from
    // the authoritative records.
    const blocks = formatMemoryBlocks(store.getBlocks(), blockSources(query));
    for (const entry of blocks.cut) {
      console.warn(`[blocks] ${entry.label} cut from ${entry.before} to ${entry.after} chars to fit its budget — selection was tighter than this; raise the block limit if it keeps happening`);
    }
    const lines: string[] = [];
    if (blocks.text) lines.push(blocks.text);
    if (getSessions().length) {
      lines.push('Earlier conversations are reflected in the working_state block. Refer back to them naturally when relevant, the way someone would who was there. Do not list them back or announce that you remember.');
    }
    return lines.length ? `About the user: ${lines.join(' ')}` : '';
  }

  return {
    getMemories, setMemories, addMemory, getSessions,
    refreshVectors, scheduleVectorRefresh, embedQuery,
    /** The vectors as they stand. A function because they are replaced wholesale. */
    vectors: () => vectors,
    consolidate, decay,
    blockSources, setBlocks, profileSummary,
    lastRetrieval: () => lastRetrieval,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
