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
import { isHerStanding } from './herstanding';
import {
  applyDecay, DEEP_RECALL_LIMIT, isExplicitRecall, isRecurring, isWorthRemembering, migrateMemories,
  pruneMemories, rememberInto, retrieveMemories, vectorSimilarity,
  type ForgettingEntry, type MemoryKind, type MemoryRecord, type MemorySource, type MonthNote,
  type RetrievalFactors, type SessionSummary,
} from './memory';
import { consolidateMemories, type ConsolidationChange } from './consolidation';
import { mergeMemories, type MergeReport } from './memorysync';
import { formatMemoryBlocks, type BlockSources, type MemoryBlock } from './blocks';
import type { Embedder } from './embeddings';
import { guessCategory, namesSomeoneElse, SORT_BATCH, type Category, type SortNote, type Sorted } from './categories';
import type { EmotionName } from './emotion';

/**
 * How many records she keeps.
 *
 * It was sixty, from when every record went into the prompt. None has for a
 * long time — each block selects what it shows (blocks.ts) — so the cap was
 * only deciding what she forgot, and at sixty it forgot a lot: fifty-three
 * records in three weeks, among them his job at Happytel, his favourite anime
 * and how the RAM trouble ended, while duplicates and a line of her own stayed
 * (2026-09-17). Four hundred is about a year of what the extractor keeps, and
 * sorting (categories.ts) lets the cap take what is passing before anything else.
 */
export const MAX_MEMORIES = 400;

/** How long after a change the unsorted records are sent to be sorted, so a burst of writes is one call. */
export const SORT_DELAY_MS = 10_000;

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
    getMonthNotes(): MonthNote[];
    setMonthNotes(notes: MonthNote[]): void;
    getBlocks(): MemoryBlock[];
    setBlocks(blocks: MemoryBlock[]): void;
    getForgettingLog(): ForgettingEntry[];
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
  /** Her own life, framed — interests, nights, diary (tastes.ts, nightlife.ts, diary.ts). */
  herOwnLife(): string;
  /**
   * Sort a batch of records into categories (categories.ts) with a model.
   * Optional: without it nothing is sorted and every record keeps the category
   * its kind and wording suggest. Null or a partial map when the model could
   * not be asked or not be read; whatever is missing is simply asked again.
   */
  sort?(notes: SortNote[]): Promise<Map<string, Sorted> | null>;
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
    scheduleSort();
    broadcast('memory:changed', items);
  }

  function getSessions(): SessionSummary[] {
    return store.getSessions();
  }

  function getMonthNotes(): MonthNote[] {
    return store.getMonthNotes();
  }

  function setMonthNotes(items: MonthNote[]): void {
    store.setMonthNotes(items);
    broadcast('memory:changed', items);
  }

  function addMemory(
    text: string,
    kind: MemoryKind = 'fact',
    subject?: string,
    extra: { source?: MemorySource; predicate?: string; object?: string; evidenceDetail?: string; emotion?: EmotionName; emotionIntensity?: number; resighting?: boolean } = {},
  ) {
    const fact = text.trim();
    if (!fact) return null;
    // Turned away here rather than in the tool handler, so that nothing which can
    // write a memory can skip the check. Six of her first eleven memories said
    // nothing — that they exist, that they live in a city — and each one held a
    // place in the prompt that a real fact could have had.
    // A rule set on purpose is exempt from the her-own-nagging test, which only
    // ever meant to catch her writing instructions for him and filing them as
    // facts. His preference page is imperative by design, and so is a standing
    // of her own about how she is treated — "I don't get up for this any more"
    // is the whole content of it.
    const meantAsARule = extra.source === 'explicit' || isHerStanding({ kind, subject });
    if (!isWorthRemembering(fact, { meantAsARule })) {
      console.log(`[memory] not worth keeping: "${fact.slice(0, 60)}"`);
      return { created: false, record: null };
    }
    const { memories, created, record } = rememberInto(getMemories(), {
      text: fact, kind, subject, id: randomUUID(), now: new Date().toISOString(),
      source: extra.source, predicate: extra.predicate, object: extra.object, evidenceDetail: extra.evidenceDetail,
      emotion: extra.emotion, emotionIntensity: extra.emotionIntensity, resighting: extra.resighting,
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

  /**
   * Another machine's memories, folded into these.
   *
   * `theirs` is unknown because it comes off the network; memorysync vets it.
   *
   * Anything already in the forgetting log is dropped rather than taken back.
   * Without that, every sync re-adds what the cap evicted here, the prune
   * evicts it again, and the log fills with the same memory forgotten forever.
   * The log holds the last 200 evictions, so something forgotten longer ago
   * than that can still return — rare, and cheaper than keeping every id ever
   * dropped.
   */
  function mergeIn(theirs: unknown): MergeReport {
    const mine = getMemories();
    const held = new Set(mine.map(memory => memory.id));
    const forgotten = new Set(
      store.getForgettingLog().map(entry => entry.id).filter(id => !held.has(id)),
    );
    const report = mergeMemories(mine, theirs, new Date().toISOString());
    const kept = forgotten.size
      ? report.memories.filter(memory => !forgotten.has(memory.id))
      : report.memories;
    const added = report.added - (report.memories.length - kept.length);
    if (!added && !report.updated) return { memories: mine, added: 0, updated: 0 };
    const pruned = pruneMemories(kept, MAX_MEMORIES);
    if (pruned.evicted.length) {
      store.appendForgettingLog(pruned.evicted.map(memory => ({
        id: memory.id, text: memory.text, at: new Date().toISOString(), reason: 'prune' as const,
        detail: `evicted at the ${MAX_MEMORIES}-memory cap`,
      })));
    }
    setMemories(pruned.memories);
    return { memories: pruned.memories, added, updated: report.updated };
  }

  // -- sorting -----------------------------------------------------------------
  // New records are sorted into categories by a model a few seconds after they
  // are written, twenty at a time, until none is left unsorted. Only the
  // category and its day are written back, onto the record as it stands by
  // then, and only if its text has not changed in the meantime.

  let sortTimer: ReturnType<typeof setTimeout> | null = null;
  let sorting = false;
  /** Asked about and not answered, this run: skipped so one unreadable record cannot hold up the rest. */
  const unanswered = new Set<string>();

  function unsorted(): MemoryRecord[] {
    return getMemories().filter(memory => !memory.category
      && !memory.supersededBy
      && memory.status !== 'archived'
      && !isHerStanding(memory)
      && !unanswered.has(memory.id));
  }

  /** One batch. Returns how many records were sorted. */
  async function sortPending(): Promise<number> {
    if (sorting || !deps.sort) return 0;
    const batch = unsorted().slice(0, SORT_BATCH);
    if (!batch.length) return 0;
    sorting = true;
    try {
      const notes: SortNote[] = batch.map(memory => ({ id: memory.id, text: memory.text, kind: memory.kind, subject: memory.subject, createdAt: memory.createdAt }));
      const answers = await deps.sort(notes);
      const asked = new Map(batch.map(memory => [memory.id, memory.text]));
      for (const memory of batch) if (!answers?.has(memory.id)) unanswered.add(memory.id);
      if (!answers?.size) return 0;
      let sorted = 0;
      const next = getMemories().map(memory => {
        const answer = answers.get(memory.id);
        if (!answer || memory.category || asked.get(memory.id) !== memory.text) return memory;
        sorted += 1;
        // Raised on three separate days is not passing, whatever one read of
        // the line says: the pages he wrote himself are said again every day.
        // And a person has to be somebody: a note naming nobody but him is
        // about him, and a person would be shown on every turn.
        let category: Category = answer.category === 'passing' && isRecurring(memory) ? guessCategory(memory) : answer.category;
        if (category === 'person' && !namesSomeoneElse(memory.text, deps.profile().nickname)) {
          const guessed = guessCategory(memory);
          category = guessed === 'person' ? 'identity' : guessed;
        }
        const { when: _stale, ...rest } = memory;
        return answer.when && (category === 'plan' || category === 'event') ? { ...rest, category, when: answer.when } : { ...rest, category };
      });
      if (sorted) {
        // Straight to the store: the text is unchanged, so nothing to re-embed.
        store.setMemories(next);
        broadcast('memory:changed', next);
        console.log(`[memory] sorted ${sorted} record(s) into categories`);
      }
      return sorted;
    } catch (error) {
      console.warn('[memory] could not sort memories:', error instanceof Error ? error.message : error);
      return 0;
    } finally {
      sorting = false;
    }
  }

  function scheduleSort(delay = SORT_DELAY_MS): void {
    if (!deps.sort || sortTimer) return;
    sortTimer = setTimeout(() => {
      sortTimer = null;
      void sortPending().then(sorted => {
        // Keep going while batches land; stop on one that did not, and let the
        // next write try again.
        if (sorted && unsorted().length) scheduleSort(0);
      });
    }, delay);
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
  function blockSources(query: string, semantic?: Map<string, number>, latest?: { message: string; semantic?: Map<string, number> }): BlockSources {
    return {
      ...(latest ? { latest: latest.message, latestSemantic: latest.semantic } : {}),
      character: deps.character(),
      profile: deps.profile(),
      memories: getMemories(),
      sessions: getSessions(),
      following: deps.following(),
      agenda: deps.agenda(),
      herOwn: deps.herOwnLife(),
      query,
      semantic,
      now: new Date(),
    };
  }

  /** Write blocks and tell every window, so the inspector never goes stale. */
  function setBlocks(items: MemoryBlock[]): void {
    store.setBlocks(items);
    broadcast('blocks:changed', items);
  }

  function profileSummary(message: string, recentContext = '', semantic?: Map<string, number>, scale?: number, latestSemantic?: Map<string, number>): string {
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
    // the authoritative records. The persona block is left out here: the
    // prompt ends on the same text, and it was going in twice. Compact, for
    // the reason given on BlockRenderOptions. `scale` shrinks the budget of
    // every block but her own for an away reply, which re-processes this whole
    // section each turn — see BlockRenderOptions.scale and UNSCALED_BLOCKS.
    // The message on its own as well as with its context, when there is context to dilute it.
    const latest = recentContext ? { message, semantic: latestSemantic } : undefined;
    const blocks = formatMemoryBlocks(store.getBlocks(), blockSources(query, semantic, latest), { omit: ['persona'], compact: true, ...(scale !== undefined ? { scale } : {}) });
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
    getMemories, setMemories, addMemory, mergeIn, getSessions, getMonthNotes, setMonthNotes,
    refreshVectors, scheduleVectorRefresh, embedQuery,
    sortPending, scheduleSort,
    /** The vectors as they stand. A function because they are replaced wholesale. */
    vectors: () => vectors,
    consolidate, decay,
    blockSources, setBlocks, profileSummary,
    lastRetrieval: () => lastRetrieval,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
