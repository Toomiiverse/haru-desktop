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

/**
 * One tool as a provider is told about it. Shared rather than declared where it
 * is used, so a module that only defines a tool does not have to restate the
 * shape of one.
 */
export type ChatTool = {
  type: string;
  function: { name: string; description: string; parameters: { type: string; properties: Record<string, unknown>; required: string[] } };
};

export type Provider = 'ollama' | 'openai' | 'xai' | 'venice';

/**
 * What a bare base64 picture is, read off its first bytes. Everything used to go
 * out as image/png, which OpenAI shrugs at and Claude refuses outright ("specified
 * using the image/png media type, but the image appears to be a image/jpeg") —
 * and a phone camera only ever sends JPEGs.
 */
export function sniffImageType(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

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
export type ChatMessage = {
  role: string; content?: string; tool_calls?: ToolCall[]; tool_name?: string; tool_call_id?: string;
  /** Base64 pictures travelling with this message, in Ollama's shape. See toOpenAIMessages. */
  images?: string[];
};

/** A picture, in the shape OpenAI's chat endpoint wants it. */
type ImagePart = { type: 'image_url'; image_url: { url: string } };
type TextPart = { type: 'text'; text: string };

type OpenAIMessage = {
  role: string;
  content?: string | null | (TextPart | ImagePart)[];
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
        tool_call_id: message.tool_call_id ?? findCallId(conversation, index, message.tool_name) ?? message.tool_name ?? 'call_0',
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
    // A message carrying pictures. Ollama hangs them off the message as base64 in
    // an `images` array; OpenAI wants the content field to stop being a string
    // and become a list of parts instead. This is the only real difference
    // between the two dialects on this, and the whole reason an attached image
    // could not reach a hosted model before — everything upstream is written
    // against Ollama's shape, and this line used to flatten the pictures away.
    if (message.images?.length) {
      out.push({
        role: message.role,
        content: [
          ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
          ...message.images.map(image => ({
            type: 'image_url' as const,
            // Already a data: URL if the caller had a mime type worth keeping;
            // otherwise base64, which is what every local path produces.
            image_url: { url: image.startsWith('data:') ? image : `data:${sniffImageType(image)};base64,${image}` },
          })),
        ],
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
    // Legacy results carry only the name. Match successive occurrences, not
    // always the first call when a model saves two memories in one round.
    const used = conversation.slice(at + 1, from).filter(message => message.role === 'tool' && message.tool_name === name).length;
    const matching = calls.map((call, position) => ({ call, position })).filter(({ call }) => call.function?.name === name);
    const match = matching[used];
    return match ? match.call.id ?? `call_${at}_${match.position}` : undefined;
  }
  return undefined;
}

/** A malformed call/result is not evidence that a model lacks tool support. */
export function toolsUnsupported(status: number, detail: string): boolean {
  return status === 400 && /(?:\b(?:tools|tool use|function calling|tool_choice)\b[^\n]*(?:not supported|unsupported|not available|not enabled)|(?:does not support|doesn't support|unsupported)[^\n]*\b(?:tools|function calling)\b)/i.test(detail);
}

/**
 * Where OpenAI's own newer models depart from the dialect named after them.
 *
 * Everything else that speaks this shape — xAI, Venice, Ollama's compatibility
 * endpoint, OpenAI's gpt-4 line — takes `max_tokens` and a temperature and
 * leaves it there. OpenAI's reasoning models do not: they refuse `max_tokens`
 * in favour of `max_completion_tokens`, refuse any temperature but the default,
 * and from gpt-5.1 on refuse function tools unless reasoning is switched off
 * with `reasoning_effort: 'none'`. Off is also the right setting for her: a
 * reply should arrive at the speed of a chat, not a proof, and it is only with
 * reasoning off that the temperature she was set up with is honoured at all.
 *
 * Each row was confirmed against the live endpoint rather than the docs,
 * because the docs describe a family and the refusals are per model: the
 * original gpt-5 line goes no lower than 'minimal' and still refuses a
 * temperature; the o-series accepts neither and is left to its default. Every
 * model not named here gets exactly the body it always got. Before this, the
 * phone's every message went out to gpt-5.6-terra as `max_tokens` and came
 * back a 400 — "messages do not go through from phone" was this function.
 */
export function openAIQuirks(model: string): {
  maxTokensKey: 'max_tokens' | 'max_completion_tokens';
  reasoningEffort: 'none' | 'minimal' | null;
  honoursTemperature: boolean;
} {
  const name = model.trim().toLowerCase();
  if (/^gpt-5\.[1-9]/.test(name)) return { maxTokensKey: 'max_completion_tokens', reasoningEffort: 'none', honoursTemperature: true };
  if (/^gpt-5(-|$)/.test(name)) return { maxTokensKey: 'max_completion_tokens', reasoningEffort: 'minimal', honoursTemperature: false };
  if (/^o[1-9](-|$)/.test(name)) return { maxTokensKey: 'max_completion_tokens', reasoningEffort: null, honoursTemperature: false };
  return { maxTokensKey: 'max_tokens', reasoningEffort: null, honoursTemperature: true };
}

/** The request body an OpenAI-compatible endpoint expects. */
export function toOpenAIBody(options: {
  model: string;
  conversation: ChatMessage[];
  tools?: unknown[];
  temperature: number;
  maxTokens?: number;
  json?: boolean;
  stream?: boolean;
  /** Which dialect speaker: Venice takes its own parameters on top of OpenAI's. */
  provider?: string;
  /** A stable key for the endpoint's prompt cache — the same brief, turn after turn, is not paid for twice. */
  cacheKey?: string;
}) {
  const quirks = openAIQuirks(options.model);
  return {
    model: options.model,
    messages: toOpenAIMessages(options.conversation),
    // Venice puts its own system prompt in front of everyone's by default —
    // that would sit on top of hers and argue with it every turn. Off. And a
    // thinking model left to itself spends its time before it speaks; off too,
    // and the thinking stripped from what comes back, as on the Ollama path.
    ...(options.provider === 'venice' ? { venice_parameters: { include_venice_system_prompt: false, disable_thinking: true, strip_thinking_response: true } } : {}),
    ...(options.cacheKey ? { prompt_cache_key: options.cacheKey } : {}),
    ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
    ...(quirks.reasoningEffort ? { reasoning_effort: quirks.reasoningEffort } : {}),
    // num_ctx has no counterpart: context length is a property of the deployment,
    // not something a caller may ask for.
    ...(quirks.honoursTemperature ? { temperature: options.temperature } : {}),
    ...(options.maxTokens ? { [quirks.maxTokensKey]: options.maxTokens } : {}),
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    stream: Boolean(options.stream),
    // The usage chunk at the end of a stream is the only place the endpoint says
    // how much of the prompt came from its cache.
    ...(options.stream ? { stream_options: { include_usage: true } } : {}),
  };
}

/** What the endpoint said the prompt cost: its size and how much of it was cached. Null when it said nothing. */
export function promptUsage(usage: unknown): { prompt: number; cached: number } | null {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as { prompt_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown }; cache_read_input_tokens?: unknown };
  const prompt = typeof record.prompt_tokens === 'number' ? record.prompt_tokens : null;
  if (prompt === null) return null;
  const cached = typeof record.prompt_tokens_details?.cached_tokens === 'number' ? record.prompt_tokens_details.cached_tokens
    : typeof record.cache_read_input_tokens === 'number' ? record.cache_read_input_tokens : 0;
  return { prompt, cached };
}

/**
 * What comes back, which is not the same shape as what goes out.
 *
 * Only a request has parts: a picture is something you send, never something the
 * model answers with. Sharing one type for both directions meant the reply
 * appeared able to hold an image, which nothing downstream could have read.
 */
type OpenAIReplyMessage = Omit<OpenAIMessage, 'content'> & { content?: string | null };

type OpenAIReply = {
  choices?: { message?: OpenAIReplyMessage; finish_reason?: string }[];
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
