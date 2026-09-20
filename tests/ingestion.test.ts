import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ingestFile, baseExtractors } from '../electron/ingestion';
import { emptyKnowledge, guessCategory, documentIdFor } from '../electron/knowledge';
import { stubEmbedder } from './helpers';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'haru-knowledge-'));
}

function writeDoc(dir: string, relative: string, content: string): string {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return file;
}

test('ingestFile ingests markdown with provenance metadata', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'haru/server.md', '# Server\n\nHaru\'s server currently runs Arch Linux.\n');
    const { store, outcome, chunks } = await ingestFile(emptyKnowledge(), stubEmbedder(), { file }, baseExtractors());
    assert.equal(outcome.action, 'created');
    assert.equal(chunks, 1);
    const document = store.documents[0];
    assert.equal(document.source, file);
    assert.equal(document.sourceType, 'markdown');
    assert.equal(document.category, 'haru');
    assert.equal(document.version, 1);
    assert.ok(document.hash.length > 0);
    const chunk = store.chunks[0];
    assert.equal(chunk.documentId, document.id);
    assert.equal(chunk.version, 1);
    assert.equal(chunk.embedModel, 'stub-embed');
    assert.ok(chunk.embedding.length > 0);
    assert.equal(chunk.category, 'haru');
    assert.equal(chunk.source, file);
    assert.ok(chunk.createdAt && chunk.updatedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ingesting the same file twice is a no-op, not a duplicate', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'server.md', '# Server\n\nThe server runs Arch Linux.\n');
    const first = await ingestFile(emptyKnowledge(), stubEmbedder(), { file }, baseExtractors());
    const second = await ingestFile(first.store, stubEmbedder(), { file }, baseExtractors());
    assert.equal(second.outcome.action, 'unchanged');
    assert.equal(second.store.chunks.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a changed file is re-ingested: version bumps, old chunks go stale', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'haru/server.md', '# Server\n\nThe server runs Ubuntu.\n');
    const first = await ingestFile(emptyKnowledge(), stubEmbedder(), { file }, baseExtractors());
    const oldChunkId = first.store.chunks[0].id;
    writeFileSync(file, '# Server\n\nThe server was migrated to Arch Linux.\n', 'utf8');
    const second = await ingestFile(first.store, stubEmbedder(), { file }, baseExtractors());
    assert.equal(second.outcome.action, 'updated');
    assert.equal(second.outcome.document.version, 2);
    const oldChunk = second.store.chunks.find(chunk => chunk.id === oldChunkId);
    assert.equal(oldChunk?.status, 'stale');
    assert.equal(oldChunk?.supersededBy, second.store.chunks.find(chunk => chunk.status === 'active')?.id);
    const active = second.store.chunks.filter(chunk => chunk.status === 'active');
    assert.equal(active.length, 1);
    assert.equal(active[0].version, 2);
    assert.ok(active[0].content.includes('Arch Linux'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only the version just replaced is kept as stale; older versions are dropped', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'haru/config.md', '# Config\n\nSnapshot one.\n');
    let store = (await ingestFile(emptyKnowledge(), stubEmbedder(), { file }, baseExtractors())).store;
    for (const snapshot of ['two', 'three', 'four']) {
      writeFileSync(file, `# Config\n\nSnapshot ${snapshot}.\n`, 'utf8');
      store = (await ingestFile(store, stubEmbedder(), { file }, baseExtractors())).store;
    }
    assert.deepEqual(store.chunks.map(chunk => [chunk.version, chunk.status]).sort(), [[3, 'stale'], [4, 'active']]);
    assert.ok(store.chunks.find(chunk => chunk.status === 'active')?.content.includes('four'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scanned-looking or empty file is refused', async () => {
  const dir = tempDir();
  try {
    const empty = writeDoc(dir, 'empty.txt', '   \n\n  ');
    await assert.rejects(() => ingestFile(emptyKnowledge(), stubEmbedder(), { file: empty }, baseExtractors()), /Nothing readable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('embedding failure fails the ingest rather than storing unembedded chunks', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'server.md', '# Server\n\nContent here.\n');
    const broken = {
      model: 'broken-embed',
      async embed() { throw new Error('model unreachable'); },
      async embedBatch() { throw new Error('model unreachable'); },
    };
    await assert.rejects(() => ingestFile(emptyKnowledge(), broken, { file }, baseExtractors()), /model unreachable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('json files are ingested as documents', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'config.json', '{"name": "haru", "os": "arch linux", "tier": "production"}');
    const { store, outcome } = await ingestFile(emptyKnowledge(), stubEmbedder(), { file, category: 'technical' }, baseExtractors());
    assert.equal(outcome.action, 'created');
    assert.equal(outcome.document.sourceType, 'json');
    assert.equal(outcome.document.category, 'technical');
    assert.ok(store.chunks.some(chunk => chunk.content.includes('arch linux')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown file extensions are refused', async () => {
  const dir = tempDir();
  try {
    const file = writeDoc(dir, 'photo.png', 'not really a png');
    await assert.rejects(() => ingestFile(emptyKnowledge(), stubEmbedder(), { file }, baseExtractors()), /No ingest format/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guessCategory maps source paths to categories', () => {
  assert.equal(guessCategory('haru/server.md'), 'haru');
  assert.equal(guessCategory('~/projects/app/readme.md'), 'projects');
  assert.equal(guessCategory('docs/api.md'), 'documentation');
  assert.equal(guessCategory('deploy/docker-compose.yml'), 'technical');
  assert.equal(guessCategory('personal/notes.txt'), 'personal');
  assert.equal(guessCategory('whatever/else.txt'), 'general');
});

test('documentIdFor is stable per source', () => {
  assert.equal(documentIdFor('a/b.md', 'markdown'), documentIdFor('a/b.md', 'markdown'));
  assert.notEqual(documentIdFor('a/b.md', 'markdown'), documentIdFor('a/b.md', 'text'));
});
