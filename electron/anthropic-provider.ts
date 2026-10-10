import { withProviderUsage } from './provider-usage';
import { toOpenAIMessages, type ChatMessage, type ChatTool } from './provider';
import { receivedProviderMessage } from './provider-state';

type Block = Record<string, unknown>;
export function toAnthropicBody(options: { model: string; conversation: ChatMessage[]; tools?: ChatTool[]; maxTokens: number; stream?: boolean }) {
  const system = options.conversation.filter(m => m.role === 'system').map(m => m.content ?? '').join('\n\n');
  const messages: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  const append = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return;
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  const normalized = toOpenAIMessages(options.conversation);
  for (const [i, row] of normalized.entries()) {
    if (row.role === 'system') continue;
    if (row.role === 'tool') { append('user', [{ type: 'tool_result', tool_use_id: row.tool_call_id, content: row.content ?? '' }]); continue; }
    const original = options.conversation[i];
    if (row.role === 'assistant' && original.provider_state?.model === options.model) {
      append('assistant', original.provider_state.content.map(block => ({ ...block }))); continue;
    }
    const blocks: Block[] = [];
    if (typeof row.content === 'string' && row.content) blocks.push({ type: 'text', text: row.content });
    if (Array.isArray(row.content)) for (const part of row.content) {
      if (part.type === 'text') blocks.push({ type: 'text', text: part.text });
      else {
        const match = part.image_url.url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s);
        if (!match) throw new Error('invalid_anthropic_image');
        blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
      }
    }
    for (const call of row.tool_calls ?? []) {
      let input: unknown;
      try { input = JSON.parse(call.function.arguments); } catch { throw new Error('invalid_tool_arguments'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_tool_arguments');
      blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
    }
    append(row.role === 'assistant' ? 'assistant' : 'user', blocks);
  }
  return { model: options.model, max_tokens: options.maxTokens, system, messages, stream: Boolean(options.stream),
    thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
    ...(options.tools?.length ? { tools: options.tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })), tool_choice: { type: 'auto' } } : {}) };
}

export function fromAnthropicReply(payload: { usage?: unknown; content?: Block[]; type?: string; error?: { message?: string } }, model: string): ChatMessage {
  if (payload.type === 'error' || payload.error) throw new Error('anthropic_request_failed');
  if (!Array.isArray(payload.content)) throw new Error('anthropic_missing_content');
  const calls = payload.content.filter(b => b.type === 'tool_use').map(b => ({ id: String(b.id), function: { name: String(b.name), arguments: b.input } }));
  return withProviderUsage(receivedProviderMessage({ role: 'assistant', content: payload.content.filter(b => b.type === 'text').map(b => String(b.text ?? '')).join(''),
    ...(calls.length ? { tool_calls: calls } : {}), provider_state: { model, content: payload.content } }), payload.usage, 'anthropic');
}

export async function streamAnthropic(response: Response, model: string, onChunk: (text: string) => void): Promise<ChatMessage> {
  if (!response.body) throw new Error('anthropic_empty_stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', stopped = false;
  let usage: Record<string, unknown> | undefined, finalUsage = false;
  const blocks: Block[] = [], argumentsByIndex = new Map<number, string>();
  const line = (value: string) => {
    if (!value.startsWith('data:')) return;
    const event = JSON.parse(value.slice(5));
    if (event.type === 'message_start') usage = event.message?.usage;
    if (event.type === 'message_delta' && event.usage) {
      finalUsage = Object.hasOwn(event.usage, 'output_tokens');
      usage = { ...usage, ...Object.fromEntries(Object.entries(event.usage).filter(([, v]) => v !== null)) };
    }
    if (event.type === 'error') throw new Error('anthropic_stream_error');
    if (event.type === 'message_stop') { stopped = true; return; }
    if (event.type === 'content_block_start') blocks[event.index] = { ...event.content_block };
    if (event.type === 'content_block_delta') {
      const block = blocks[event.index], delta = event.delta;
      if (!block) throw new Error('anthropic_stream_order');
      if (delta.type === 'text_delta') { block.text = String(block.text ?? '') + delta.text; onChunk(delta.text); }
      if (delta.type === 'thinking_delta') block.thinking = String(block.thinking ?? '') + delta.thinking;
      if (delta.type === 'signature_delta') block.signature = String(block.signature ?? '') + delta.signature;
      if (delta.type === 'input_json_delta') argumentsByIndex.set(event.index, (argumentsByIndex.get(event.index) ?? '') + delta.partial_json);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); }
    }
    buffer += decoder.decode(); if (buffer.trim()) line(buffer.trim());
    if (!stopped) throw new Error('anthropic_incomplete_stream');
    for (const [index, value] of argumentsByIndex) blocks[index].input = JSON.parse(value);
    return fromAnthropicReply({ content: blocks, usage: finalUsage ? usage : undefined }, model);
  } finally { reader.releaseLock(); }
}
