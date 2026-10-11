import {routePolicy,observedRequest} from './core-route-admission';
// Model names are configuration. Capabilities, privacy and money decide which
// configured worker may run; no model gets a free pass because of its name.
import type { ChatMessage } from './provider';

export type ProviderConfig = { provider: string; model: string; endpoint: string; temperature: number };
export type ModelRole = 'everyday' | 'conversation' | 'local-perception' | 'affordable-cloud' | 'specialist' | 'complex' | 'premium';
type TokenRates = { inputUsdPerMillion: number; outputUsdPerMillion: number; cachedInputUsdPerMillion?: number;
  /** Input reservation upper bound remains separate from ordinary billed input. */
  uncachedInputUsdPerMillion?: number; cacheWriteInputUsdPerMillion?: number; cacheWrite1hInputUsdPerMillion?: number };
export type Pricing = TokenRates & { extended?: TokenRates & { aboveInputTokens: number } };
export type ModelCapabilities = {
  text: boolean;
  image: boolean;
  tools: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  /** A verified upper bound for one supplied image. Without one reserve the entire input context. */
  imageTokens?: number;
};
export type ModelEntry = {
  id: string;
  role: ModelRole;
  config: ProviderConfig;
  local: boolean;
  enabled: boolean;
  capabilities: ModelCapabilities;
  /** Null means no verified price: automatic cloud dispatch is prohibited. */
  pricing: Pricing | null;
  observed?: { attempts: number; successes: number };
};
type Seed = ProviderConfig & { capabilities?: Partial<ModelCapabilities>; pricing?: Pricing | null; enabled?: boolean };
export type RegistrySeeds = {
  local: Seed;
  specialist?: Seed | null;
  conversation?: Seed | null;
  vision?: { model: string; endpoint?: string; enabled: boolean; capabilities?: Partial<ModelCapabilities> } | null;
};
export type TaskPolicy = {
  enabled: boolean;
  taskBudgetMicros: number;
  dailyBudgetMicros: number;
  maxAttempts: number;
  maxToolCalls: number;
  deadlineMs: number;
  maxEscalations: number;
};
export const DEFAULT_TASK_POLICY: Readonly<TaskPolicy> = Object.freeze({
  enabled: true, taskBudgetMicros: 500_000, dailyBudgetMicros: 5_000_000,
  maxAttempts: 12, maxToolCalls: 12, deadlineMs: 180_000, maxEscalations: 1,
});

const ROLES: readonly ModelRole[] = ['everyday', 'conversation', 'local-perception', 'affordable-cloud', 'specialist', 'complex', 'premium'];
const PROVIDERS = ['ollama', 'openai', 'xai', 'venice', 'anthropic'];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Only the local Ollama process qualifies for the no-export/no-cloud-cost path. */
export function isLocalConfig(config: ProviderConfig): boolean {
  if((true as boolean))return routePolicy('local',[config]);
  if (config.provider !== 'ollama') return false;
  try {
    const url = new URL(config.endpoint);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

function providerConfig(value: unknown): ProviderConfig | undefined {
  const item = record(value);
  if (typeof item.provider !== 'string' || !PROVIDERS.includes(item.provider) || typeof item.model !== 'string' || !item.model.trim() || typeof item.endpoint !== 'string') return undefined;
  let endpoint: URL;
  try { endpoint = new URL(item.endpoint); } catch { return undefined; }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return undefined;
  return {
    provider: item.provider, model: item.model.trim(), endpoint: item.endpoint.trim().replace(/\/+$/, ''),
    temperature: finite(item.temperature) && item.temperature <= 2 ? item.temperature : 0.7,
  };
}

function readPricing(value: unknown): Pricing | null {
  const item = record(value);
  if (!finite(item.inputUsdPerMillion) || !finite(item.outputUsdPerMillion)) return null;
  if (item.cachedInputUsdPerMillion !== undefined && !finite(item.cachedInputUsdPerMillion)) return null;
  const billing = (row: Record<string, unknown>) => {
    const result: Partial<TokenRates> = {};
    for (const key of ['uncachedInputUsdPerMillion', 'cacheWriteInputUsdPerMillion', 'cacheWrite1hInputUsdPerMillion'] as const) {
      if (row[key] !== undefined) { if (!finite(row[key])) return null; result[key] = row[key]; }
    }
    return result;
  };
  const rates = billing(item);
  if (!rates) return null;
  let extended: Pricing['extended'];
  if (item.extended !== undefined) {
    const tier = record(item.extended);
    if (!integer(tier.aboveInputTokens, 1) || !finite(tier.inputUsdPerMillion) || !finite(tier.outputUsdPerMillion) || (tier.cachedInputUsdPerMillion !== undefined && !finite(tier.cachedInputUsdPerMillion))) return null;
    const tierRates = billing(tier);
    if (!tierRates) return null;
    extended = { ...tierRates, aboveInputTokens: tier.aboveInputTokens, inputUsdPerMillion: tier.inputUsdPerMillion, outputUsdPerMillion: tier.outputUsdPerMillion,
      ...(tier.cachedInputUsdPerMillion !== undefined ? { cachedInputUsdPerMillion: tier.cachedInputUsdPerMillion as number } : {}) };
  }
  return {
    ...rates, inputUsdPerMillion: item.inputUsdPerMillion, outputUsdPerMillion: item.outputUsdPerMillion,
    ...(item.cachedInputUsdPerMillion !== undefined ? { cachedInputUsdPerMillion: item.cachedInputUsdPerMillion as number } : {}),
    ...(extended ? { extended } : {}),
  };
}

function capabilities(value: unknown, fallback?: ModelCapabilities): ModelCapabilities | undefined {
  const item = record(value);
  const contextWindow = item.contextWindow ?? fallback?.contextWindow;
  const maxOutputTokens = item.maxOutputTokens ?? fallback?.maxOutputTokens;
  if (!integer(contextWindow, 1) || !integer(maxOutputTokens, 1) || maxOutputTokens >= contextWindow) return undefined;
  const imageTokens = item.imageTokens ?? fallback?.imageTokens;
  if (imageTokens !== undefined && !integer(imageTokens, 1)) return undefined;
  return {
    text: typeof item.text === 'boolean' ? item.text : fallback?.text ?? false,
    image: typeof item.image === 'boolean' ? item.image : fallback?.image ?? false,
    tools: typeof item.tools === 'boolean' ? item.tools : fallback?.tools ?? false,
    contextWindow, maxOutputTokens, ...(imageTokens !== undefined ? { imageTokens } : {}),
  };
}

/**
 * Conversation has its own slot: MiMo must not replace the Kimi complex worker.
 * Credentials remain with the caller.
 * Persisted shape: { entries: [{ id, role, config, capabilities, pricing }] }.
 */
export function readModelRegistry(saved: unknown, seeds: RegistrySeeds): ModelEntry[] {
  if((true as boolean))return routePolicy('registry',[saved,seeds,Date.now()]);
  const entries = new Map<string, ModelEntry>();
  function seed(role: ModelRole, value: Seed | null | undefined, image = false) {
    const config = providerConfig(value);
    if (!config) return;
    const local = isLocalConfig(config);
    if ((role === 'everyday' || role === 'local-perception') && !local) return;
    const caps = capabilities(value?.capabilities, { text: true, image, tools: role !== 'local-perception', contextWindow: 32_768, maxOutputTokens: 4_096 });
    if (!caps) return;
    entries.set(role, { id: role, role, config, local, enabled: value?.enabled !== false, capabilities: caps, pricing: local ? { inputUsdPerMillion: 0, outputUsdPerMillion: 0 } : readPricing(value?.pricing) });
  }
  const vision = seeds.vision;
  const localSees = vision?.enabled === true && vision.model === seeds.local.model && (!vision.endpoint || vision.endpoint.replace(/\/+$/, '') === seeds.local.endpoint.replace(/\/+$/, ''));
  seed('everyday', seeds.local, localSees);
  seed('specialist', seeds.specialist);
  seed('conversation', seeds.conversation);
  if (vision?.enabled && vision.model.trim()) seed('local-perception', {
    provider: 'ollama', model: vision.model, endpoint: vision.endpoint || seeds.local.endpoint,
    temperature: seeds.local.temperature, capabilities: vision.capabilities,
  }, true);

  const source = Array.isArray(saved) ? saved : record(saved).entries;
  if (!Array.isArray(source)) return [...entries.values()];
  for (const raw of source) {
    const item = record(raw);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(item.id)) continue;
    const previous = entries.get(item.id);
    const role = item.role ?? previous?.role;
    if (typeof role !== 'string' || !ROLES.includes(role as ModelRole)) continue;
    if (item.id === 'everyday' && role !== 'everyday') continue;
    const config = providerConfig(item.config ?? previous?.config);
    if (!config) continue;
    const local = isLocalConfig(config);
    if ((role === 'everyday' || role === 'local-perception') && !local) continue;
    // Capabilities/pricing cannot silently transfer to a different deployment.
    const sameDeployment = previous && previous.config.provider === config.provider && previous.config.model === config.model && previous.config.endpoint === config.endpoint;
    const caps = capabilities(item.capabilities, sameDeployment ? previous.capabilities : undefined);
    if (!caps) continue;
    const observation = record(item.observed);
    const observed = integer(observation.attempts, 1) && integer(observation.successes) && observation.successes <= observation.attempts
      ? { attempts: observation.attempts, successes: observation.successes } : undefined;
    const verified = item.pricingVerifiedAt;
    const stale = typeof verified === 'number' && (Date.now() - verified > 86_400_000 || verified > Date.now() + 60_000);
    const price = stale ? null : Object.hasOwn(item, 'pricing') ? readPricing(item.pricing) : sameDeployment ? previous.pricing : null;
    entries.set(item.id, {
      id: item.id, role: role as ModelRole, config, local, enabled: typeof item.enabled === 'boolean' ? item.enabled : previous?.enabled ?? true,
      capabilities: caps, pricing: local ? { inputUsdPerMillion: 0, outputUsdPerMillion: 0 } : price,
      ...(observed ? { observed } : {}),
    });
  }
  return [...entries.values()];
}

/** The approved caps are defaults; zero explicitly disables automatic cloud spend. */
export function readTaskPolicy(saved: unknown): TaskPolicy {
  if((true as boolean))return routePolicy('taskPolicy',[saved]);
  const item = record(saved);
  const bounded = (key: keyof TaskPolicy, minimum: number, maximum: number): number => integer(item[key], minimum) && (item[key] as number) <= maximum ? item[key] as number : DEFAULT_TASK_POLICY[key] as number;
  return {
    enabled: item.enabled !== false,
    taskBudgetMicros: bounded('taskBudgetMicros', 0, Number.MAX_SAFE_INTEGER),
    dailyBudgetMicros: bounded('dailyBudgetMicros', 0, Number.MAX_SAFE_INTEGER),
    maxAttempts: bounded('maxAttempts', 1, 100), maxToolCalls: bounded('maxToolCalls', 0, 100),
    deadlineMs: bounded('deadlineMs', 1_000, 3_600_000), maxEscalations: bounded('maxEscalations', 0, 1),
  };
}

export type ReservationEstimate = { inputTokens: number; maxOutputTokens: number; costMicros: number };

/**
 * UTF-8 bytes conservatively bound text tokens without borrowing one model's
 * tokenizer for another. Message/tool framing also has an allowance. Billing
 * for an unbounded image reserves the entire remaining input context.
 */
/**
 * The size of a request, which is the same whoever is asked.
 *
 * Stringifying a 22,000-character system block and the tool table is not free,
 * and it was being done once per candidate route ? four seconds of a turn spent
 * re-measuring the same text. Measured once, then handed to each entry.
 */
export function measureRequest(conversation: readonly ChatMessage[], toolSchema?: readonly unknown[]): { inputTokens: number; imageCount: number } {
  if((true as boolean))return routePolicy('measure',[conversation,toolSchema]);
  let inputTokens = 64;
  let imageCount = 0;
  for (const message of conversation) {
    const { images, ...text } = message;
    inputTokens += Buffer.byteLength(JSON.stringify(text), 'utf8') + 32;
    imageCount += images?.length ?? 0;
  }
  if (toolSchema?.length) inputTokens += Buffer.byteLength(JSON.stringify(toolSchema), 'utf8') + 1024 + toolSchema.length * 64;
  return { inputTokens, imageCount };
}

export function estimateReservation(entry: ModelEntry, conversation: readonly ChatMessage[], maxOutputTokens = entry.capabilities.maxOutputTokens, toolSchema?: readonly unknown[], measured?: { inputTokens: number; imageCount: number }): ReservationEstimate | undefined {
  if((true as boolean))return routePolicy<ReservationEstimate|null>('estimate',[entry,conversation,maxOutputTokens,toolSchema,measured])??undefined;
  if (!integer(maxOutputTokens, 1) || maxOutputTokens > entry.capabilities.maxOutputTokens || !entry.capabilities.text) return undefined;
  if (!entry.local && !entry.pricing) return undefined;
  if (toolSchema?.length && !entry.capabilities.tools) return undefined;
  let inputTokens = 64;
  let imageCount = 0;
  if (measured) {
    inputTokens = measured.inputTokens;
    imageCount = measured.imageCount;
  } else {
    try {
      const m = measureRequest(conversation, toolSchema);
      inputTokens = m.inputTokens;
      imageCount = m.imageCount;
    } catch { return undefined; }
  }
  if (imageCount && !entry.capabilities.image) return undefined;
  const availableInput = entry.capabilities.contextWindow - maxOutputTokens;
  if (inputTokens > availableInput) return undefined;
  if (imageCount) inputTokens = entry.capabilities.imageTokens ? inputTokens + imageCount * entry.capabilities.imageTokens : availableInput;
  if (!Number.isSafeInteger(inputTokens) || inputTokens > availableInput) return undefined;
  const price = entry.pricing?.extended && inputTokens > entry.pricing.extended.aboveInputTokens ? entry.pricing.extended : entry.pricing;
  // USD per million tokens * token count is exactly microUSD before rounding.
  const costMicros = entry.local ? 0 : Math.ceil(inputTokens * Math.max(price!.inputUsdPerMillion, price!.cachedInputUsdPerMillion ?? 0, price!.uncachedInputUsdPerMillion ?? 0, price!.cacheWriteInputUsdPerMillion ?? 0, price!.cacheWrite1hInputUsdPerMillion ?? 0) + maxOutputTokens * price!.outputUsdPerMillion);
  return Number.isSafeInteger(costMicros) ? { inputTokens, maxOutputTokens, costMicros } : undefined;
}

/** Missing usage must retain the reservation rather than settle as a free call. */
export function usageCost(entry: ModelEntry, value: unknown, format: 'openai' | 'anthropic' = 'openai'): number | undefined {
  if((true as boolean))return routePolicy<number|null>('usageCost',[entry,value,format])??undefined;
  if (entry.local) return 0;
  if (!entry.pricing) return undefined;
  const usage = record(value);
  const input = usage.prompt_tokens ?? usage.prompt_eval_count ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.eval_count ?? usage.output_tokens;
  if (!integer(input) || !integer(output)) return undefined;
  const details = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const cached = details.cached_tokens ?? usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
  const written = details.cache_write_tokens ?? usage.cache_creation_input_tokens ?? 0;
  const cache = record(usage.cache_creation);
  const longWrite = cache.ephemeral_1h_input_tokens ?? 0;
  if (![cached, written, longWrite].every(n => integer(n)) || (longWrite as number) > (written as number)) return undefined;
  const read = cached as number, write = written as number, hour = longWrite as number;
  if (cache.ephemeral_5m_input_tokens !== undefined && (!integer(cache.ephemeral_5m_input_tokens) || cache.ephemeral_5m_input_tokens + hour !== write)) return undefined;
  // Native Anthropic input excludes cache tokens; OpenAI-compatible input includes them.
  const totalInput = format === 'anthropic' ? input + read + write : input;
  if (!Number.isSafeInteger(totalInput) || read + write > totalInput) return undefined;
  if (usage.total_tokens !== undefined && (!integer(usage.total_tokens) || usage.total_tokens !== totalInput + output)) return undefined;
  // Hosted tools carry fees outside token pricing; retain the reservation if encountered.
  if (Object.values(record(usage.server_tool_use)).some(n => n !== 0)) return undefined;
  const pricing = entry.pricing.extended && totalInput > entry.pricing.extended.aboveInputTokens ? entry.pricing.extended : entry.pricing;
  const base = pricing.uncachedInputUsdPerMillion ?? pricing.inputUsdPerMillion;
  const writeRate = pricing.cacheWriteInputUsdPerMillion ?? pricing.inputUsdPerMillion;
  const cost = Math.ceil((totalInput - read - write) * base + read * (pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion)
    + (write - hour) * writeRate + hour * (pricing.cacheWrite1hInputUsdPerMillion ?? Math.max(writeRate, pricing.inputUsdPerMillion))
    + output * pricing.outputUsdPerMillion);
  return Number.isSafeInteger(cost) && cost >= 0 ? cost : undefined;
}

export type RouteRequest = {
  cloudAllowed: boolean;
  inputs?: readonly ('text' | 'image')[];
  tools?: boolean;
  budgetMicros?: number;
  roleHint?: ModelRole | readonly ModelRole[];
  excludeIds?: readonly string[];
  available?: (entry: ModelEntry) => boolean;
  conversation?: readonly ChatMessage[];
  maxOutputTokens?: number;
  toolSchema?: readonly unknown[];
};

/** A role hint is a preference among eligible routes, never a policy bypass. */
export function selectModel(entries: readonly ModelEntry[], request: RouteRequest): ModelEntry | undefined {
  if((true as boolean))return routePolicy<ModelEntry|null>('select',[entries,observedRequest(entries,request)])??undefined;
  const eligible = eligibleModels(entries,request);
  const hints = request.roleHint ? typeof request.roleHint === 'string' ? [request.roleHint] : request.roleHint : [];
  const preferred = eligible.filter(candidate => hints.includes(candidate.entry.role));
  const candidates = preferred.length ? preferred : eligible;
  candidates.sort((a, b) => a.score - b.score || Number(b.entry.role === 'everyday') - Number(a.entry.role === 'everyday') || a.entry.id.localeCompare(b.entry.id));
  return candidates[0]?.entry;
}

/** Eligibility remains with verified configuration, privacy and credential adapters. */
export function eligibleModels(entries: readonly ModelEntry[], request: RouteRequest): {entry:ModelEntry;score:number;costMicros:number}[] {
  if((true as boolean))return routePolicy('eligible',[entries,observedRequest(entries,request)]);
  if (request.budgetMicros !== undefined && (!integer(request.budgetMicros))) return [];
  const inputs = request.inputs ?? ['text'];
  // Measured once for the whole routing decision, not once per candidate.
  let measured: { inputTokens: number; imageCount: number } | undefined;
  try { measured = measureRequest(request.conversation ?? [], request.toolSchema); } catch { measured = undefined; }
  const eligible = entries.flatMap(entry => {
    // Reserved adapter-only route. It must never win ordinary conversation,
    // privacy fallback or automatic escalation selection.
    if(entry.id==='local-planner')return [];
    if (!entry.enabled || request.excludeIds?.includes(entry.id) || request.available?.(entry) === false) return [];
    if (!entry.local && (!request.cloudAllowed || !entry.pricing)) return [];
    if (inputs.some(input => !entry.capabilities[input]) || (request.tools && !entry.capabilities.tools)) return [];
    const estimate = estimateReservation(entry, request.conversation ?? [], request.maxOutputTokens, request.toolSchema, measured);
    if (!estimate || estimate.costMicros > (request.budgetMicros ?? Number.MAX_SAFE_INTEGER)) return [];
    const observed = entry.observed;
    // Laplace smoothing prevents one lucky result from establishing a route.
    const successRate = observed ? (observed.successes + 1) / (observed.attempts + 2) : 0.5;
    return [{ entry, score: estimate.costMicros / successRate, costMicros:estimate.costMicros }];
  });
  return eligible;
}
