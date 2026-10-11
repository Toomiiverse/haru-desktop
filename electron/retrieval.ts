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
 if((true as boolean))return corePolicySync('final-retrieval.cosine',[a,b]);
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
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function similarityScore(a: number[], b: number[]): number {
 if((true as boolean))return corePolicySync('final-retrieval.similarityScore',[a,b]);
  return Math.max(0, cosine(a, b));
}

export function keywordOverlap(query: string, content: string): { score: number; matched: string[] } {
 if((true as boolean))return corePolicySync('final-retrieval.keywordOverlap',[query,content]);
  const asked = terms(query);
  const held = new Set(terms(content));
  if (!asked.length || !held.size) return { score: 0, matched: [] };
  const matched = asked.filter(word => held.has(word));
  return { score: Math.min(1, matched.length / asked.length), matched };
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
 if((true as boolean))return coreKnowledgeQuery('vectorSearch',store,'',queryEmbedding,options);
  const filters: RetrievalFilters = options.filters ?? ACTIVE_FILTERS;
  const out: ScoredChunk[] = [];
  for (const chunk of store.chunks) {
    if (!passesFilters(chunk, filters)) continue;
    const vectorScore = similarityScore(chunk.embedding, queryEmbedding);
    if (vectorScore < options.threshold) continue;
    out.push({ chunk, vectorScore, keywordScore: 0, score: vectorScore, matched: [] });
  }
  return out.sort((a, b) => b.vectorScore - a.vectorScore).slice(0, options.topK);
}

export function keywordSearch(store: KnowledgeStore, query: string, options: RetrieveOptions): ScoredChunk[] {
 if((true as boolean))return coreKnowledgeQuery('keywordSearch',store,query,[],options);
  const filters: RetrievalFilters = options.filters ?? ACTIVE_FILTERS;
  const out: ScoredChunk[] = [];
  for (const chunk of store.chunks) {
    if (!passesFilters(chunk, filters)) continue;
    const { score, matched } = keywordOverlap(query, chunk.content);
    if (score <= 0) continue;
    out.push({ chunk, vectorScore: 0, keywordScore: score, score, matched });
  }
  return out.sort((a, b) => b.keywordScore - a.keywordScore).slice(0, options.topK);
}

export function recencyScore(updatedAt: string, now: Date, halfLifeDays = 90): number {
 if((true as boolean))return corePolicySync('final-retrieval.recencyScore',[updatedAt,now.toISOString(),halfLifeDays]);
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return 0;
  const days = Math.max(0, (now.getTime() - updated) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
}

export function rerank(candidates: ScoredChunk[], query: string, options: RetrieveOptions): ScoredChunk[] {
 if((true as boolean))return corePolicySync('final-retrieval.rerank',[candidates,query,{...options,now:(options.now??new Date()).toISOString()}]);
  const weights = options.weights ?? DEFAULT_RERANK_WEIGHTS;
  const now = options.now ?? new Date();
  const boost = (chunk: KnowledgeChunk) =>
    (options.categoryBoost?.[chunk.category] ?? 0) + (options.sourceBoost?.[chunk.source] ?? 0);
  const scaled = candidates.map(item => {
    const recency = recencyScore(item.chunk.updatedAt, now);
    const confidence = item.chunk.confidence;
    const raw = weights.vector * item.vectorScore
      + weights.keyword * item.keywordScore
      + weights.recency * recency
      + weights.confidence * confidence
      + boost(item.chunk);
    return { ...item, score: Math.min(1, Math.max(0, raw)) };
  });
  return scaled.sort((a, b) => b.score - a.score);
}

export function hybridSearch(store: KnowledgeStore, query: string, queryEmbedding: number[], options: RetrieveOptions): ScoredChunk[] {
 if((true as boolean))return coreKnowledgeQuery('hybridSearch',store,query,queryEmbedding,options);
  const byId = new Map<string, ScoredChunk>();
  const merge = (item: ScoredChunk) => {
    const existing = byId.get(item.chunk.id);
    if (!existing) { byId.set(item.chunk.id, item); return; }
    existing.vectorScore = Math.max(existing.vectorScore, item.vectorScore);
    existing.keywordScore = Math.max(existing.keywordScore, item.keywordScore);
    for (const word of item.matched) if (!existing.matched.includes(word)) existing.matched.push(word);
  };
  const pool = options.topK * 2;
  for (const item of vectorSearch(store, queryEmbedding, { ...options, topK: pool })) merge(item);
  for (const item of keywordSearch(store, query, { ...options, topK: pool })) merge(item);
  const admitted = [...byId.values()].filter(item =>
    item.vectorScore >= options.threshold || item.keywordScore >= KEYWORD_ADMISSION);
  const ranked = rerank(admitted, query, options);
  return ranked.slice(0, options.rerankTo ?? 5);
}

export function keywordOnly(store: KnowledgeStore, query: string, options: RetrieveOptions): ScoredChunk[] {
 if((true as boolean))return coreKnowledgeQuery('keywordOnly',store,query,[],options);
  const ranked = rerank(keywordSearch(store, query, { ...options, topK: options.topK * 2 }), query, options);
  return ranked.filter(item => item.keywordScore > 0).slice(0, options.rerankTo ?? 5);
}
