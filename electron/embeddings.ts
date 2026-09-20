export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

export type Embedder = {
  model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
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
  const embedOnce = async (texts: string[]): Promise<number[][]> => {
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // On the CPU, and kept there: the embedder is 350 MB and a text takes it
      // 50 ms, while on the GPU it did not fit beside the 9B at its Q6 size —
      // Ollama evicted one to load the other, eight seconds a swap, several
      // swaps a conversation. Nothing she says waits on this.
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
  return {
    model,
    async embed(text) {
      const [vector] = await embedOnce([text]);
      return vector;
    },
    embedBatch: embedOnce,
  };
}

export function openAIEmbedder(endpoint: string, model: string, apiKey: string | undefined, fetchImpl: FetchLike): Embedder {
  const embedOnce = async (texts: string[]): Promise<number[][]> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
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
    async embed(text) {
      const [vector] = await embedOnce([text]);
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
  return {
    model: inner.model,
    async embed(text) {
      const hit = cache.get(text, inner.model);
      if (hit) return hit;
      const vector = await inner.embed(text);
      cache.set(text, inner.model, vector);
      return vector;
    },
    async embedBatch(texts) {
      const missing: { text: string; index: number }[] = [];
      const out: number[][] = new Array(texts.length);
      texts.forEach((text, index) => {
        const hit = cache.get(text, inner.model);
        if (hit) out[index] = hit;
        else missing.push({ text, index });
      });
      if (!missing.length) return out;
      const fresh = await inner.embedBatch(missing.map(item => item.text));
      fresh.forEach((vector, position) => {
        const item = missing[position];
        out[item.index] = vector;
        cache.set(item.text, inner.model, vector);
      });
      return out;
    },
  };
}
