// Protocol shared by desktop and Core. Keep the two copies byte-identical;
// cross-runtime tests cover canonicalization. Only memory-relevant inputs count.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function canonicalMemorySource(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(v => canonicalMemorySource(v ?? null)).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => JSON.stringify(k) + ':' + canonicalMemorySource(v)).join(',') + '}';
  return JSON.stringify(value ?? null);
}
export function memorySourceRevision(config: any, memory: any, graph: any): string {
  const relevant = { protocol: 2, slate: config?.her?.slate?.at ?? null, profile: config?.profile ?? null,
    admitted: config?.vault?.admitted ?? null, memories: memory?.memories ?? [], sessions: memory?.sessions ?? [],
    monthNotes: memory?.monthNotes ?? [], forgettingLog: memory?.forgettingLog ?? [], deletions: memory?.deletions ?? [], graph: graph ?? null };
  return createHash('sha256').update(canonicalMemorySource(relevant)).digest('hex');
}
export function readMemorySource(userData: string) {
  const read = (name: string) => JSON.parse(readFileSync(path.join(userData, name), 'utf8'));
  const config = read('config.json'), memory = read('memories.json'), graph = read('graph.json');
  if (!config || typeof config !== 'object' || !Array.isArray(memory?.memories) || !Array.isArray(graph?.facts)) throw new Error('invalid_memory_source');
  return { config, memory, graph, revision: memorySourceRevision(config, memory, graph) };
}
export function sourceDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}
