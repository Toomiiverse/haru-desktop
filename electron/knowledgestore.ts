// The live knowledge layer: the vector store in knowledge.ts, wired to files,
// an embedder and a vault on disk.
//
// The same split as memorystore.ts, one shelf over. knowledge.ts is the store
// itself — chunks, versions, supersession — and is pure. ingestion.ts turns a
// file into chunks. obsidian.ts walks a vault. This is what holds those three
// together and owns the parts that only make sense while the app is running:
// the loaded store, the save debounce, the embedding cache, and the queue.
//
// The queue is the part worth knowing about. Ingesting embeds every chunk of a
// document, which is slow and hits the same endpoint the chat does, so jobs run
// one at a time and yield between them. An hourly vault sync landing in the
// middle of a conversation should cost her a little latency, never a turn.
//
// A factory rather than top-level functions, for the reason memorystore.ts is:
// it owns state, and state at module scope leaks between tests.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  deleteDocument, emptyKnowledge, findDocumentBySource, readKnowledgeConfig, reconcileChunkIds,
  type KnowledgeCategory, type KnowledgeConfig, type KnowledgeStore,
} from './knowledge';
import { baseExtractors, ingestFile, type Extractor, type IngestResult } from './ingestion';
import { cachedEmbedder, createEmbedder, EmbeddingCache, type Embedder } from './embeddings';
import { syncVaultFiles, type VaultSyncReport } from './obsidian';
import { isOpenAIShaped } from './provider';
import { readPdf } from './pdf';

/** How much text is taken from a PDF before it is considered enough. */
export const KNOWLEDGE_PDF_CHARS = 200_000;

/** How long a change waits before the store is written, so a burst of
 *  ingests costs one save rather than one each. */
export const SAVE_DEBOUNCE_MS = 1500;

type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export type KnowledgeStoreDeps = {
  store: {
    get(key: string, defaultValue?: unknown): unknown;
    set(key: string, value: unknown): void;
    getKnowledge(): KnowledgeStore;
    setKnowledge(knowledge: KnowledgeStore): void;
  };
  fetch: Fetcher;
  /** The bearer token for an endpoint, which lives with the provider config. */
  apiKeyFor(endpoint: string): string;
};

export type IngestArgs = {
  file: string;
  source?: string;
  sourceType?: string;
  text?: string;
  category?: KnowledgeCategory;
  metadata?: Record<string, unknown>;
  confidence?: number;
  /** False while a vault sync is running: it saves once at the end instead. */
  persist?: boolean;
};

export function createKnowledgeStore(deps: KnowledgeStoreDeps) {
  const { store } = deps;

  let knowledge: KnowledgeStore = emptyKnowledge();
  const embeddingCache = new EmbeddingCache();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const jobs: { run(): Promise<void> }[] = [];
  let draining = false;

  function config(): KnowledgeConfig {
    return readKnowledgeConfig(store.get('knowledge.config'));
  }

  /** Read what is on disk. Called once the app is ready, because the path
   *  depends on it; a store that cannot be read is an empty one, never a crash. */
  function load(): KnowledgeStore {
    knowledge = store.getKnowledge();
    return knowledge;
  }

  function current(): KnowledgeStore {
    return knowledge;
  }

  function persist(): void {
    try {
      store.setKnowledge(knowledge);
    } catch (error) {
      console.warn('[knowledge] could not save:', error instanceof Error ? error.message : String(error));
    }
  }

  function scheduleSave(): void {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persist();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Mark chunks as just used, so retrieval can prefer what keeps earning its
   *  place. Only writes when something actually moved. */
  function touch(ids: string[]): void {
    const now = new Date().toISOString();
    let changed = false;
    for (const chunk of knowledge.chunks) {
      if (ids.includes(chunk.id) && chunk.lastAccessedAt !== now) {
        chunk.lastAccessedAt = now;
        changed = true;
      }
    }
    if (changed) scheduleSave();
  }

  function embedder(): Embedder | null {
    const ai = store.get('ai.config') as { endpoint?: string; model?: string; provider?: string } | undefined;
    if (!ai?.endpoint || !ai.model) return null;
    const endpoint = ai.endpoint;
    const built = createEmbedder({
      endpoint,
      model: config().embedModel,
      provider: isOpenAIShaped(ai.provider) ? 'openai' : 'ollama',
      apiKey: deps.apiKeyFor(endpoint),
    }, deps.fetch);
    return cachedEmbedder(built, embeddingCache);
  }

  const pdfExtractor: Extractor = {
    label: 'pdf',
    match: name => /\.pdf$/i.test(name),
    async extract(file) {
      const read = await readPdf(file, KNOWLEDGE_PDF_CHARS);
      if (read.scanned) throw new Error('a scanned PDF — there is no readable text in it');
      return { text: read.text, sourceType: 'pdf' };
    },
  };

  function extractors(): Extractor[] {
    return [...baseExtractors(), pdfExtractor];
  }

  /**
   * Run one job at a time. A job that throws rejects its own caller and the
   * queue carries on — one unreadable file in a vault must not stop the sync,
   * and a failed ingest must not wedge every later one behind it.
   */
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      jobs.push({
        run: async () => {
          try {
            resolve(await run());
          } catch (error) {
            reject(error);
            throw error;
          }
        },
      });
      void drain();
    });
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (jobs.length) {
        const job = jobs.shift()!;
        try {
          await job.run();
        } catch {
          // the waiter above was rejected already; nothing else to do
        }
        // Yielding between jobs, so a long queue cannot starve the chat path.
        await new Promise(done => setImmediate(done));
      }
    } finally {
      draining = false;
    }
  }

  async function ingest(args: IngestArgs): Promise<IngestResult> {
    const settings = config();
    const model = embedder();
    if (!model) throw new Error('no model is set up, so nothing can be embedded');
    const started = Date.now();
    const result = await ingestFile(knowledge, model, {
      file: args.file,
      source: args.source,
      sourceType: args.sourceType,
      text: args.text,
      category: args.category,
      metadata: args.metadata,
      confidence: args.confidence,
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
    }, extractors());
    // An unchanged document is left entirely alone: same chunks, same ids, no
    // write. Re-syncing a vault of a thousand notes should cost nothing.
    if (result.outcome.action !== 'unchanged') {
      knowledge = reconcileChunkIds(result.store);
      if (args.persist !== false) persist();
    }
    console.log(`[knowledge] ingested ${result.outcome.document.source} (${result.outcome.action}, ${result.outcome.chunks.length} chunks, ${Date.now() - started}ms)`);
    return result;
  }

  function ingestPath(file: string, category?: KnowledgeCategory): Promise<IngestResult> {
    return ingest({ file, category });
  }

  function vaultPath(): string {
    const saved = store.get('knowledge.vault') as { path?: unknown } | undefined;
    return typeof saved?.path === 'string' && saved.path.trim() ? saved.path.trim() : '';
  }

  function saveVaultPath(value: string): void {
    store.set('knowledge.vault', { path: value });
  }

  async function syncVault(target: string): Promise<VaultSyncReport> {
    const vault = path.resolve(target);
    if (!existsSync(vault) || !statSync(vault).isDirectory()) throw new Error(`no such vault: ${target}`);
    const started = Date.now();
    const report = await syncVaultFiles(vault, {
      store: knowledge,
      ingest: async note => {
        const result = await ingest({
          file: note.file,
          source: note.relative,
          sourceType: 'markdown',
          text: note.text,
          category: note.category,
          metadata: note.metadata,
          // One save at the end rather than one per note.
          persist: false,
        });
        return result.outcome.action;
      },
      remove: source => {
        const document = knowledge.documents.find(doc => doc.source === source && doc.status === 'active');
        if (document) knowledge = deleteDocument(knowledge, document.id, new Date().toISOString());
      },
    });
    persist();
    const full = { ...report, ms: Date.now() - started };
    console.log(`[knowledge] vault sync ${vault}: ${full.files} files, +${full.added} ~${full.updated} =${full.unchanged} -${full.removed} in ${full.ms}ms`);
    return full;
  }

  /** The saved vault, kept current without being asked. Failure is logged and
   *  dropped: a missing drive should not surface as an error in the chat. */
  async function autoSyncVault(): Promise<void> {
    const vault = vaultPath();
    if (!vault) return;
    try {
      await enqueue(() => syncVault(vault));
    } catch (error) {
      console.warn('[knowledge] auto vault sync failed:', error instanceof Error ? error.message : String(error));
    }
  }

  /** Re-read and re-embed what is already indexed — after an embedding model
   *  changes, say. One failure is reported and skipped, not fatal. */
  async function reindex(source?: string): Promise<number> {
    const targets = knowledge.documents.filter(document => document.status === 'active' && (!source || document.source === source));
    let reindexed = 0;
    for (const document of targets) {
      try {
        await enqueue(() => ingestPath(document.source, document.category));
        reindexed++;
      } catch (error) {
        console.warn(`[knowledge] reindex of ${document.source} failed:`, error instanceof Error ? error.message : String(error));
      }
    }
    return reindexed;
  }

  function removeSource(source: string): { deleted: boolean; removedChunks: number } {
    const document = findDocumentBySource(knowledge, source);
    if (!document) return { deleted: false, removedChunks: 0 };
    const before = knowledge.chunks.filter(chunk => chunk.documentId === document.id && chunk.status === 'active').length;
    knowledge = deleteDocument(knowledge, document.id, new Date().toISOString());
    persist();
    console.log(`[knowledge] deleted ${document.source} (${before} active chunks)`);
    return { deleted: true, removedChunks: before };
  }

  return {
    load, current, config, embedder,
    persist, scheduleSave, touch,
    enqueue,
    ingest, ingestPath,
    vaultPath, saveVaultPath, syncVault, autoSyncVault,
    reindex, removeSource,
  };
}

export type LiveKnowledge = ReturnType<typeof createKnowledgeStore>;
