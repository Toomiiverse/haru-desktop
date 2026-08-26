import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeContext, emptyKnowledgeContext } from '../electron/context';
import type { ScoredChunk } from '../electron/retrieval';
import { chunkRecord } from './helpers';

function scored(id: string, content: string, score: number, overrides: Omit<Parameters<typeof chunkRecord>[0], 'id' | 'content'> = {}): ScoredChunk {
  return { chunk: chunkRecord({ id, content, source: 'haru/server.md', ...overrides }), vectorScore: score, keywordScore: 0, score, matched: [] };
}

test('buildKnowledgeContext carries provenance for every source', () => {
  const text = buildKnowledgeContext([
    scored('a', 'Haru\'s server currently runs Arch Linux.', 0.9, { source: 'haru/server.md', version: 2, confidence: 1 }),
  ], { maxItems: 5, maxChars: 2000 });
  assert.ok(text.startsWith('RELEVANT KNOWLEDGE'));
  assert.ok(text.includes('Source: haru/server.md'));
  assert.ok(text.includes('Confidence: 1.00'));
  assert.ok(text.includes('Arch Linux'));
});

test('context distinguishes multiple sources and warns about conflicts', () => {
  const text = buildKnowledgeContext([
    scored('a', 'The server runs Arch Linux.', 0.8, { source: 'haru/server.md', confidence: 1 }),
    scored('b', 'The server previously ran Ubuntu.', 0.6, { source: 'conversation/2026-08-24', confidence: 0.82, version: 1 }),
  ], { maxItems: 5, maxChars: 2000 });
  assert.ok(text.includes('Source: haru/server.md'));
  assert.ok(text.includes('Source: conversation/2026-08-24'));
  assert.ok(text.includes('Confidence: 0.82'));
  assert.match(text, /prefer the most recently updated/i);
});

test('context groups chunks from the same document into one block', () => {
  const text = buildKnowledgeContext([
    scored('a', 'First chunk of the server doc.', 0.9, { source: 'haru/server.md', heading: 'Setup' }),
    scored('b', 'Second chunk of the server doc.', 0.8, { source: 'haru/server.md', heading: 'Setup' }),
  ], { maxItems: 5, maxChars: 2000 });
  const sources = text.match(/Source: haru\/server\.md/g) ?? [];
  assert.equal(sources.length, 2);
});

test('context respects the character cap', () => {
  const items = Array.from({ length: 20 }, (_, i) => scored(`c${i}`, 'Short chunk content here.', 1, { source: `docs/file${i}.md` }));
  const text = buildKnowledgeContext(items, { maxItems: 20, maxChars: 600 });
  const sources = text.match(/Source: docs\/file\d+\.md/g) ?? [];
  assert.ok(sources.length < 20, `expected the cap to drop most sources, kept ${sources.length}`);
  assert.ok(text.length < 1500, `expected a bounded block, got ${text.length} chars`);
  assert.ok(text.includes('docs/file0.md'));
});

test('context caps the number of items', () => {
  const items = Array.from({ length: 10 }, (_, i) => scored(`c${i}`, 'Short content.', 1, { source: `docs/file${i}.md` }));
  const text = buildKnowledgeContext(items, { maxItems: 3, maxChars: 20000 });
  const sources = text.match(/Source: docs\/file\d+\.md/g) ?? [];
  assert.equal(sources.length, 3);
});

test('empty items produce an empty block', () => {
  assert.equal(buildKnowledgeContext([], { maxItems: 5, maxChars: 2000 }), '');
});

test('emptyKnowledgeContext tells her to admit ignorance', () => {
  assert.match(emptyKnowledgeContext(), /do not have enough information/i);
});
