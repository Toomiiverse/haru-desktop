import type { ModelRole, Pricing, ProviderConfig } from './model-registry';

export const DIRECT_MODELS = [
  { id: 'conversation', role: 'conversation', model: 'mimo-v2.6-pro', endpoint: 'https://api.xiaomimimo.com/v1', provider: 'openai', context: 1_000_000, output: 4096, source: 'https://mimo.mi.com/models/en-US/mimo-v2.6-pro' },
  { id: 'affordable-cloud', role: 'affordable-cloud', model: 'deepseek-flash', endpoint: 'https://api.deepseek.com', provider: 'openai', context: 1_000_000, output: 4096, source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  { id: 'specialist', role: 'specialist', model: 'claude-sonnet-5', endpoint: 'https://api.anthropic.com/v1', provider: 'anthropic', context: 1_000_000, output: 4096, source: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { id: 'complex', role: 'complex', model: 'kimi-k3', endpoint: 'https://api.moonshot.ai/v1', provider: 'openai', context: 1_048_576, output: 4096, source: 'https://platform.kimi.ai/docs/pricing/chat' },
  // Restrict the input window to the documented 922K maximum, with 2048 output.
  { id: 'premium', role: 'premium', model: 'gpt-6-astra', endpoint: 'https://api.openai.com/v1', provider: 'openai', context: 924_048, output: 2048, source: 'https://developers.openai.com/api/docs/models/gpt-6-astra.md' },
] as const;
export type DirectModel = typeof DIRECT_MODELS[number];
export type CatalogEntry = { id: string; role: ModelRole; config: ProviderConfig; enabled: boolean;
  capabilities: { text: boolean; image: boolean; tools: boolean; contextWindow: number; maxOutputTokens: number };
  pricing: Pricing; pricingVerifiedAt: number; pricingSource: string };

const plain = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

/** Parse the exact model row. Changed/missing formats expire rather than renew guessed rates. */
export function parseDirectPricing(model: DirectModel['model'], document: string): Pricing | null {
  const text = plain(document);
  let input: number, output: number, cached: number;
  let billing: Partial<Pricing> = {};
  const number = (value: string | undefined) => value === undefined ? NaN : Number(value);
  if (model === 'mimo-v2.6-pro') {
    if (!/MiMo-V2\.6-Pro/i.test(text)) return null;
    const row = text.match(/USD Input \(cache hit\) \$([\d.]+) USD \/ Million tokens Input \(cache miss\) \$([\d.]+) USD \/ Million tokens Output \$([\d.]+) USD \/ Million tokens/);
    cached = number(row?.[1]); input = number(row?.[2]); output = number(row?.[3]);
  } else if (model === 'deepseek-flash') {
    if (!/MODEL deepseek-flash/.test(text)) return null;
    // First table column is Flash; peak rates bound both billing periods.
    const peak = (label: string) => number(text.match(new RegExp(label + ' OFF-PEAK \\$[\\d.]+ \\$[\\d.]+ PEAK \\$([\\d.]+)'))?.[1]);
    cached = peak('1M INPUT TOKENS \\(CACHE HIT\\)'); input = peak('1M INPUT TOKENS \\(CACHE MISS\\)'); output = peak('1M OUTPUT TOKENS');
  } else if (model === 'claude-sonnet-5') {
    const row = text.match(/Claude Sonnet 5 \$([\d.]+) \/ MTok \$([\d.]+) \/ MTok \$([\d.]+) \/ MTok \$([\d.]+) \/ MTok \$([\d.]+) \/ MTok/);
    billing = { uncachedInputUsdPerMillion: number(row?.[1]), cacheWriteInputUsdPerMillion: number(row?.[3]), cacheWrite1hInputUsdPerMillion: number(row?.[4]) };
    input = Math.max(number(row?.[1]), number(row?.[3]), number(row?.[4])); output = number(row?.[2]); cached = number(row?.[5]);
  } else if (model === 'kimi-k3') {
    // This official page renders the table from embedded JSX; read data only, never evaluate it.
    const row = document.match(/rows:\[\[`kimi-k3`,`1M tokens`,([\s\S]{1,900}?)`1,048,576 tokens`/);
    const values = [...(row?.[1] ?? '').matchAll(/children:\[`\$`,`([\d.]+)`\]/g)].map(m => Number(m[1]));
    if (values.length !== 5) return null;
    billing = { uncachedInputUsdPerMillion: values[3], cacheWriteInputUsdPerMillion: values[0], cacheWrite1hInputUsdPerMillion: values[1] };
    input = Math.max(values[0], values[1], values[3]); cached = values[2]; output = values[4];
  } else {
    if (!document.includes('Model ID: `gpt-6-astra`')) return null;
    const rate = (label: string) => number(document.match(new RegExp('\\| ' + label + ' \\| \\$([\\d.]+) \\| 1M tokens \\|'))?.[1]);
    billing = { uncachedInputUsdPerMillion: rate('Input'), cacheWriteInputUsdPerMillion: rate('Cache writes') };
    input = Math.max(rate('Input'), rate('Cache writes')); output = rate('Output'); cached = rate('Cached input');
    const tier = document.match(/more than ([\d.]+)K input tokens are priced at ([\d.]+)x input and cache rates and ([\d.]+)x output/);
    if (!tier || ![input, output, cached].every(n => Number.isFinite(n) && n >= 0)) return null;
    const extended = { uncachedInputUsdPerMillion: billing.uncachedInputUsdPerMillion! * Number(tier[2]), cacheWriteInputUsdPerMillion: billing.cacheWriteInputUsdPerMillion! * Number(tier[2]), aboveInputTokens: Number(tier[1]) * 1000, inputUsdPerMillion: input * Number(tier[2]), outputUsdPerMillion: output * Number(tier[3]), cachedInputUsdPerMillion: cached * Number(tier[2]) };
    if (!Number.isSafeInteger(extended.aboveInputTokens) || extended.aboveInputTokens < 1) return null;
    return { ...billing, inputUsdPerMillion: input, outputUsdPerMillion: output, cachedInputUsdPerMillion: cached, extended };
  }
  return [input, output, cached].every(n => Number.isFinite(n) && n >= 0) ? { ...billing, inputUsdPerMillion: input, outputUsdPerMillion: output, cachedInputUsdPerMillion: cached } : null;
}

/**
 * NanoGPT prices, read from its model page.
 *
 * The page embeds JSON-LD `PropertyValue` pairs ("Input price": "$1.25 per 1M
 * tokens"). Only these three names are read, so unrelated properties (context,
 * max output) cannot be mistaken for money. Missing price means null, which
 * expires the route rather than renewing a guessed rate.
 */
export function nanoGptPricing(document: string): Pricing | null {
  const price = (name: string): number => {
    const match = document.match(new RegExp('"name":"' + name + '","value":"\\$([\\d.]+)'));
    return match ? Number(match[1]) : NaN;
  };
  const input = price('Input price'), output = price('Output price'), cached = price('Cache read price');
  if (![input, output].every(n => Number.isFinite(n) && n >= 0)) return null;
  return { inputUsdPerMillion: input, outputUsdPerMillion: output, ...(Number.isFinite(cached) ? { cachedInputUsdPerMillion: cached } : {}) };
}

/** Exact Large V2 row; absent/changed pricing must expire rather than be guessed. */
export function abliterationPricing(document: string): Pricing | null {
  const text = plain(document).replace(/\\\$/g, '$').replace(/[|`]/g, ' ').replace(/\s+/g, ' ');
  const row = text.match(/\babliterated-model-large-v2\s+\$([\d.]+)\s+\$([\d.]+)\s+\$([\d.]+)/);
  if (!row) return null;
  const [input, cached, output] = row.slice(1).map(Number);
  if (![input, cached, output].every(n => Number.isFinite(n) && n >= 0)) return null;
  return { inputUsdPerMillion: input, cachedInputUsdPerMillion: cached, outputUsdPerMillion: output };
}

export function directCatalogEntry(model: DirectModel, document: string, now = Date.now()): CatalogEntry | undefined {
  const pricing = parseDirectPricing(model.model, document);
  if (!pricing) return undefined;
  return { id: model.id, role: model.role, config: { provider: model.provider, endpoint: model.endpoint, model: model.model, temperature: 0.7 }, enabled: true,
    capabilities: { text: true, image: true, tools: true, contextWindow: model.context, maxOutputTokens: model.output }, pricing, pricingVerifiedAt: now, pricingSource: model.source };
}

/** Merge against the latest settings after fetching. Never replace a user's deployment or counters. */
export function refreshDirectEntries(saved: { entries?: any[] } | undefined, updates: CatalogEntry[]) {
  return { ...saved, entries: (saved?.entries ?? []).map(entry => {
    const update = updates.find(next => next.id === entry.id && next.role === entry.role && next.config.model === entry.config?.model && next.config.provider === entry.config?.provider && next.config.endpoint === entry.config?.endpoint);
    return update ? { ...entry, pricing: update.pricing, pricingVerifiedAt: update.pricingVerifiedAt, pricingSource: update.pricingSource } : entry;
  }) };
}
