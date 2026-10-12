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
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.config',[saved]); 
  if (!saved || typeof saved !== 'object') return DEFAULT_KNOWLEDGE;
  const record = saved as Partial<KnowledgeConfig>;
  const clamp = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  return {
    enabled: record.enabled === true,
    embedModel: typeof record.embedModel === 'string' && record.embedModel.trim() ? record.embedModel.trim() : DEFAULT_KNOWLEDGE.embedModel,
    chunkSize: clamp(record.chunkSize, DEFAULT_KNOWLEDGE.chunkSize, 200, 8000),
    chunkOverlap: clamp(record.chunkOverlap, DEFAULT_KNOWLEDGE.chunkOverlap, 0, 1000),
    topK: clamp(record.topK, DEFAULT_KNOWLEDGE.topK, 1, 100),
    threshold: typeof record.threshold === 'number' && Number.isFinite(record.threshold)
      ? Math.min(1, Math.max(0, record.threshold))
      : DEFAULT_KNOWLEDGE.threshold,
    rerankTo: clamp(record.rerankTo, DEFAULT_KNOWLEDGE.rerankTo, 1, 20),
    contextChunks: clamp(record.contextChunks, DEFAULT_KNOWLEDGE.contextChunks, 1, 20),
    contextChars: clamp(record.contextChars, DEFAULT_KNOWLEDGE.contextChars, 200, 12000),
  };
}

export function emptyKnowledge(): KnowledgeStore {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.empty',[]); 
  return { documents: [], chunks: [] };
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
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.normalize',[saved,new Date().toISOString()]); 
  if (!saved || typeof saved !== 'object') return emptyKnowledge();
  const record = saved as Partial<KnowledgeStore>;
  const documents = Array.isArray(record.documents) ? record.documents.map(asDocument).filter((doc): doc is KnowledgeDocument => doc !== null) : [];
  const chunks = Array.isArray(record.chunks) ? record.chunks.map(asChunk).filter((chunk): chunk is KnowledgeChunk => chunk !== null) : [];
  return { documents, chunks };
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
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.hash',[text]); 
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

export function stableId(parts: string[]): string {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.stable',[parts]); 
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

export function documentIdFor(source: string, sourceType: string): string {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.documentId',[source,sourceType]); 
  return stableId([source, sourceType]);
}

export function findDocument(store: KnowledgeStore, id: string): KnowledgeDocument | undefined {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.find',[store,id]); 
  return store.documents.find(document => document.id === id);
}

export function findDocumentBySource(store: KnowledgeStore, source: string): KnowledgeDocument | undefined {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.findSource',[store,source]); 
  return store.documents.find(document => document.source === source && document.status === 'active');
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
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.plan',[store,args]); 
  const existing = findDocument(store, args.id);
  const hash = hashContent(args.text);
  if (existing && existing.status === 'active' && existing.hash === hash) {
    return {
      action: 'unchanged',
      document: existing,
      chunks: store.chunks.filter(chunk => chunk.documentId === existing.id),
      supersededIds: [],
    };
  }
  if (args.chunks.length !== args.embeddings.length) throw new Error(`chunk/embedding count mismatch (${args.chunks.length} chunks, ${args.embeddings.length} embeddings)`);
  const version = existing ? existing.version + 1 : 1;
  const confidence = typeof args.confidence === 'number' ? Math.min(1, Math.max(0, args.confidence)) : 1;
  const metadata = args.metadata ?? {};
  const supersededIds = store.chunks.filter(chunk => chunk.documentId === args.id).map(chunk => chunk.id);
  const fresh: KnowledgeChunk[] = args.chunks.map((seed, index) => {
    const embedding = args.embeddings[index];
    const id = stableId([args.id, String(index), String(version), seed.content]);
    return {
      id,
      documentId: args.id,
      chunkIndex: index,
      content: seed.content,
      heading: seed.heading,
      embedding,
      embedModel: args.embedModel,
      embedDimension: args.embedDimension,
      source: args.source,
      sourceType: args.sourceType,
      category: args.category,
      metadata,
      version,
      confidence,
      status: 'active',
      hash: hashContent(seed.content),
      createdAt: args.now,
      updatedAt: args.now,
    };
  });
  // Only the version just replaced stays behind, stale, for its supersededBy
  // link; older ones go. Every version used to be kept with its embedding, and a
  // page rewritten hourly (Haru/Configuration.md, by the snapshot cron) had
  // piled up 5,534 stale chunks — knowledge.json at 62 MB, rewritten whole on
  // every save, 7.8 s an ingest (2026-09-17). Nothing searches stale chunks.
  const stale: KnowledgeChunk[] = supersededIds.length
    ? store.chunks.filter(chunk => chunk.documentId === args.id && chunk.status === 'active').map(chunk => ({
        ...chunk,
        status: 'stale' as const,
        supersededBy: fresh[0]?.id,
        updatedAt: args.now,
      }))
    : [];
  const document: KnowledgeDocument = {
    id: args.id,
    source: args.source,
    sourceType: args.sourceType,
    category: args.category,
    hash,
    version,
    metadata,
    status: 'active',
    chunkIds: fresh.map(chunk => chunk.id),
    createdAt: existing?.createdAt ?? args.now,
    updatedAt: args.now,
  };
  return {
    action: existing ? 'updated' : 'created',
    document,
    chunks: [...store.chunks.filter(chunk => chunk.documentId !== args.id), ...stale, ...fresh],
    supersededIds,
  };
}

export function applyIngest(store: KnowledgeStore, outcome: IngestOutcome): KnowledgeStore {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.apply',[store,outcome]); 
  if (outcome.action === 'unchanged') return store;
  return {
    documents: [...store.documents.filter(document => document.id !== outcome.document.id), outcome.document],
    chunks: outcome.chunks,
  };
}

export function deleteDocument(store: KnowledgeStore, id: string, now: string): KnowledgeStore {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.delete',[store,id,now]); 
  return {
    documents: store.documents.map(document => document.id === id ? { ...document, status: 'deleted' as const, updatedAt: now } : document),
    chunks: store.chunks.map(chunk => chunk.documentId === id ? { ...chunk, status: 'stale' as const, updatedAt: now } : chunk),
  };
}

export function reconcileChunkIds(store: KnowledgeStore): KnowledgeStore {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.reconcile',[store]); 
  const documents = store.documents.map(document => {
    const ids = store.chunks.filter(chunk => chunk.documentId === document.id).map(chunk => chunk.id);
    return ids.length && ids.length === document.chunkIds.length ? document : { ...document, chunkIds: ids };
  });
  return { ...store, documents };
}

export function knowledgeStats(store: KnowledgeStore) {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync<{documents:number;chunks:number;stale:number;characters:number;byCategory:Record<string,number>;sources:Record<string,number>;embedModels:string[];embedDimensions:number[];lastIngestedAt:string}>('knowledge-index.stats',[store]); 
  const activeDocuments = store.documents.filter(document => document.status === 'active');
  const activeChunks = store.chunks.filter(chunk => chunk.status === 'active');
  const byCategory = Object.fromEntries(KNOWLEDGE_CATEGORIES.map(category => [
    category,
    activeChunks.filter(chunk => chunk.category === category).length,
  ]));
  const bySource: Record<string, number> = {};
  for (const chunk of activeChunks) bySource[chunk.source] = (bySource[chunk.source] ?? 0) + 1;
  const embedModels = [...new Set(activeChunks.map(chunk => chunk.embedModel))];
  const lastIngestedAt = activeDocuments.reduce((latest, document) => document.updatedAt > latest ? document.updatedAt : latest, '');
  return {
    documents: activeDocuments.length,
    chunks: activeChunks.length,
    stale: store.chunks.filter(chunk => chunk.status === 'stale').length,
    characters: activeChunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
    byCategory,
    sources: bySource,
    embedModels,
    embedDimensions: [...new Set(activeChunks.map(chunk => chunk.embedDimension))],
    lastIngestedAt,
  };
}

export function guessCategory(source: string): KnowledgeCategory {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-index.guess',[source]); 
  const name = source.toLowerCase();
  if (name.includes('haru') || name.includes('companion')) return 'haru';
  if (/(^|\/)projects?\//.test(name) || name.includes('project')) return 'projects';
  if (name.includes('docs') || name.includes('documentation') || /\.(md|markdown|rst)$/.test(name) && name.includes('doc')) return 'documentation';
  if (name.includes('server') || name.includes('docker') || name.includes('deploy') || name.includes('config') || /\.(ts|tsx|js|py|json|yaml|yml)$/.test(name)) return 'technical';
  if (name.includes('business') || name.includes('finance') || name.includes('client') || name.includes('invoice')) return 'business';
  if (name.includes('personal') || name.includes('family') || name.includes('diary')) return 'personal';
  return 'general';
}
