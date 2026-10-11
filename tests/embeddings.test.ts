import test from 'node:test';
import assert from 'node:assert/strict';
import type { FetchLike } from '../electron/embeddings';
import { EmbeddingCache, cachedEmbedder, ollamaEmbedder, openAIEmbedder, createEmbedder } from '../electron/embeddings';
import { stubEmbedder, wordEmbedding } from './helpers';

function mockFetch(respond: (init?: { body?: string; headers?: Record<string, string> }) => { status: number; body: string }) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ?? '', headers: init?.headers ?? {} });
    const answer = respond(init);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => answer.body,
      json: async () => JSON.parse(answer.body),
    } as unknown as Response;
  };
  return { fetchImpl, calls };
}

test('ollamaEmbedder posts to /api/embed and reads embeddings back', async () => {
  const { fetchImpl, calls } = mockFetch(init => {
    const parsed = JSON.parse(init?.body ?? '{}') as { input?: string | string[] };
    const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
    return { status: 200, body: JSON.stringify({ embeddings: inputs.map(() => wordEmbedding('embedded')) }) };
  });
  const embedder = ollamaEmbedder('http://localhost:11434', 'nomic-embed-text', fetchImpl);
  const vectors = await embedder.embedBatch(['one', 'two']);
  assert.equal(vectors.length, 2);
  assert.equal(calls[0].url, 'http://localhost:11434/api/embed');
  assert.ok(calls[0].body.includes('nomic-embed-text'));
});

test('ollamaEmbedder reports a missing model as a useful error', async () => {
  const { fetchImpl } = mockFetch(() => ({ status: 404, body: '{"error":"model not found"}' }));
  const embedder = ollamaEmbedder('http://localhost:11434', 'missing-model', fetchImpl);
  await assert.rejects(() => embedder.embed('hello'), /not installed|embedding failed/);
});

test('openAIEmbedder posts to /v1/embeddings with an auth header', async () => {
  const { fetchImpl, calls } = mockFetch(() => ({ status: 200, body: JSON.stringify({ data: [{ index: 0, embedding: wordEmbedding('x') }] }) }));
  const embedder = openAIEmbedder('https://api.example.com/v1', 'text-embedding-3-small', 'secret-key', fetchImpl);
  await embedder.embed('hello');
  assert.equal(calls[0].url, 'https://api.example.com/v1/embeddings');
  assert.equal(calls[0].headers.Authorization, 'Bearer secret-key');
});

test('createEmbedder chooses the dialect by provider', () => {
  const { fetchImpl } = mockFetch(init => {
    const parsed = JSON.parse(init?.body ?? '{}') as { input?: string | string[] };
    const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
    return { status: 200, body: JSON.stringify({ embeddings: inputs.map(() => wordEmbedding('x')) }) };
  });
  const ollama = createEmbedder({ endpoint: 'http://localhost:11434', model: 'nomic-embed-text', provider: 'ollama' }, fetchImpl);
  const openai = createEmbedder({ endpoint: 'https://api.example.com/v1', model: 'm', provider: 'openai', apiKey: 'k' }, fetchImpl);
  assert.equal(ollama.model, 'nomic-embed-text');
  assert.equal(openai.model, 'm');
});

test('EmbeddingCache evicts the oldest entry past its cap', () => {
  const cache = new EmbeddingCache(2);
  cache.set('a', 'm', [1]);
  cache.set('b', 'm', [2]);
  cache.set('c', 'm', [3]);
  assert.equal(cache.get('a', 'm'), undefined);
  assert.deepEqual(cache.get('b', 'm'), [2]);
});

test('cachedEmbedder serves repeats from the cache and only asks the inner embedder for what is missing', async () => {
  let calls = 0;
  const inner = {
    model: 'stub',
    async embed(text: string) { calls++; return wordEmbedding(text); },
    async embedBatch(texts: string[]) { calls += texts.length; return texts.map(text => wordEmbedding(text)); },
  };
  const cache = new EmbeddingCache();
  const embedder = cachedEmbedder(inner, cache);
  const first = await embedder.embedBatch(['one', 'two']);
  assert.equal(calls, 2);
  const second = await embedder.embedBatch(['one', 'two', 'three']);
  assert.equal(calls, 3);
  assert.equal(second[0].length, first[0].length);
  assert.deepEqual(second[0], first[0]);
});
