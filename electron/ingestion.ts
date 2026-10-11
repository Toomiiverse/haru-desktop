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
    { label: 'markdown', match: name => (corePolicySync('knowledge-flow.matches',['markdown',name])), extract: readMarkdown },
    { label: 'text', match: name => (corePolicySync('knowledge-flow.matches',['text',name])), extract: readText },
    { label: 'json', match: name => (corePolicySync('knowledge-flow.matches',['json',name])), extract: readJson },
  ];
}

export function findExtractor(name: string, extractors: Extractor[]): Extractor | undefined {
 {const index=corePolicySync<number|null>('knowledge-flow.selectExtractor',[name,extractors.map(e=>({label:e.label,matches:e.match(name)}))]);return index===null?undefined:extractors[index];}
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
  return runCoreKnowledgeIngest(store,embedder,args,extractors);
}

export function knownFormats(extractors: Extractor[]): string {
 return corePolicySync('knowledge-flow.formats',[extractors.map(e=>e.label)]);
}
