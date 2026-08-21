// Speaking to something that is not Ollama.
//
// Everything upstream is written against Ollama's /api/chat shape, and that is
// worth keeping — it is the local default and the one that has to stay simple.
// So this translates at the boundary rather than teaching the rest of the app
// two dialects: messages go out in whichever shape the endpoint wants, and what
// comes back is turned into the shape she already speaks.
//
// The differences are small in number and awkward in kind. The one that actually
// bites is tool results: Ollama matches them to a call by name, OpenAI by an id
// it issued, and losing that id turns a tool call into a 400 nobody can read.

export type Provider = 'ollama' | 'openai' | 'xai' | 'venice';

/** Everything that is not Ollama speaks OpenAI's dialect, including xAI and Venice. */
export function isOpenAIShaped(provider: string | undefined): boolean {
  return provider === 'openai' || provider === 'xai' || provider === 'venice';
}

/** Where a provider lives, when the user has not typed something themselves. */
export const DEFAULT_ENDPOINTS: Record<Provider, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  venice: 'https://api.venice.ai/api/v1',
};

export type ToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };
export type ChatMessage = { role: string; content?: string; tool_calls?: ToolCall[]; tool_name?: string };

type OpenAIMessage = {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

/**
 * The conversation, in OpenAI's shape.
 *
 * A tool result has to name the call it answers, and OpenAI wants the id it
 * handed out rather than the function's name. The id is carried on the assistant
 * message that requested it, so this walks back to the nearest one and matches
 * by name — which is exactly the information Ollama's shape keeps and OpenAI's
 * discards.
 */
export function toOpenAIMessages(conversation: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const [index, message] of conversation.entries()) {
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: findCallId(conversation, index, message.tool_name) ?? message.tool_name ?? 'call_0',
      });
      continue;
    }
    if (message.tool_calls?.length) {
      out.push({
        role: message.role,
        // OpenAI rejects a null content beside tool_calls on some deployments and
        // requires it on others; an empty string satisfies both.
        content: message.content ?? '',
        tool_calls: message.tool_calls.map((call, position) => ({
          id: call.id ?? `call_${index}_${position}`,
          type: 'function' as const,
          function: {
            name: call.function?.name ?? '',
            // Always a string here, whichever way it arrived.
            arguments: typeof call.function?.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function?.arguments ?? {}),
          },
        })),
      });
      continue;
    }
    out.push({ role: message.role, content: message.content ?? '' });
  }
  return out;
}

function findCallId(conversation: ChatMessage[], from: number, name: string | undefined) {
  for (let at = from - 1; at >= 0; at--) {
    const calls = conversation[at].tool_calls;
    if (!calls?.length) continue;
    const match = calls.find(call => call.function?.name === name) ?? calls[0];
    return match.id ?? `call_${at}_0`;
  }
  return undefined;
}

/** The request body an OpenAI-compatible endpoint expects. */
export function toOpenAIBody(options: {
  model: string;
  conversation: ChatMessage[];
  tools?: unknown[];
  temperature: number;
  maxTokens?: number;
  json?: boolean;
}) {
  return {
    model: options.model,
    messages: toOpenAIMessages(options.conversation),
    ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
    // num_ctx has no counterpart: context length is a property of the deployment,
    // not something a caller may ask for.
    temperature: options.temperature,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    stream: false,
  };
}

type OpenAIReply = {
  choices?: { message?: OpenAIMessage; finish_reason?: string }[];
  error?: { message?: string; code?: string } | string;
};

/**
 * What came back, in the shape the rest of the app already reads.
 *
 * Tool arguments arrive as a JSON string here and as an object from Ollama.
 * They are left as the string: toolArguments upstream already parses both, and
 * parsing twice is how a malformed argument becomes a silent empty object
 * instead of a visible error.
 */
export function fromOpenAIReply(payload: OpenAIReply): ChatMessage {
  const complaint = typeof payload.error === 'string' ? payload.error : payload.error?.message;
  if (complaint) throw new Error(complaint);
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error('The provider returned no choices.');
  return {
    role: message.role ?? 'assistant',
    content: message.content ?? '',
    ...(message.tool_calls?.length
      ? { tool_calls: message.tool_calls.map(call => ({ id: call.id, function: { name: call.function?.name, arguments: call.function?.arguments } })) }
      : {}),
  };
}

/**
 * A failure said in a way that names the fix. These providers answer with a tidy
 * JSON error and the app was throwing the raw status at the user, which tells
 * them nothing about which of the three things they got wrong.
 */
export function describeFailure(status: number, body: string, provider: Provider): string {
  let message = '';
  try { const parsed = JSON.parse(body) as OpenAIReply; message = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ?? ''; } catch { /* not JSON */ }
  const name = provider === 'xai' ? 'xAI' : provider === 'venice' ? 'Venice' : 'The provider';
  if (status === 401 || status === 403) return `${name} rejected the API key.`;
  if (status === 404) return `${name} has no model by that name, or the endpoint is wrong.`;
  if (status === 429) return `${name} is rate-limiting, or the account is out of credit.`;
  return message || `${name} returned ${status}`;
}
