import {corePolicySync} from './core-policy-sync';
import {runCoreKnowledgeIngest} from './core-knowledge';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chunkMarkdown, chunkText, type Chunk } from './chunking';
import type { Embedder } from './embeddings';
import {
  applyIngest,
  documentIdFor,
  guessCategory,
  hashContent,
  planIngest,
  type ChunkSeed,
  type IngestOutcome,
  type KnowledgeCategory,
  type KnowledgeStore,
} from './knowledge';

export type Extracted = {
  text: string;
  sourceType: string;
};

export type Extractor = {
  label: string;
  match(name: string): boolean;
  extract(file: string): Promise<Extracted>;
};

function readText(file: string): Promise<Extracted> {
  return Promise.resolve({ text: readFileSync(file, 'utf8'), sourceType: 'text' });
}

async function readMarkdown(file: string): Promise<Extracted> {
  return { text: readFileSync(file, 'utf8'), sourceType: 'markdown' };
}

async function readJson(file: string): Promise<Extracted> {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return { text: JSON.stringify(parsed, null, 2), sourceType: 'json' };
}

export function baseExtractors(): Extractor[] {
  return [
    { label: 'markdown', match: name => (true as boolean)?corePolicySync('knowledge-flow.matches',['markdown',name]):/\.(md|markdown|mdown|mkd)$/i.test(name), extract: readMarkdown },
    { label: 'text', match: name => (true as boolean)?corePolicySync('knowledge-flow.matches',['text',name]):/\.(txt|log|text)$/i.test(name), extract: readText },
    { label: 'json', match: name => (true as boolean)?corePolicySync('knowledge-flow.matches',['json',name]):/\.json$/i.test(name), extract: readJson },
  ];
}

export function findExtractor(name: string, extractors: Extractor[]): Extractor | undefined {
 if((true as boolean)){const index=corePolicySync<number|null>('knowledge-flow.selectExtractor',[name,extractors.map(e=>({label:e.label,matches:e.match(name)}))]);return index===null?undefined:extractors[index];}
  return extractors.find(extractor => extractor.match(name));
}

export type IngestArgs = {
  file: string;
  source?: string;
  sourceType?: string;
  text?: string;
  category?: KnowledgeCategory;
  metadata?: Record<string, unknown>;
  confidence?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  now?: string;
};

export type IngestResult = {
  store: KnowledgeStore;
  outcome: IngestOutcome;
  chunks: number;
};

export async function ingestFile(
  store: KnowledgeStore,
  embedder: Embedder,
  args: IngestArgs,
  extractors: Extractor[] = baseExtractors(),
): Promise<IngestResult> {
  if((true as boolean))return runCoreKnowledgeIngest(store,embedder,args,extractors);
  const name = path.basename(args.file);
  let text: string;
  let sourceType: string;
  if (typeof args.text === 'string') {
    text = args.text.trim();
    sourceType = args.sourceType ?? 'text';
  } else {
    const extractor = findExtractor(args.file, extractors);
    if (!extractor) throw new Error(`No ingest format knows how to read "${name}". Supported: ${extractors.map(item => item.label).join(', ')}`);
    const extracted = await extractor.extract(args.file);
    text = extracted.text.trim();
    sourceType = extracted.sourceType;
  }
  if (!text) throw new Error(`Nothing readable in "${name}".`);
  const source = args.source ?? args.file;
  const category = args.category ?? guessCategory(source);
  const id = documentIdFor(source, sourceType);
  const existing = store.documents.find(document => document.id === id);
  if (existing && existing.status === 'active' && existing.hash === hashContent(text)) {
    return {
      store,
      outcome: { action: 'unchanged' as const, document: existing, chunks: store.chunks.filter(chunk => chunk.documentId === id), supersededIds: [] },
      chunks: store.chunks.filter(chunk => chunk.documentId === id).length,
    };
  }
  const chunkSize = args.chunkSize ?? 1500;
  const chunkOverlap = args.chunkOverlap ?? 120;
  const now = args.now ?? new Date().toISOString();
  const seeds: ChunkSeed[] = (sourceType === 'markdown' ? chunkMarkdown(text, { maxSize: chunkSize, overlap: chunkOverlap }) : chunkText(text, { maxSize: chunkSize, overlap: chunkOverlap }))
    .filter((chunk: Chunk) => chunk.content.trim().length > 0)
    .map(chunk => ({ content: chunk.content.trim(), heading: chunk.heading }));
  if (!seeds.length) throw new Error(`"${name}" chunked into nothing.`);
  const embeddings = await embedder.embedBatch(seeds.map(seed => seed.content));
  const outcome = planIngest(store, {
    id,
    source,
    sourceType,
    category,
    text,
    chunks: seeds,
    embeddings,
    embedModel: embedder.model,
    embedDimension: embeddings[0]?.length ?? 0,
    metadata: args.metadata,
    confidence: args.confidence,
    now,
  });
  return { store: applyIngest(store, outcome), outcome, chunks: outcome.chunks.length };
}

export function knownFormats(extractors: Extractor[]): string {
 if((true as boolean))return corePolicySync('knowledge-flow.formats',[extractors.map(e=>e.label)]);
  return extractors.map(extractor => extractor.label).join(', ');
}
