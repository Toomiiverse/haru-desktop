import type { ProviderConfig } from './model-registry';
/** Provider catalog metadata only: no key, prompt or conversation is sent. */
export function veniceRegistryEntries(catalog: unknown, routes: { id: string; role: string; config?: ProviderConfig }[], now = Date.now()) {
  const data = (catalog as { data?: any[] })?.data;
  if (!Array.isArray(data)) throw new Error('invalid_model_catalog');
  return routes.flatMap(route => {
    if (!route.config || route.config.provider !== 'venice' || route.config.endpoint.replace(/\/+$/, '') !== 'https://api.venice.ai/api/v1') return [];
    const model = data.find(item => item.id === route.config!.model), spec = model?.model_spec, price = spec?.pricing, cap = spec?.capabilities;
    if (!price || !cap || spec.offline || !Number.isFinite(price.input?.usd) || !Number.isFinite(price.output?.usd) || !Number.isSafeInteger(model.context_length)) return [];
    // Cache writes can be dearer than fresh input. Use the highest published rate
    // for a conservative reservation, regardless of provider caching behavior.
    const input = Math.max(price.input.usd, price.cache_write?.usd ?? 0);
    return [{ ...route, pricingVerifiedAt: now, enabled: true,
      pricing: { inputUsdPerMillion: input, outputUsdPerMillion: price.output.usd,
        uncachedInputUsdPerMillion: price.input.usd,
        ...(price.cache_input?.usd !== undefined ? { cachedInputUsdPerMillion: price.cache_input.usd } : {}),
        ...(price.cache_write?.usd !== undefined ? { cacheWriteInputUsdPerMillion: price.cache_write.usd } : {}) },
      capabilities: { text: true, image: cap.supportsVision === true, tools: cap.supportsFunctionCalling === true,
        contextWindow: model.context_length, maxOutputTokens: Math.min(4096, spec.maxCompletionTokens ?? 4096) } }];
  });
}
