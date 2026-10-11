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
  return routePolicy('local',[config]);
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
  return routePolicy('registry',[saved,seeds,Date.now()]);
}

/** The approved caps are defaults; zero explicitly disables automatic cloud spend. */
export function readTaskPolicy(saved: unknown): TaskPolicy {
  return routePolicy('taskPolicy',[saved]);
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
  return routePolicy('measure',[conversation,toolSchema]);
}

export function estimateReservation(entry: ModelEntry, conversation: readonly ChatMessage[], maxOutputTokens = entry.capabilities.maxOutputTokens, toolSchema?: readonly unknown[], measured?: { inputTokens: number; imageCount: number }): ReservationEstimate | undefined {
  return routePolicy<ReservationEstimate|null>('estimate',[entry,conversation,maxOutputTokens,toolSchema,measured])??undefined;
}

/** Missing usage must retain the reservation rather than settle as a free call. */
export function usageCost(entry: ModelEntry, value: unknown, format: 'openai' | 'anthropic' = 'openai'): number | undefined {
  return routePolicy<number|null>('usageCost',[entry,value,format])??undefined;
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
  return routePolicy<ModelEntry|null>('select',[entries,observedRequest(entries,request)])??undefined;
}

/** Eligibility remains with verified configuration, privacy and credential adapters. */
export function eligibleModels(entries: readonly ModelEntry[], request: RouteRequest): {entry:ModelEntry;score:number;costMicros:number}[] {
  return routePolicy('eligible',[entries,observedRequest(entries,request)]);
}
