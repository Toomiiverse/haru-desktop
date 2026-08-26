import test from 'node:test';
import assert from 'node:assert/strict';
import { cosine, similarityScore, keywordSearch, vectorSearch, hybridSearch, keywordOnly, keywordOverlap, rerank, recencyScore } from '../electron/retrieval';
import { chunkRecord, documentRecord, storeWith, wordEmbedding } from './helpers';

function makeStore() {
  const arch = chunkRecord({
    id: 'arch', documentId: 'server', content: "Haru's server was migrated to Arch Linux.", category: 'haru', updatedAt: '2026-08-24T00:00:00.000Z',
  });
  const ubuntu = chunkRecord({
    id: 'ubuntu', documentId: 'server', content: 'The server previously ran Ubuntu.', category: 'haru', updatedAt: '2026-08-01T00:00:00.000Z',
  });
  const garden = chunkRecord({
    id: 'garden', documentId: 'home', content: 'The garden needs watering on Tuesdays.', category: 'personal', updatedAt: '2026-08-20T00:00:00.000Z',
  });
  const embedding = chunkRecord({
    id: 'embed', documentId: 'notes', content: 'Embeddings are generated with the nomic-embed-text model.', category: 'technical', updatedAt: '2026-08-15T00:00:00.000Z',
  });
  return storeWith(
    [arch, ubuntu, garden, embedding],
    [
      documentRecord({ id: 'server', source: 'haru/server.md', category: 'haru', chunkIds: ['arch', 'ubuntu'] }),
      documentRecord({ id: 'home', source: 'personal/home.md', category: 'personal', chunkIds: ['garden'] }),
      documentRecord({ id: 'notes', source: 'technical/notes.md', category: 'technical', chunkIds: ['embedding'] }),
    ],
  );
}

test('cosine and similarityScore agree on identical and unrelated vectors', () => {
  const a = wordEmbedding('haru runs arch linux on her server');
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(similarityScore(a, a) - 1) < 1e-9);
  assert.equal(similarityScore(a, wordEmbedding('the cat sat on the mat')), 0);
});

test('keywordOverlap finds shared content words and scores by query coverage', () => {
  const { score, matched } = keywordOverlap('what linux does haru run', "Haru's server was migrated to Arch Linux");
  assert.ok(matched.includes('linux'));
  assert.ok(matched.includes('haru'));
  assert.ok(score > 0.4);
});

test('relevant documents rank above irrelevant ones in hybrid search', () => {
  const store = makeStore();
  const query = 'what linux distribution is haru running';
  const results = hybridSearch(store, query, wordEmbedding(query), { topK: 10, threshold: 0.15, rerankTo: 5 });
  assert.equal(results[0].chunk.id, 'arch');
  assert.ok(!results.some(result => result.chunk.id === 'garden'));
  const arch = results.findIndex(result => result.chunk.id === 'arch');
  const ubuntu = results.findIndex(result => result.chunk.id === 'ubuntu');
  if (ubuntu >= 0) assert.ok(arch < ubuntu);
});

test('exact technical terms surface through keyword search when vectors are useless', () => {
  const store = makeStore();
  const results = hybridSearch(store, 'nomic-embed-text', new Array(96).fill(0), { topK: 10, threshold: 0.35, rerankTo: 3 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].chunk.id, 'embed');
});

test('category filtering excludes other categories', () => {
  const store = makeStore();
  const query = 'server garden';
  const all = hybridSearch(store, query, wordEmbedding(query), { topK: 10, threshold: 0.1, rerankTo: 10 });
  assert.ok(all.some(result => result.chunk.category === 'personal'));
  const filtered = hybridSearch(store, query, wordEmbedding(query), { topK: 10, threshold: 0.1, rerankTo: 10, filters: { category: 'haru' } });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every(result => result.chunk.category === 'haru'));
});

test('similarity threshold drops weak matches', () => {
  const store = makeStore();
  const query = 'garden watering tuesday';
  const strict = vectorSearch(store, wordEmbedding(query), { topK: 10, threshold: 0.9 });
  assert.ok(strict.every(result => result.vectorScore >= 0.9));
  const loose = vectorSearch(store, wordEmbedding(query), { topK: 10, threshold: 0.1 });
  assert.ok(loose.some(result => result.chunk.id === 'garden'));
});

test('vectorSearch honours topK', () => {
  const store = makeStore();
  const query = 'haru server';
  const results = vectorSearch(store, wordEmbedding(query), { topK: 2, threshold: 0.05 });
  assert.ok(results.length <= 2);
});

test('newer information outranks stale information of equal relevance', () => {
  const now = new Date('2026-08-25T00:00:00.000Z');
  const query = 'what does the server run';
  const shared = wordEmbedding('the server operating system');
  const store = storeWith([
    chunkRecord({ id: 'arch', content: 'Haru runs Arch Linux on the server.', updatedAt: '2026-08-24T00:00:00.000Z', embedding: shared }),
    chunkRecord({ id: 'ubuntu', content: 'Haru previously ran Ubuntu on the server.', updatedAt: '2026-08-01T00:00:00.000Z', embedding: shared }),
  ]);
  const results = hybridSearch(store, query, shared, { topK: 10, threshold: 0.1, rerankTo: 5, now });
  const rank = results.findIndex(result => result.chunk.id === 'arch');
  const staleRank = results.findIndex(result => result.chunk.id === 'ubuntu');
  assert.ok(rank >= 0 && staleRank >= 0, 'both server chunks should surface');
  assert.ok(rank < staleRank, 'the Arch Linux note (newer) should outrank the Ubuntu one (stale)');
});

test('high-confidence sources are prioritised over equal low-confidence ones', () => {
  const store = storeWith([
    chunkRecord({ id: 'confident', content: 'The build server runs Debian.', confidence: 1, updatedAt: '2026-08-01T00:00:00.000Z' }),
    chunkRecord({ id: 'guessy', content: 'The build server might run Debian.', confidence: 0.4, updatedAt: '2026-08-01T00:00:00.000Z' }),
  ]);
  const query = 'build server debian';
  const results = hybridSearch(store, query, wordEmbedding(query), { topK: 5, threshold: 0.1, rerankTo: 5 });
  const confident = results.findIndex(result => result.chunk.id === 'confident');
  const guessy = results.findIndex(result => result.chunk.id === 'guessy');
  assert.ok(confident >= 0 && guessy >= 0);
  assert.ok(confident < guessy);
});

test('stale chunks never surface by default', () => {
  const stale = chunkRecord({ id: 'old', content: 'Haru runs Windows.', status: 'stale' });
  const store = storeWith([stale]);
  const query = 'haru windows';
  assert.deepEqual(hybridSearch(store, query, wordEmbedding(query), { topK: 5, threshold: 0.05, rerankTo: 5 }), []);
  const explicit = hybridSearch(store, query, wordEmbedding(query), { topK: 5, threshold: 0.05, rerankTo: 5, filters: { status: 'stale' } });
  assert.equal(explicit.length, 1);
});

test('keywordOnly recovers exact matches when embeddings are unavailable', () => {
  const store = makeStore();
  const results = keywordOnly(store, 'arch linux', { topK: 10, threshold: 0.1, rerankTo: 3 });
  assert.ok(results.length >= 1);
  assert.ok(results.some(result => result.chunk.id === 'arch'));
});

test('recencyScore decays over time', () => {
  const now = new Date('2026-08-25T00:00:00.000Z');
  const fresh = recencyScore('2026-08-24T00:00:00.000Z', now, 90);
  const ancient = recencyScore('2020-01-01T00:00:00.000Z', now, 90);
  assert.ok(fresh > ancient);
  assert.ok(recencyScore('2026-08-24T00:00:00.000Z', now, 90) > 0.9);
});

test('rerank blends vector, keyword, recency and confidence into a bounded score', () => {
  const item = {
    chunk: chunkRecord({ id: 'x', content: 'Something about haru server.', confidence: 1, updatedAt: '2026-08-24T00:00:00.000Z' }),
    vectorScore: 0.8,
    keywordScore: 0.5,
    score: 0,
    matched: ['haru'],
  };
  const ranked = rerank([item], 'haru server', { topK: 5, threshold: 0.1, rerankTo: 5, now: new Date('2026-08-25T00:00:00.000Z') });
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score > 0.5 && ranked[0].score <= 1);
});
