import type { Embedder } from '../electron/embeddings';
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeStore } from '../electron/knowledge';

export function wordTokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(word => word.length > 2);
}

export function wordEmbedding(text: string, dim = 96): number[] {
  const vector = new Array(dim).fill(0);
  for (const word of wordTokens(text)) {
    let hash = 2166136261;
    for (const char of word) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dim] += 1;
  }
  return vector;
}

export function stubEmbedder(dim = 96): Embedder {
  return {
    model: 'stub-embed',
    async embed(text) {
      return wordEmbedding(text, dim);
    },
    async embedBatch(texts) {
      return texts.map(text => wordEmbedding(text, dim));
    },
  };
}

export function chunkRecord(overrides: Partial<KnowledgeChunk> & { id: string; content: string }): KnowledgeChunk {
  return {
    documentId: 'doc',
    chunkIndex: 0,
    heading: undefined,
    embedding: wordEmbedding(overrides.content),
    embedModel: 'stub-embed',
    embedDimension: 96,
    source: 'test.md',
    sourceType: 'markdown',
    category: 'general',
    metadata: {},
    version: 1,
    confidence: 1,
    status: 'active',
    hash: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

export function documentRecord(overrides: Partial<KnowledgeDocument> & { id: string; source: string }): KnowledgeDocument {
  return {
    sourceType: 'markdown',
    category: 'general',
    hash: '',
    version: 1,
    metadata: {},
    status: 'active',
    chunkIds: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

export function storeWith(chunks: KnowledgeChunk[], documents: KnowledgeDocument[] = []): KnowledgeStore {
  return { chunks, documents };
}
