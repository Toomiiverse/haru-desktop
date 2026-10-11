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
 if((true as boolean))return corePolicySync('final-retrieval.context',[items,options]);
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const sections: { heading?: string; lines: string[]; score: number }[] = [];
  for (const item of sorted) {
    const sectionKey = `${item.chunk.source}\u0000${item.chunk.version}\u0000${item.chunk.category}\u0000${item.chunk.heading ?? ''}`;
    const last = sections[sections.length - 1];
    if (last && last.heading === sectionKey) {
      last.lines.push(formatItem(item));
      last.score = Math.max(last.score, item.score);
    } else {
      sections.push({ heading: sectionKey, lines: [formatItem(item)], score: item.score });
    }
  }
  const parts: string[] = [];
  let used = 0;
  for (const section of sections) {
    const block = section.lines.join('\n\n');
    if (parts.length && used + block.length + 2 > options.maxChars) break;
    parts.push(block);
    used += block.length + 2;
    if (parts.length >= options.maxItems) break;
  }
  if (!parts.length) return '';
  const header = 'RELEVANT KNOWLEDGE';
  const conflicts = sections.length > 1
    ? 'Several sources are quoted. They may disagree because they are from different times; prefer the most recently updated one, and say when you are not certain rather than presenting an old detail as fact.'
    : '';
  return [header, '', ...parts, '', conflicts].filter(Boolean).join('\n');
}

export function emptyKnowledgeContext(): string {
 if((true as boolean))return corePolicySync('final-retrieval.empty',[]);
  return 'No additional stored knowledge matched this query. Facts supplied in the current user message and recent conversation still count as evidence; an empty lookup does not contradict them. Use those facts for requested creative suggestions, clearly treating new details as suggestions. Only if essential facts are absent should you say you do not have enough information. Do not describe documents you have not read.';
}
