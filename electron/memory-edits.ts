import {corePolicySync} from './core-policy-sync';
import { randomUUID } from 'node:crypto';
import { isWorthRemembering, rememberInto, supersede, pruneMemories, MEMORY_CAP, type MemoryKind, type MemoryRecord, type MemorySource } from './memory';

/** Plan first, then commit the entire record change in a single file write. */
export function planMemoryEdit(memories: MemoryRecord[], options: {
  oldIds: string[]; text: string; kind: MemoryKind; source: MemorySource;
  subject?: string; predicate?: string; object?: string; evidenceDetail?: string;
  now?: string;
}): { memories: MemoryRecord[]; record: MemoryRecord | null; created: boolean; retired: number } | null {
  const now = options.now ?? new Date().toISOString();
  return corePolicySync('memory-tools.planEdit',[memories,options,randomUUID(),now]);
}
