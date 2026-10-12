import { mayLeaveTheMachine, explicitlyLocalOnly } from './sensitivity';
import { providerPrivacyView } from './provider-state';
import type { ChatMessage } from './provider';

/**
 * The verdict for a conversation already scanned, kept on the array it was
 * reached for. Routing asks this question and the send asks it again about the
 * same text; scanning a 22,000-character block twice a turn is not free.
 */
const scanCache = new WeakMap<readonly ChatMessage[], { schema: unknown; failure: string | null }>();

/** Scan every outgoing text field, including context, tool arguments/results and schemas. */
export function assertOutboundSafe(messages: readonly ChatMessage[], toolSchema?: readonly unknown[]): void {
  const cached = scanCache.get(messages);
  if (cached && cached.schema === toolSchema) {
    if (cached.failure) throw new Error(cached.failure);
    return;
  }
  try {
    scanOutbound(messages, toolSchema);
    scanCache.set(messages, { schema: toolSchema, failure: null });
  } catch (error) {
    const failure = error instanceof Error ? error.message : 'outbound_privacy_blocked';
    scanCache.set(messages, { schema: toolSchema, failure });
    throw error;
  }
}

function scanOutbound(messages: readonly ChatMessage[], toolSchema?: readonly unknown[]): void {
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 100) throw new Error('outbound_payload_too_deep');
    if (typeof value === 'string') {
      if (!mayLeaveTheMachine(value, false, { namesAlone: false }).safe) throw new Error('outbound_privacy_blocked');
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { return; }
      if (parsed && typeof parsed === 'object') visit(parsed, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && !mayLeaveTheMachine(`${key}: ${child}`, false, { namesAlone: false }).safe) throw new Error('outbound_privacy_blocked');
      visit(child, depth + 1);
    }
  };
  for (const message of messages) {
    if(message.role==='user' && explicitlyLocalOnly(message.content??''))throw new Error('outbound_local_only_requested');
    const { images: _images, ...text } = providerPrivacyView(message);
    const verdict = mayLeaveTheMachine(JSON.stringify(text), false, { namesAlone: message.role === 'user' });
    visit(text);
    const raw = mayLeaveTheMachine(text.content ?? '', false, { namesAlone: message.role === 'user' });
    if (!verdict.safe || !raw.safe) throw new Error('outbound_privacy_blocked');
  }
  visit(toolSchema);
  if (toolSchema && !mayLeaveTheMachine(JSON.stringify(toolSchema), false, { namesAlone: false }).safe) throw new Error('outbound_privacy_blocked');
}

/** Invalidate callbacks even when a provider ignores cancellation. */
export async function guardedRequest<T>(request: (signal: AbortSignal, chunk: (text: string) => void) => Promise<T>, options: {
  firstWordMs?: number; totalMs: number; signal?: AbortSignal; onChunk?: (text: string) => void;
}): Promise<T> {
  const abort = new AbortController();
  let active = true, first: ReturnType<typeof setTimeout> | undefined, total: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (message: string) => { active = false; abort.abort(); rejectStop(new Error(message)); };
  const cancel = () => stop('task_cancelled');
  if (options.signal?.aborted) throw new Error('task_cancelled');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const chunk = (text: string) => {
    if (!active || !text) return;
    if (first) clearTimeout(first);
    options.onChunk?.(text);
  };
  total = setTimeout(() => stop('task_deadline_exceeded'), options.totalMs);
  if (options.firstWordMs) first = setTimeout(() => stop('hosted_first_word_timeout'), options.firstWordMs);
  try { return await Promise.race([Promise.resolve().then(() => request(abort.signal, chunk)), stopped]); }
  finally {
    active = false; abort.abort();
    if (first) clearTimeout(first);
    if (total) clearTimeout(total);
    options.signal?.removeEventListener('abort', cancel);
  }
}
