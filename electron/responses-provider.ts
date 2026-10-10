import { withProviderUsage } from './provider-usage';
import { toOpenAIMessages, type ChatMessage, type ChatTool } from './provider';
import { receivedProviderMessage } from './provider-state';
type Item = Record<string, any>;

/** Stateless Responses transport keeps reasoning and function calls in one supported path. */
export function toResponsesBody(options: { model: string; conversation: ChatMessage[]; tools?: ChatTool[]; maxTokens: number; stream?: boolean; cacheKey?: string }) {
  const input: Item[] = [];
  for (const [index, row] of toOpenAIMessages(options.conversation).entries()) {
    const original = options.conversation[index];
    if (row.role === 'assistant' && original.provider_state?.model === options.model) {
      input.push(...original.provider_state.content); continue;
    }
    if (row.role === 'tool') { input.push({ type: 'function_call_output', call_id: row.tool_call_id, output: row.content ?? '' }); continue; }
    const content: Item[] = [];
    if (typeof row.content === 'string' && row.content) content.push({ type: row.role === 'assistant' ? 'output_text' : 'input_text', text: row.content });
    if (Array.isArray(row.content)) for (const part of row.content) content.push(part.type === 'text'
      ? { type: 'input_text', text: part.text } : { type: 'input_image', image_url: part.image_url.url });
    if (content.length) input.push({ role: row.role, content });
    for (const call of row.tool_calls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
  }
  return { model: options.model, input, store: false, reasoning: { effort: 'low' }, max_output_tokens: options.maxTokens,
    stream: Boolean(options.stream), ...(options.cacheKey ? { prompt_cache_key: options.cacheKey } : {}),
    ...(options.tools?.length ? { tools: options.tools.map(tool => ({ type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters, strict: false })), tool_choice: 'auto' } : {}) };
}

export function fromResponsesReply(payload: { usage?: unknown; status?: string; output?: Item[]; error?: unknown }, model: string): ChatMessage {
  if (payload.error || payload.status !== 'completed' || !Array.isArray(payload.output)) throw new Error('responses_incomplete_or_failed');
  const text = payload.output.filter(item => item.type === 'message').flatMap(item => item.content ?? [])
    .map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('');
  const calls = payload.output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, function: { name: item.name, arguments: item.arguments } }));
  return withProviderUsage(receivedProviderMessage({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}), provider_state: { model, content: payload.output } }), payload.usage);
}

export async function streamResponses(response: Response, model: string, onChunk: (text: string) => void): Promise<ChatMessage> {
  if (!response.body) throw new Error('responses_empty_stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', final: ChatMessage | undefined;
  const line = (value: string) => {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim(); if (data === '[DONE]') return;
    const event = JSON.parse(data);
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new Error('responses_incomplete_or_failed');
    if (event.type === 'response.output_text.delta') onChunk(event.delta);
    if (event.type === 'response.completed') final = fromResponsesReply(event.response, model);
  };
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); }
    }
    buffer += decoder.decode(); if (buffer.trim()) line(buffer.trim());
    if (!final) throw new Error('responses_incomplete_stream');
    return final;
  } finally { reader.releaseLock(); }
}
