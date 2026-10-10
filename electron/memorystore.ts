import {corePolicySync} from './core-policy-sync';
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
  applyDecay, MEMORY_CAP, DEEP_RECALL_LIMIT, isExplicitRecall, isRecurring, isWorthRemembering, migrateMemories,
  pruneMemories, rememberInto, retrieveMemories, vectorSimilarity,
  type ForgettingEntry, type MemoryKind, type MemoryRecord, type MemorySource, type MonthNote,
  type RetrievalFactors, type SessionSummary,
} from './memory';
import { consolidateMemories, type ConsolidationChange } from './consolidation';
import { mergeMemories, mergeDeletions, type MemoryDeletion, type MergeReport } from './memorysync';
import { formatMemoryBlocks, type BlockSources, type MemoryBlock, type DerivedMemoryBlocks } from './blocks';
import type { Embedder } from './embeddings';
import { abortable } from './embedding-queue';
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
export const MAX_MEMORIES = MEMORY_CAP;

/** How long after a change the unsorted records are sent to be sorted, so a burst of writes is one call. */
export const SORT_DELAY_MS = 10_000;

/** How many query embeddings are kept before the oldest is dropped. */
export const QUERY_CACHE_MAX = 100;
export const QUERY_EMBED_TIMEOUT_MS = 1500;

/** How long a change waits before the vectors are rebuilt, so a burst of
 *  writes costs one re-embed rather than one each. */
export const VECTOR_REFRESH_MS = 2000;

export type Profile = { nickname: string; occupation: string; about: string };

export type MemoryStoreDeps = {
  store: {
    getMemories(): MemoryRecord[];
    getMemoryDeletions?(): MemoryDeletion[];
    setMemoryState?(records: MemoryRecord[], deletions: MemoryDeletion[]): void;
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
  queryTimeoutMs?: number;
  embeddingTiming?(event: { elapsedMs: number; outcome: 'semantic' | 'timeout' | 'unavailable' }): void;
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
  const owned = process.env.HARU_CORE_MEMORY_MAINTENANCE === 'on';
  const semantic = owned ? corePolicySync<{refreshDelayMs:number;sortDelayMs:number;cacheMax:number;queryTimeoutMs:number}>('memory-maintenance.semanticConfig', []) : {refreshDelayMs:VECTOR_REFRESH_MS,sortDelayMs:SORT_DELAY_MS,cacheMax:QUERY_CACHE_MAX,queryTimeoutMs:QUERY_EMBED_TIMEOUT_MS};
  function applyState(state: {memories:MemoryRecord[];deletions:MemoryDeletion[]}) {
    if (store.setMemoryState) store.setMemoryState(state.memories,state.deletions);
    else {store.setMemories(state.memories);fallbackDeletions=state.deletions;}
    scheduleVectorRefresh();scheduleSort();broadcast('memory:changed',state.memories);
  }

  /** id → embedding of that memory's text. */
  let vectors = new Map<string, number[]>();
  let vectorTimer: ReturnType<typeof setTimeout> | null = null;
  const queryCache = new Map<string, number[]>();
  const queryPending = new Map<string, Promise<number[] | null>>();
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  let lastRetrieval: LastRetrieval | null = null;

  function getMemories(): MemoryRecord[] {
    return migrateMemories(store.getMemories(), new Date().toISOString());
  }

  let fallbackDeletions: MemoryDeletion[] = [];
  const getDeletions = () => mergeDeletions(store.getMemoryDeletions?.(), fallbackDeletions);

  function setMemories(items: MemoryRecord[], incoming: MemoryDeletion[] = []): void {
    if (owned) {applyState(corePolicySync('memory-maintenance.setPlan',[getMemories(),items,getDeletions(),incoming,new Date().toISOString()]));return;}
    const kept = new Set(items.map(m => m.id));
    const at = new Date().toISOString();
    const removed = getMemories().filter(m => !kept.has(m.id)).map(m => ({ id: m.id, at }));
    const deletions = mergeDeletions(getDeletions(), incoming, removed);
    const deleted = new Set(deletions.map(d => d.id));
    items = items.filter(m => !deleted.has(m.id));
    if (store.setMemoryState) store.setMemoryState(items, deletions);
    else { store.setMemories(items); fallbackDeletions = deletions; }
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
    extra: { id?: string; source?: MemorySource; predicate?: string; object?: string; evidenceDetail?: string; emotion?: EmotionName; emotionIntensity?: number; resighting?: boolean; category?: Category; when?: string } = {},
  ) {
    if (owned) {
      const plan=corePolicySync<{write:boolean;result:{created:boolean;record:MemoryRecord|null}|null;state:{memories:MemoryRecord[];deletions:MemoryDeletion[]};forgetting:ForgettingEntry[]}>('memory-maintenance.addPlan',[getMemories(),getDeletions(),{...extra,text,kind,subject,id:extra.id ?? randomUUID(),stableId:extra.id},new Date().toISOString()]);
      if (plan.write) {if(plan.forgetting.length)store.appendForgettingLog(plan.forgetting);applyState(plan.state);}
      return plan.result;
    }
    const fact = text.trim();
    if (!fact) return null;
    // A stable source (vault bullet) must not re-create an explicitly removed
    // or retired record at every scan. A genuinely edited bullet has a new ID.
    if (extra.id && (getDeletions().some(d => d.id === extra.id) || getMemories().some(m => m.id === extra.id && (m.supersededBy || m.status === 'archived')))) return null;
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
      text: fact, kind, subject, id: extra.id ?? randomUUID(), now: new Date().toISOString(),
      source: extra.source, predicate: extra.predicate, object: extra.object, evidenceDetail: extra.evidenceDetail,
      emotion: extra.emotion, emotionIntensity: extra.emotionIntensity, resighting: extra.resighting,
      category: extra.category, when: extra.when,
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
    if (owned) {
      const raw=theirs as {memories?:unknown;deletions?:unknown}|null;
      const incoming=Array.isArray(theirs)?theirs:raw?.memories;
      const markers=raw?.deletions;
      const plan=corePolicySync<{write:boolean;state:{memories:MemoryRecord[];deletions:MemoryDeletion[]};forgetting:ForgettingEntry[];report:MergeReport}>('memory-maintenance.mergePlan',[getMemories(),getDeletions(),store.getForgettingLog(),theirs,new Date().toISOString(),Array.isArray(incoming)?incoming.map(()=>`${Date.now()}-${Math.random().toString(36).slice(2)}`):[],Array.isArray(markers)?markers.map(item=>typeof item?.at==='string'?Date.parse(item.at):null):[]]);
      if(plan.write){if(plan.forgetting.length)store.appendForgettingLog(plan.forgetting);applyState(plan.state);}
      return {...plan.report,memories:getMemories()};
    }
    const mine = getMemories();
    const envelope = theirs && typeof theirs === 'object' && !Array.isArray(theirs)
      ? theirs as { memories?: unknown; deletions?: unknown } : { memories: theirs };
    const held = new Set(mine.map(m => m.id));
    const historical = store.getForgettingLog().filter(e => !held.has(e.id)).map(e => ({ id: e.id, at: e.at }));
    const deletions = mergeDeletions(getDeletions(), historical, envelope.deletions);
    const deleted = new Set(deletions.map(d => d.id));
    const report = mergeMemories(mine.filter(m => !deleted.has(m.id)),
      migrateMemories(envelope.memories, new Date().toISOString()).filter(m => !deleted.has(m.id)), new Date().toISOString());
    const pruned = pruneMemories(report.memories, MAX_MEMORIES);
    const removed = mine.filter(m => !pruned.memories.some(n => n.id === m.id)).length;
    if (report.added || report.updated || removed || JSON.stringify(deletions) !== JSON.stringify(getDeletions())) {
      if (pruned.evicted.length) store.appendForgettingLog(pruned.evicted.map(m => ({ id: m.id, text: m.text,
        at: new Date().toISOString(), reason: 'prune' as const, detail: `evicted at the ${MAX_MEMORIES}-memory cap` })));
      setMemories(pruned.memories, deletions);
    }
    return { memories: getMemories(), added: report.added, updated: report.updated, deleted: removed };
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
    if(owned)return corePolicySync<MemoryRecord[]>('memory-maintenance.sortBatch',[getMemories(),[...unanswered]]);
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
      if(owned){
        const plan=corePolicySync<{memories:MemoryRecord[];sorted:number;unanswered:string[]}>('memory-maintenance.sortApply',[getMemories(),batch,answers?[...answers]:null,deps.profile().nickname]);
        for(const id of plan.unanswered)unanswered.add(id);
        if(plan.sorted){store.setMemories(plan.memories);broadcast('memory:changed',plan.memories);}
        return plan.sorted;
      }
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

  function scheduleSort(delay = semantic.sortDelayMs): void {
    if (process.env.HARU_CORE_BRAIN_WORKER === 'on' && process.env.HARU_CORE_PERIODIC === 'on') return;
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

  function refreshVectors(): Promise<void> {
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = rebuildVectors().finally(() => {
      refreshing = null;
      if (refreshAgain) { refreshAgain = false; scheduleVectorRefresh(); }
    });
    return refreshing;
  }

  async function rebuildVectors(): Promise<void> {
    const model = embedder();
    if (!model) return;
    const currentRecords=getMemories();
    const memories = owned ? corePolicySync<MemoryRecord[]>('memory-maintenance.embeddingPlan',[currentRecords]) : currentRecords.filter(memory => !memory.supersededBy);
    if (!memories.length) { vectors = new Map(); return; }
    try {
      const embedded = await model.embedBatch(memories.map(memory => memory.text));
      const currentModel = embedder();
      if ((currentModel?.cacheKey ?? currentModel?.model) !== (model.cacheKey ?? model.model)) return;
      const current = new Map(getMemories().filter(memory => !memory.supersededBy).map(memory => [memory.id, memory.text]));
      const next = new Map<string, number[]>();
      memories.forEach((memory, index) => { if (current.get(memory.id) === memory.text) next.set(memory.id, embedded[index]); });
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
    }, semantic.refreshDelayMs);
  }

  /** Embed the query if the embedder is up; cached so repeated phrasing pays
   *  for its embedding once. */
  async function embedQuery(text: string): Promise<number[] | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const model = embedder();
    if (!model) return null;
    const key = `${model.cacheKey ?? model.model}\u0000${trimmed}`;
    const cached = queryCache.get(key);
    if (cached) return cached;
    if (queryPending.has(key)) return queryPending.get(key)!;
    const started = performance.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('embedding_timeout')), deps.queryTimeoutMs ?? semantic.queryTimeoutMs);
    const mark = (outcome: 'semantic' | 'timeout' | 'unavailable') => {
      try { deps.embeddingTiming?.({ elapsedMs: performance.now() - started, outcome }); } catch { /* optional diagnostics */ }
    };
    const pending = abortable(() => model.embed(trimmed, { signal: abort.signal }), abort.signal).then(vector => {
      const current = embedder();
      if ((current?.cacheKey ?? current?.model) !== (model.cacheKey ?? model.model)) return null;
      const oldest = queryCache.keys().next().value;
      if (queryCache.size >= semantic.cacheMax && oldest !== undefined) queryCache.delete(oldest);
      queryCache.set(key, vector);
      mark('semantic');
      return vector;
    }, () => { mark(abort.signal.aborted ? 'timeout' : 'unavailable'); return null; }).finally(() => {
      clearTimeout(timer);
      queryPending.delete(key);
    });
    queryPending.set(key, pending);
    return pending;
  }

  /**
   * The nightly review: duplicates and near-duplicates merge (with provenance),
   * contradictions get flagged and the older claim loses confidence. Uses the
   * memory vectors when they exist, so "nagged" and "corrected" can be seen as
   * the same stance without sharing a word.
   */
  function consolidate(): ConsolidationChange[] {
    const { memories, changes } = consolidateMemories(getMemories(), {
      ...(owned ? {vectors} : {similarity: (a:MemoryRecord, b:MemoryRecord) => vectorSimilarity(vectors.get(a.id), vectors.get(b.id))}),
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

  function prepareProfileSummary(message: string, recentContext = '', semantic?: Map<string, number>, scale?: number, latestSemantic?: Map<string, number>, onCoreGraphClaims?: (ids: string[]) => void): (derived?: DerivedMemoryBlocks) => string {
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
    const configured = store.getBlocks();
    const sources = blockSources(query, semantic, latest);
    const hasSessions = getSessions().length > 0;
    return (derived?: DerivedMemoryBlocks): string => {
      if(process.env.HARU_CORE_BLOCK_GOVERNANCE==='on'){
        const plan=corePolicySync<{formatted:{text:string;cut:{label:string;before:number;after:number}[];coreGraphIds:string[]};summary:string}|{error:string}>('block-governance.prepareSummary',[configured,{...sources,semantic:sources.semantic?[...sources.semantic]:undefined,latestSemantic:sources.latestSemantic?[...sources.latestSemantic]:undefined},{omit:['persona'],compact:true,...(scale!==undefined?{scale}:{}),...(derived?{derived}:{})},hasSessions]);
        if('error' in plan)throw Error(plan.error);
        onCoreGraphClaims?.(plan.formatted.coreGraphIds);
        for(const entry of plan.formatted.cut)console.warn(`[blocks] ${entry.label} cut from ${entry.before} to ${entry.after} chars`);
        return plan.summary;
      }
      const blocks = formatMemoryBlocks(configured, sources, { omit: ['persona'], compact: true, ...(scale !== undefined ? { scale } : {}), ...(derived ? { derived } : {}) });
      onCoreGraphClaims?.(blocks.coreGraphIds);
      for (const entry of blocks.cut) {
        console.warn(`[blocks] ${entry.label} cut from ${entry.before} to ${entry.after} chars to fit its budget — selection was tighter than this; raise the block limit if it keeps happening`);
      }
      const lines: string[] = [];
      if (blocks.text) lines.push(blocks.text);
      if (hasSessions) {
        lines.push('Earlier conversations are reflected in the working_state block. Refer back to them naturally when relevant, the way someone would who was there. Do not list them back or announce that you remember.');
      }
      return lines.length ? `About the user: ${lines.join(' ')}` : '';
    };
  }

  function profileSummary(message: string, recentContext = '', semantic?: Map<string, number>, scale?: number, latestSemantic?: Map<string, number>): string {
    return prepareProfileSummary(message, recentContext, semantic, scale, latestSemantic)();
  }

  function notifyCommitted(events:string[]){
    for(const event of events){
      if(event==='memories'){scheduleVectorRefresh();scheduleSort();broadcast('memory:changed',store.getMemories());}
      else if(event==='blocks')broadcast('blocks:changed',store.getBlocks());
      else throw Error('core_memory_notification_protocol');
    }
  }
  return {
    notifyCommitted,
    getMemories, getDeletions, setMemories, addMemory, mergeIn, getSessions, getMonthNotes, setMonthNotes,
    refreshVectors, scheduleVectorRefresh, embedQuery,
    sortPending, scheduleSort,
    /** The vectors as they stand. A function because they are replaced wholesale. */
    vectors: () => vectors,
    consolidate, decay,
    blockSources, setBlocks, profileSummary, prepareProfileSummary,
    lastRetrieval: () => lastRetrieval,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
