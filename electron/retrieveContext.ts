import { retrieveMemories, type MemoryRecord, type ScoredMemory } from './memory';
import { hybridSearch, keywordOnly, type RetrieveOptions, type ScoredChunk } from './retrieval';
import { buildKnowledgeContext, emptyKnowledgeContext } from './context';
import type { KnowledgeStore } from './knowledge';

export type RetrieveContextOptions = {
  knowledge: KnowledgeStore;
  embed(text: string): Promise<number[]>;
  memories?: MemoryRecord[];
  /** id → semantic similarity, precomputed with the same embedder. Absent ids
   *  fall back to keyword scoring inside retrieveMemories. */
  semantic?: Map<string, number>;
  query: string;
  now?: Date;
  limit?: number;
  threshold?: number;
  rerankTo?: number;
  filters?: RetrieveOptions['filters'];
  maxChars?: number;
};

export type RetrieveContextResult = {
  knowledge: ScoredChunk[];
  knowledgeText: string;
  memories: ScoredMemory[];
};

export async function retrieveContext(options: RetrieveContextOptions): Promise<RetrieveContextResult> {
  const now = options.now ?? new Date();
  const topK = 20;
  const threshold = options.threshold ?? 0.35;
  const rerankTo = options.rerankTo ?? 5;
  const retrieve: RetrieveOptions = { topK, threshold, rerankTo, filters: options.filters, now };
  let knowledge: ScoredChunk[] = [];
  let embeddingError = '';
  try {
    const embedding = await options.embed(options.query);
    knowledge = hybridSearch(options.knowledge, options.query, embedding, retrieve);
  } catch (error) {
    embeddingError = error instanceof Error ? error.message : String(error);
    knowledge = keywordOnly(options.knowledge, options.query, retrieve);
  }
  const maxItems = options.limit ?? 5;
  const maxChars = options.maxChars ?? 2400;
  const knowledgeText = knowledge.length
    ? buildKnowledgeContext(knowledge, { maxItems, maxChars })
    : emptyKnowledgeContext();
  if (embeddingError) console.warn(`[knowledge] embeddings unavailable (${embeddingError}) — keyword search only`);
  const memories = options.memories?.length ? retrieveMemories(options.memories, options.query, { semantic: options.semantic }) : [];
  return { knowledge, knowledgeText, memories };
}
