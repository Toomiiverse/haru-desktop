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
  if((true as boolean))return corePolicySync('memory-tools.planEdit',[memories,options,randomUUID(),now]);
  const old = memories.filter(m => options.oldIds.includes(m.id) && !m.supersededBy && m.status !== 'archived');
  if (old.length !== new Set(options.oldIds).size) return null;
  const text = options.text.trim();
  if (!text) {
    return { memories: memories.map(m => old.includes(m) ? { ...m, status: 'archived', updatedAt: now,
      evidence: [...(m.evidence ?? []), { at: now, kind: 'closed', source: m.source ?? 'conversation', detail: 'Removed through a memory block edit' }],
    } : m), record: null, created: false, retired: old.length };
  }
  if (!isWorthRemembering(text, { meantAsARule: options.source === 'explicit' })) return null;
  const saved = rememberInto(memories, { ...options, id: randomUUID(), now, text });
  let next = saved.memories;
  let retired = 0;
  for (const record of old) {
    if (record.id === saved.record.id) continue;
    next = supersede(next, record.id, saved.record.id, now);
    if (next.find(m => m.id === record.id)?.supersededBy === saved.record.id) retired++;
  }
  const kept = pruneMemories(next, MEMORY_CAP).memories;
  if (!kept.some(m => m.id === saved.record.id)) return null;
  return { ...saved, memories: kept, retired };
}
