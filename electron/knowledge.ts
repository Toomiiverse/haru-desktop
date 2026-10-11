import {corePolicySync} from './core-policy-sync';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const KNOWLEDGE_CATEGORIES = ['haru', 'personal', 'projects', 'technical', 'business', 'general', 'conversation', 'documentation'] as const;
export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number];

export type KnowledgeStatus = 'active' | 'stale' | 'deleted';

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  heading?: string;
  embedding: number[];
  embedModel: string;
  embedDimension: number;
  source: string;
  sourceType: string;
  category: KnowledgeCategory;
  metadata: Record<string, unknown>;
  version: number;
  confidence: number;
  status: KnowledgeStatus;
  hash: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  supersededBy?: string;
};

export type KnowledgeDocument = {
  id: string;
  source: string;
  sourceType: string;
  category: KnowledgeCategory;
  hash: string;
  version: number;
  metadata: Record<string, unknown>;
  status: KnowledgeStatus;
  chunkIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeStore = {
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
};

export type KnowledgeConfig = {
  enabled: boolean;
  embedModel: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  threshold: number;
  rerankTo: number;
  contextChunks: number;
  contextChars: number;
};

export const DEFAULT_KNOWLEDGE: KnowledgeConfig = {
  enabled: true,
  embedModel: 'nomic-embed-text',
  chunkSize: 1500,
  chunkOverlap: 120,
  topK: 20,
  threshold: 0.35,
  rerankTo: 5,
  contextChunks: 5,
  contextChars: 2400,
};

export function readKnowledgeConfig(saved: unknown): KnowledgeConfig {
  return corePolicySync('knowledge-index.config',[saved]);
}

export function emptyKnowledge(): KnowledgeStore {
  return corePolicySync('knowledge-index.empty',[]);
}

function isCategory(value: unknown): value is KnowledgeCategory {
  return typeof value === 'string' && (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is KnowledgeStatus {
  return value === 'active' || value === 'stale' || value === 'deleted';
}

function asDocument(value: unknown): KnowledgeDocument | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<KnowledgeDocument>;
  if (typeof record.id !== 'string' || typeof record.source !== 'string') return null;
  return {
    id: record.id,
    source: record.source,
    sourceType: typeof record.sourceType === 'string' ? record.sourceType : 'text',
    category: isCategory(record.category) ? record.category : 'general',
    hash: typeof record.hash === 'string' ? record.hash : '',
    version: typeof record.version === 'number' ? record.version : 1,
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
    status: isStatus(record.status) ? record.status : 'active',
    chunkIds: Array.isArray(record.chunkIds) ? record.chunkIds.filter((id): id is string => typeof id === 'string') : [],
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  };
}

function asChunk(value: unknown): KnowledgeChunk | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<KnowledgeChunk>;
  if (typeof record.id !== 'string' || typeof record.documentId !== 'string' || typeof record.content !== 'string') return null;
  return {
    id: record.id,
    documentId: record.documentId,
    chunkIndex: typeof record.chunkIndex === 'number' ? record.chunkIndex : 0,
    content: record.content,
    heading: typeof record.heading === 'string' ? record.heading : undefined,
    embedding: Array.isArray(record.embedding) ? record.embedding.filter((n): n is number => typeof n === 'number') : [],
    embedModel: typeof record.embedModel === 'string' ? record.embedModel : 'unknown',
    embedDimension: typeof record.embedDimension === 'number' ? record.embedDimension : (Array.isArray(record.embedding) ? record.embedding.length : 0),
    source: typeof record.source === 'string' ? record.source : '',
    sourceType: typeof record.sourceType === 'string' ? record.sourceType : 'text',
    category: isCategory(record.category) ? record.category : 'general',
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
    version: typeof record.version === 'number' ? record.version : 1,
    confidence: typeof record.confidence === 'number' ? record.confidence : 1,
    status: isStatus(record.status) ? record.status : 'active',
    hash: typeof record.hash === 'string' ? record.hash : '',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
    lastAccessedAt: typeof record.lastAccessedAt === 'string' ? record.lastAccessedAt : undefined,
    supersededBy: typeof record.supersededBy === 'string' ? record.supersededBy : undefined,
  };
}

export function normalizeKnowledge(saved: unknown): KnowledgeStore {
  return corePolicySync('knowledge-index.normalize',[saved,new Date().toISOString()]);
}

export function loadKnowledge(file: string): KnowledgeStore {
  try {
    if (!existsSync(file)) return emptyKnowledge();
    return normalizeKnowledge(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return emptyKnowledge();
  }
}

export function saveKnowledge(file: string, store: KnowledgeStore): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, JSON.stringify(store));
  renameSync(tmp, file);
}

export function hashContent(text: string): string {
  return corePolicySync('knowledge-index.hash',[text]);
}

export function stableId(parts: string[]): string {
  return corePolicySync('knowledge-index.stable',[parts]);
}

export function documentIdFor(source: string, sourceType: string): string {
  return corePolicySync('knowledge-index.documentId',[source,sourceType]);
}

export function findDocument(store: KnowledgeStore, id: string): KnowledgeDocument | undefined {
  return corePolicySync('knowledge-index.find',[store,id]);
}

export function findDocumentBySource(store: KnowledgeStore, source: string): KnowledgeDocument | undefined {
  return corePolicySync('knowledge-index.findSource',[store,source]);
}

export type ChunkSeed = {
  content: string;
  heading?: string;
};

export type IngestOutcome = {
  action: 'created' | 'updated' | 'unchanged';
  document: KnowledgeDocument;
  chunks: KnowledgeChunk[];
  supersededIds: string[];
};

export function planIngest(
  store: KnowledgeStore,
  args: {
    id: string;
    source: string;
    sourceType: string;
    category: KnowledgeCategory;
    text: string;
    chunks: ChunkSeed[];
    embeddings: number[][];
    embedModel: string;
    embedDimension: number;
    metadata?: Record<string, unknown>;
    confidence?: number;
    now: string;
  },
): IngestOutcome {
  return corePolicySync('knowledge-index.plan',[store,args]);
}

export function applyIngest(store: KnowledgeStore, outcome: IngestOutcome): KnowledgeStore {
  return corePolicySync('knowledge-index.apply',[store,outcome]);
}

export function deleteDocument(store: KnowledgeStore, id: string, now: string): KnowledgeStore {
  return corePolicySync('knowledge-index.delete',[store,id,now]);
}

export function reconcileChunkIds(store: KnowledgeStore): KnowledgeStore {
  return corePolicySync('knowledge-index.reconcile',[store]);
}

export function knowledgeStats(store: KnowledgeStore) {
  return corePolicySync<{documents:number;chunks:number;stale:number;characters:number;byCategory:Record<string,number>;sources:Record<string,number>;embedModels:string[];embedDimensions:number[];lastIngestedAt:string}>('knowledge-index.stats',[store]);
}

export function guessCategory(source: string): KnowledgeCategory {
  return corePolicySync('knowledge-index.guess',[source]);
}
