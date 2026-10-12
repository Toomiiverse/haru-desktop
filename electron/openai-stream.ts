import { withProviderUsage } from './provider-usage';
import type { ChatMessage } from './provider';
import { receivedProviderMessage } from './provider-state';
import { stripThinkingMarkers } from './reply';

/** Keep provider reasoning for tool continuation, separate from visible answer chunks. */
export async function readOpenAIStream(response: Response, onChunk: (text: string) => void, model = '', onUsage?: (usage: unknown) => void): Promise<ChatMessage> {
  if (!response.body) throw new Error('provider_empty_stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let content = '', reasoning = '', buffer = '', finished = false;
  let usage: unknown;
  const calls: NonNullable<ChatMessage['tool_calls']> = [];
  const line = (value: string) => {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim();
    if (data === '[DONE]') { finished = true; return; }
    const payload = JSON.parse(data);
    if (payload.error) throw new Error('provider_stream_error');
    const choice = payload.choices?.[0];
    if (choice?.finish_reason) {
      if (choice.finish_reason === 'length') throw new Error('provider_output_limit');
      finished = true;
    }
    // Interim counters are not a final receipt, even if the stream later ends cleanly.
    if (Object.hasOwn(payload, 'usage')) {
      usage = finished ? payload.usage : undefined;
      if (payload.usage) onUsage?.(payload.usage);
    }
    const delta = choice?.delta;
    if (!delta) return;
    if (delta.content) { content += delta.content; onChunk(delta.content); }
    if (delta.reasoning_content) reasoning += delta.reasoning_content;
    for (const call of delta.tool_calls ?? []) {
      if (!Number.isSafeInteger(call.index) || call.index < 0 || call.index > 127) throw new Error('invalid_stream_tool_index');
      const held = calls[call.index] ?? (calls[call.index] = { function: { name: '', arguments: '' } });
      if (call.id) held.id = call.id;
      if (call.function?.name) held.function!.name = call.function.name;
      if (call.function?.arguments) held.function!.arguments = String(held.function!.arguments ?? '') + call.function.arguments;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trim());
    if (!finished) throw new Error('provider_incomplete_stream');
    // Venice emits no argument fragment for Sonnet 5.5's argument-free calls.
    if (model === 'claude-sonnet-5-5') for (const call of calls.filter(Boolean)) {
      if (call.function?.arguments === '') call.function.arguments = '{}';
    }
    return withProviderUsage(receivedProviderMessage({ role: 'assistant', content: stripThinkingMarkers(content), ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}),
      ...(reasoning ? { reasoning_content: reasoning, reasoning_model: model } : {}) }), usage);
  } finally { reader.releaseLock(); }
}
