import { abortable, EmbeddingQueue } from './embedding-queue';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
export type EmbedRequest = { signal?: AbortSignal };
export const EMBEDDING_BATCH_SIZE = 4;
const BATCH_TIMEOUT_MS = 10_000;
const queues = new WeakMap<FetchLike, Map<string, EmbeddingQueue>>();
function queueFor(fetchImpl: FetchLike, endpoint: string): EmbeddingQueue {
  let byEndpoint = queues.get(fetchImpl);
  if (!byEndpoint) { byEndpoint = new Map(); queues.set(fetchImpl, byEndpoint); }
  const url = new URL(endpoint);
  if (['localhost', '[::1]'].includes(url.hostname)) url.hostname = '127.0.0.1';
  const key = url.href.replace(/\/+$/, '');
  if (!byEndpoint.has(key)) byEndpoint.set(key, new EmbeddingQueue());
  return byEndpoint.get(key)!;
}

export type Embedder = {
  model: string;
  cacheKey?: string;
  embed(text: string, options?: EmbedRequest): Promise<number[]>;
  embedBatch(texts: string[], options?: EmbedRequest): Promise<number[][]>;
};

export type EmbedderOptions = {
  endpoint: string;
  model: string;
  provider?: 'ollama' | 'openai';
  apiKey?: string;
};

function describe(response: Response, detail: string): string {
  return `embedding failed (${response.status}) — ${detail}`;
}

export function ollamaEmbedder(endpoint: string, model: string, fetchImpl: FetchLike): Embedder {
  const queue = queueFor(fetchImpl, endpoint);
  const embedOnce = async (texts: string[], signal: AbortSignal): Promise<number[][]> => {
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      // Keep embeddings on the dedicated CPU instance, without model swaps.
      body: JSON.stringify({ model, input: texts, keep_alive: -1, options: { num_gpu: 0 } }),
    });
    const body = await response.text().catch(() => '');
    if (!response.ok) {
      const reason = body ? `the model ${model} may not be installed (${body.slice(0, 200)})` : 'no model';
      throw new Error(describe(response, reason));
    }
    let payload: { embeddings?: number[][] };
    try { payload = JSON.parse(body) as typeof payload; } catch { throw new Error(describe(response, 'the answer was not JSON')); }
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length) {
      throw new Error(describe(response, `expected ${texts.length} embeddings, got ${Array.isArray(payload.embeddings) ? payload.embeddings.length : 'none'}`));
    }
    return payload.embeddings;
  };
  const request = (texts: string[], query: boolean, options?: EmbedRequest) => {
    const abort = new AbortController();
    const signal = options?.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    const timer = setTimeout(() => abort.abort(new Error('embedding_timeout')), BATCH_TIMEOUT_MS);
    return queue.run(query, () => abortable(() => embedOnce(texts, signal), signal), signal)
      .finally(() => clearTimeout(timer));
  };
  return {
    model,
    cacheKey: `${endpoint.replace(/\/+$/, '')}\u0000${model}`,
    async embed(text, options) {
      const [vector] = await request([text], true, options);
      return vector;
    },
    async embedBatch(texts, options) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        out.push(...await request(texts.slice(i, i + EMBEDDING_BATCH_SIZE), false, options));
      }
      return out;
    },
  };
}

export function openAIEmbedder(endpoint: string, model: string, apiKey: string | undefined, fetchImpl: FetchLike): Embedder {
  const embedOnce = async (texts: string[], options?: EmbedRequest): Promise<number[][]> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      signal: options?.signal,
      headers,
      body: JSON.stringify({ model, input: texts }),
    });
    const body = await response.text().catch(() => '');
    if (!response.ok) throw new Error(describe(response, (() => { try { const parsed = JSON.parse(body) as { error?: { message?: string } }; return parsed.error?.message ?? 'rejected'; } catch { return 'rejected'; } })()));
    let payload: { data?: { index?: number; embedding?: number[] }[] };
    try { payload = JSON.parse(body) as typeof payload; } catch { throw new Error(describe(response, 'the answer was not JSON')); }
    const vectors = (payload.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(item => item.embedding ?? []);
    if (vectors.length !== texts.length) throw new Error(describe(response, `expected ${texts.length} embeddings, got ${vectors.length}`));
    return vectors;
  };
  return {
    model,
    cacheKey: `${endpoint.replace(/\/+$/, '')}\u0000${model}`,
    async embed(text, options) {
      const [vector] = await embedOnce([text], options);
      return vector;
    },
    embedBatch: embedOnce,
  };
}

export function createEmbedder(options: EmbedderOptions, fetchImpl: FetchLike): Embedder {
  return options.provider === 'openai'
    ? openAIEmbedder(options.endpoint, options.model, options.apiKey, fetchImpl)
    : ollamaEmbedder(options.endpoint, options.model, fetchImpl);
}

export class EmbeddingCache {
  private map = new Map<string, number[]>();

  constructor(private max = 3000) {}

  private key(text: string, model: string): string {
    return `${model}\u0000${text}`;
  }

  get(text: string, model: string): number[] | undefined {
    const key = this.key(text, model);
    const value = this.map.get(key);
    if (value) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(text: string, model: string, embedding: number[]): void {
    const key = this.key(text, model);
    if (this.map.has(key)) this.map.delete(key);
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, embedding);
  }

  size(): number {
    return this.map.size;
  }
}

export function cachedEmbedder(inner: Embedder, cache: EmbeddingCache): Embedder {
  const key = inner.cacheKey ?? inner.model;
  return {
    model: inner.model,
    cacheKey: key,
    async embed(text, options) {
      options?.signal?.throwIfAborted();
      const hit = cache.get(text, key);
      if (hit) return hit;
      const vector = await inner.embed(text, options);
      options?.signal?.throwIfAborted();
      cache.set(text, key, vector);
      return vector;
    },
    async embedBatch(texts, options) {
      options?.signal?.throwIfAborted();
      const missing: { text: string; index: number }[] = [];
      const out: number[][] = new Array(texts.length);
      texts.forEach((text, index) => {
        const hit = cache.get(text, key);
        if (hit) out[index] = hit;
        else missing.push({ text, index });
      });
      if (!missing.length) return out;
      // Retain completed chunks if a later batch fails; retries must not keep
      // rebuilding the same collection from its first record.
      for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = missing.slice(i, i + EMBEDDING_BATCH_SIZE);
        const fresh = await inner.embedBatch(batch.map(item => item.text), options);
        options?.signal?.throwIfAborted();
        fresh.forEach((vector, position) => {
          const item = batch[position];
          out[item.index] = vector;
          cache.set(item.text, key, vector);
        });
      }
      return out;
    },
  };
}
