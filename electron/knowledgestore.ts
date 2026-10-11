import {createCoreKnowledgeStore} from './core-knowledge';
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
import { admitVaultMemories } from './vaultmemories';
import { isOpenAIShaped } from './provider';
import { readPdf } from './pdf';
import { embeddingRoute } from './embedding-route';

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
  /** The vault pages (People.md, Preferences.md, Us.md) as memory records.
   *  Wired by the app to the memory store's admission; absent, the pages are
   *  still searchable knowledge but never standing context. */
  remember?: (draft: { text: string; kind: 'relationship' | 'preference' | 'fact'; subject?: string }) => { created: boolean } | null;
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
 return createCoreKnowledgeStore(deps);
}

export type LiveKnowledge = ReturnType<typeof createKnowledgeStore>;
