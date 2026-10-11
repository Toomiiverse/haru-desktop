import {corePolicySync} from './core-policy-sync';
import type { KnowledgeChunk } from './knowledge';
import type { ScoredChunk } from './retrieval';

export type ContextOptions = {
  maxItems: number;
  maxChars: number;
};

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sourceLine(chunk: KnowledgeChunk): string {
  const meta: string[] = [];
  if (chunk.category) meta.push(`category: ${chunk.category}`);
  if (chunk.version) meta.push(`version ${chunk.version}`);
  if (chunk.heading) meta.push(`section: ${chunk.heading}`);
  const date = shortDate(chunk.updatedAt);
  if (date) meta.push(`updated ${date}`);
  return `Source: ${chunk.source}${meta.length ? ` (${meta.join(', ')})` : ''}`;
}

function formatItem(item: ScoredChunk): string {
  return [
    sourceLine(item.chunk),
    `Confidence: ${item.chunk.confidence.toFixed(2)}`,
    '',
    item.chunk.content,
  ].join('\n');
}

export function buildKnowledgeContext(items: ScoredChunk[], options: ContextOptions): string {
 return corePolicySync('final-retrieval.context',[items,options]);
}

export function emptyKnowledgeContext(): string {
 return corePolicySync('final-retrieval.empty',[]);
}
