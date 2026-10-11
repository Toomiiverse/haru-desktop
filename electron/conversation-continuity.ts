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
  return naturalPolicy<any>('conversationContinuity',[messages,records,options]);
}

/** A content revision avoids TTL staleness and does not hash the archive.
 * Edits, corrections, tombstones and resets invalidate the snapshot immediately.
 * Thread preferences are always re-read, so a correction applies this turn. */
export class ConversationPreferenceCache {
  private revision = '';
  private saved: ConversationPreference[] = [];
  read(messages: readonly ChatMessage[], records: readonly MemoryRecord[], options: Parameters<typeof conversationContinuity>[2] = {}) {
    {const p=naturalPolicy<any>('preferences',[{revision:this.revision,saved:this.saved},messages,records,options]);this.revision=p.state.revision;this.saved=p.state.saved;return p.result;}
  }
}
