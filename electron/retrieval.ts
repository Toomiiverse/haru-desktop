import {coreKnowledgeQuery} from './core-final-retrieval';
import {corePolicySync} from './core-policy-sync';
import { STOP_WORDS } from './memory';
import type { KnowledgeCategory, KnowledgeChunk, KnowledgeStore } from './knowledge';

function terms(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

export type RetrievalFilters = {
  category?: KnowledgeCategory | KnowledgeCategory[];
  source?: string | string[];
  status?: KnowledgeChunk['status'] | KnowledgeChunk['status'][];
  metadata?: Record<string, unknown>;
};

export type RerankWeights = {
  vector: number;
  keyword: number;
  recency: number;
  confidence: number;
};

export const DEFAULT_RERANK_WEIGHTS: RerankWeights = {
  vector: 0.6,
  keyword: 0.25,
  recency: 0.08,
  confidence: 0.07,
};

/** Share this fraction of a query's content words and it is evidence worth
 *  surfacing even when the vector score is low — the escape hatch for exact
 *  product names, file names and model numbers. */
const KEYWORD_ADMISSION = 0.4;

export type RetrieveOptions = {
  topK: number;
  threshold: number;
  rerankTo?: number;
  weights?: RerankWeights;
  filters?: RetrievalFilters;
  categoryBoost?: Partial<Record<KnowledgeCategory, number>>;
  sourceBoost?: Record<string, number>;
  now?: Date;
};

export type ScoredChunk = {
  chunk: KnowledgeChunk;
  vectorScore: number;
  keywordScore: number;
  score: number;
  matched: string[];
};

export function cosine(a: number[], b: number[]): number {
 return corePolicySync('final-retrieval.cosine',[a,b]);
}

export function similarityScore(a: number[], b: number[]): number {
 return corePolicySync('final-retrieval.similarityScore',[a,b]);
}

export function keywordOverlap(query: string, content: string): { score: number; matched: string[] } {
 return corePolicySync('final-retrieval.keywordOverlap',[query,content]);
}

function matchAny<T>(value: T, wanted: T | T[]): boolean {
  return Array.isArray(wanted) ? wanted.includes(value) : value === wanted;
}

function passesFilters(chunk: KnowledgeChunk, filters?: RetrievalFilters): boolean {
  if (!filters) return true;
  if (filters.status && !matchAny(chunk.status, filters.status)) return false;
  if (filters.category && !matchAny(chunk.category, filters.category)) return false;
  if (filters.source && !matchAny(chunk.source, filters.source)) return false;
  if (filters.metadata) {
    for (const [key, value] of Object.entries(filters.metadata)) {
      if (chunk.metadata[key] !== value) return false;
    }
  }
  return true;
}

const ACTIVE_FILTERS = { status: 'active' as const };

export function vectorSearch(store: KnowledgeStore, queryEmbedding: number[], options: RetrieveOptions): ScoredChunk[] {
 return coreKnowledgeQuery('vectorSearch',store,'',queryEmbedding,options);
}

export function keywordSearch(store: KnowledgeStore, query: string, options: RetrieveOptions): ScoredChunk[] {
 return coreKnowledgeQuery('keywordSearch',store,query,[],options);
}

export function recencyScore(updatedAt: string, now: Date, halfLifeDays = 90): number {
 return corePolicySync('final-retrieval.recencyScore',[updatedAt,now.toISOString(),halfLifeDays]);
}

export function rerank(candidates: ScoredChunk[], query: string, options: RetrieveOptions): ScoredChunk[] {
 return corePolicySync('final-retrieval.rerank',[candidates,query,{...options,now:(options.now??new Date()).toISOString()}]);
}

export function hybridSearch(store: KnowledgeStore, query: string, queryEmbedding: number[], options: RetrieveOptions): ScoredChunk[] {
 return coreKnowledgeQuery('hybridSearch',store,query,queryEmbedding,options);
}

export function keywordOnly(store: KnowledgeStore, query: string, options: RetrieveOptions): ScoredChunk[] {
 return coreKnowledgeQuery('keywordOnly',store,query,[],options);
}
