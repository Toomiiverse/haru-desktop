import {naturalPolicy,naturalProgram,naturalError} from './core-natural-policy';
import type { ChatMessage } from './provider';
import type { MemoryRecord } from './memory';
import { userSourceSpans } from './local-reply';

export const CONTINUITY_CHARS = 1600;
export type ConversationPreference = { text: string; source_kind: 'user_report' | 'recorded_preference'; sourceId: string };

const topic = /\b(?:convers(?:ation|ations|ational)|repl(?:y|ies)|answers?|speak|speaking|voice|tone|advice|jokes?|humou?r|roast(?:s|ing)?|nicknames?|call(?:ing)? me|pet names|small talk|banter)\b/i;
const preference = /\b(?:prefer|please|don't|do not|never|always|stop|avoid|no longer|instead|rather|like|dislike|want|hate|love|enjoy|call me)\b/i;
const directPreference = /^(?:(?:actually|from now on|instead)[, ]+)?(?:i (?:prefer|want|like|dislike|hate|love|enjoy|no longer want)|please\b|(?:don't|do not|never|always|stop|avoid)\b|call me\b)/i;

/** A bounded view of current authoritative records and the supplied thread,
 * never a new inferred memory or a cache. Newer user reports override records.
 * A blank slate withholds older continuity, even if old turns remain supplied.
 */
export function conversationContinuity(messages: readonly ChatMessage[], records: readonly MemoryRecord[] = [],
  options: { blankSlate?: boolean; deletedIds?: readonly string[]; forgottenAt?: string; requireComplete?: boolean } = {}): ConversationPreference[] {
  if(process.env.HARU_CORE_NATURAL_CONVERSATION==='on')return naturalPolicy<any>('conversationContinuity',[messages,records,options]);

  if (options.blankSlate) return [];
  const deleted = new Set(options.deletedIds ?? []);
  const saved: ConversationPreference[] = records
    .filter(record => record.kind === 'preference' && record.status === 'active' && !record.supersededBy
      && !record.conflictsWith?.length && !deleted.has(record.id) && (record.confidence ?? 0) >= .8
      && ['explicit', 'conversation', 'import'].includes(record.source ?? '')
      && topic.test(record.text) && preference.test(record.text)
      && userSourceSpans(record.text).every(span => span.source_kind === 'user_report'))
    .sort((a, b) => (a.updatedAt ?? a.lastSeenAt).localeCompare(b.updatedAt ?? b.lastSeenAt))
    .map(record => ({ text: record.text, source_kind: 'recorded_preference', sourceId: record.id }));
  const forgottenAt = options.forgottenAt ? Date.parse(options.forgottenAt) : 0;
  const reported: ConversationPreference[] = messages.flatMap((message, index) => message.role !== 'user'
    || options.forgottenAt && !(Date.parse((message as { at?: string }).at ?? '') > forgottenAt) ? []
    : userSourceSpans(message.content ?? '').filter(span => span.source_kind === 'user_report'
      && (options.requireComplete || span.text.length <= 500) && topic.test(span.text) && directPreference.test(span.text.trim()))
      .map(span => ({ text: span.text, source_kind: 'user_report' as const, sourceId: `turn:${index}` })));
  const selected: ConversationPreference[] = [];
  const seen = new Set<string>();
  let chars = 0;
  // Select newest first, then present chronologically so corrections stay last.
  for (const entry of [...saved, ...reported].reverse()) {
    const key = entry.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    if (chars + entry.text.length > CONTINUITY_CHARS || entry.text.length > 500 || selected.length >= 8) {
      if (options.requireComplete) throw new Error('natural_context_overflow:preferences');
      continue;
    }
    seen.add(key); selected.unshift(entry); chars += entry.text.length;
  }
  return selected;
}

/** A content revision avoids TTL staleness and does not hash the archive.
 * Edits, corrections, tombstones and resets invalidate the snapshot immediately.
 * Thread preferences are always re-read, so a correction applies this turn. */
export class ConversationPreferenceCache {
  private revision = '';
  private saved: ConversationPreference[] = [];
  read(messages: readonly ChatMessage[], records: readonly MemoryRecord[], options: Parameters<typeof conversationContinuity>[2] = {}) {
    if(process.env.HARU_CORE_NATURAL_CONVERSATION==='on'){const p=naturalPolicy<any>('preferences',[{revision:this.revision,saved:this.saved},messages,records,options]);this.revision=p.state.revision;this.saved=p.state.saved;return p.result;}
    const preferences = records.filter(record => record.kind === 'preference');
    const revision = JSON.stringify([preferences, options]);
    const hit = revision === this.revision;
    if (!hit) {
      const saved = conversationContinuity([], preferences, { ...options, requireComplete: true });
      this.saved = saved;
      this.revision = revision;
    }
    const reports = conversationContinuity(messages, [], { ...options, requireComplete: true });
    const byText = new Map<string, ConversationPreference>();
    for (const row of [...this.saved, ...reports]) {
      const key = row.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      byText.delete(key); byText.set(key, row);
    }
    const entries = [...byText.values()];
    if (JSON.stringify(entries).length > CONTINUITY_CHARS) throw new Error('natural_context_overflow:preferences');
    return { entries: structuredClone(entries), hit };
  }
}
