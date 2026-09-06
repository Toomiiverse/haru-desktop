import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cleanWikilinks,
  categoryForFolder,
  categoryForNote,
  parseFrontmatter,
  removedNotes,
  splitFrontmatter,
  syncVaultFiles,
  walkVault,
} from '../electron/obsidian';
import { deleteDocument, emptyKnowledge, type KnowledgeCategory, type KnowledgeStore } from '../electron/knowledge';
import { ingestFile, baseExtractors } from '../electron/ingestion';
import { stubEmbedder } from './helpers';

function tempVault(): string {
  return mkdtempSync(path.join(tmpdir(), 'haru-vault-'));
}

test('splitFrontmatter separates YAML from body', () => {
  const { frontmatter, body } = splitFrontmatter('---\ntags: [a, b]\n---\n# Heading\n\nBody text.');
  assert.equal(frontmatter, 'tags: [a, b]');
  assert.ok(body.includes('# Heading'));
  const plain = splitFrontmatter('# No frontmatter');
  assert.equal(plain.frontmatter, '');
  assert.equal(plain.body, '# No frontmatter');
});

test('parseFrontmatter handles scalars, quotes, numbers, booleans and lists', () => {
  const parsed = parseFrontmatter([
    'title: Server setup',
    'tags: [haru, server]',
    'type: "note"',
    'weight: 3',
    'draft: false',
    'aliases:',
    '  - server',
    '  - box',
  ].join('\n'));
  assert.equal(parsed.title, 'Server setup');
  assert.deepEqual(parsed.tags, ['haru', 'server']);
  assert.equal(parsed.type, 'note');
  assert.equal(parsed.weight, 3);
  assert.equal(parsed.draft, false);
  assert.deepEqual(parsed.aliases, ['server', 'box']);
});

test('cleanWikilinks keeps the display name or the target', () => {
  assert.equal(cleanWikilinks('See [[server.md|the server note]] here.'), 'See the server note here.');
  assert.equal(cleanWikilinks('Read [[Arch Linux]] for details.'), 'Read Arch Linux for details.');
  assert.equal(cleanWikilinks('No links at all.'), 'No links at all.');
});

test('categoryForFolder maps vault top folders to categories', () => {
  assert.equal(categoryForFolder('Projects/app.md'), 'projects');
  assert.equal(categoryForFolder('Personal/notes.md'), 'personal');
  assert.equal(categoryForFolder('Business/client.md'), 'business');
  assert.equal(categoryForFolder('Daily/2026-08-26.md'), 'conversation');
  assert.equal(categoryForFolder('Docs/api.md'), 'documentation');
  assert.equal(categoryForFolder('Misc/whatever.md'), 'general');
});

test('categoryForNote lets frontmatter override the folder', () => {
  assert.equal(categoryForNote('Projects/app.md', { category: 'business' }), 'business');
  assert.equal(categoryForNote('Projects/app.md', { type: 'personal' }), 'personal');
  assert.equal(categoryForNote('Projects/app.md', { type: 'not-a-category' }), 'projects');
  assert.equal(categoryForNote('Projects/app.md', {}), 'projects');
});

test('walkVault finds markdown, skips housekeeping, and returns relative paths', () => {
  const vault = tempVault();
  try {
    mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
    mkdirSync(path.join(vault, '.trash'), { recursive: true });
    mkdirSync(path.join(vault, 'templates'), { recursive: true });
    mkdirSync(path.join(vault, 'Projects', 'App'), { recursive: true });
    writeFileSync(path.join(vault, 'Home.md'), 'home');
    writeFileSync(path.join(vault, 'Projects', 'App', 'setup.md'), 'setup');
    writeFileSync(path.join(vault, 'Projects', 'App', 'image.png'), 'png');
    writeFileSync(path.join(vault, '.obsidian', 'workspace.json'), '{}');
    writeFileSync(path.join(vault, '.trash', 'gone.md'), 'gone');
    writeFileSync(path.join(vault, 'templates', 'note.md'), 'template');
    // Her own folder is hers, not knowledge — except the page that says how she runs.
    mkdirSync(path.join(vault, 'Haru', 'Diary'), { recursive: true });
    writeFileSync(path.join(vault, 'Haru', 'Configuration.md'), 'how she runs');
    writeFileSync(path.join(vault, 'Haru', 'Her.md'), 'her things');
    writeFileSync(path.join(vault, 'Haru', 'Diary', '2026-09-05.md'), 'dear diary');
    const files = walkVault(vault);
    const relatives = files.map(file => file.relative);
    assert.deepEqual(relatives, [path.join('Haru', 'Configuration.md'), 'Home.md', path.join('Projects', 'App', 'setup.md')]);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('removedNotes lists vault documents that are no longer on disk', () => {
  const store: KnowledgeStore = {
    documents: [
      { id: 'a', source: 'Home.md', sourceType: 'markdown', category: 'general', hash: '', version: 1, metadata: { vault: '/vault' }, status: 'active', chunkIds: [], createdAt: '', updatedAt: '' },
      { id: 'b', source: 'Projects/x.md', sourceType: 'markdown', category: 'projects', hash: '', version: 1, metadata: { vault: '/vault' }, status: 'active', chunkIds: [], createdAt: '', updatedAt: '' },
      { id: 'c', source: 'elsewhere.md', sourceType: 'markdown', category: 'general', hash: '', version: 1, metadata: {}, status: 'active', chunkIds: [], createdAt: '', updatedAt: '' },
      { id: 'd', source: 'old.md', sourceType: 'markdown', category: 'general', hash: '', version: 1, metadata: { vault: '/vault' }, status: 'stale', chunkIds: [], createdAt: '', updatedAt: '' },
    ],
    chunks: [],
  };
  assert.deepEqual(removedNotes(store, ['Home.md', 'Projects/x.md'], '/vault'), []);
  assert.deepEqual(removedNotes(store, ['Home.md'], '/vault'), ['Projects/x.md']);
  assert.deepEqual(removedNotes(store, [], '/vault'), ['Home.md', 'Projects/x.md']);
});

test('syncVaultFiles adds, updates, skips unchanged and removes deleted notes', async () => {
  const vault = tempVault();
  const embedder = stubEmbedder();
  const storeRef = { current: emptyKnowledge() };
  const ingest = async (note: { file: string; relative: string; text: string; metadata: Record<string, unknown>; category: KnowledgeCategory }) => {
    const result = await ingestFile(storeRef.current, embedder, {
      file: note.file,
      source: note.relative,
      sourceType: 'markdown',
      text: note.text,
      category: note.category,
      metadata: note.metadata,
    }, baseExtractors());
    storeRef.current = result.store;
    return result.outcome.action;
  };
  const remove = (source: string) => {
    const document = storeRef.current.documents.find(doc => doc.source === source && doc.status === 'active');
    if (document) storeRef.current = deleteDocument(storeRef.current, document.id, new Date().toISOString());
  };

  try {
    mkdirSync(path.join(vault, 'Projects'), { recursive: true });
    writeFileSync(path.join(vault, 'Home.md'), '# Home\n\nHaru runs Arch Linux.\n');
    writeFileSync(path.join(vault, 'Projects', 'app.md'), '# App\n\nBuilt with Electron.\n');

    const first = await syncVaultFiles(vault, { store: storeRef.current, ingest, remove });
    assert.equal(first.files, 2);
    assert.equal(first.added, 2);
    assert.equal(first.removed, 0);
    assert.equal(storeRef.current.documents.length, 2);
    assert.ok(storeRef.current.chunks.some(chunk => chunk.content.includes('Arch Linux')));
    assert.equal(storeRef.current.chunks.find(chunk => chunk.source === 'Home.md')?.category, 'general');
    assert.equal(storeRef.current.chunks.find(chunk => chunk.source === path.join('Projects', 'app.md'))?.category, 'projects');

    const second = await syncVaultFiles(vault, { store: storeRef.current, ingest, remove });
    assert.equal(second.added, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 2);
    assert.equal(storeRef.current.chunks.length, 2, 'no duplicate chunks after a no-op sync');

    writeFileSync(path.join(vault, 'Home.md'), '# Home\n\nHaru switched to Fedora.\n');
    const third = await syncVaultFiles(vault, { store: storeRef.current, ingest, remove });
    assert.equal(third.updated, 1);
    assert.equal(third.unchanged, 1);
    const home = storeRef.current.documents.find(doc => doc.source === 'Home.md');
    assert.equal(home?.version, 2);
    assert.ok(storeRef.current.chunks.filter(chunk => chunk.source === 'Home.md' && chunk.status === 'stale').length >= 1);

    rmSync(path.join(vault, 'Projects'), { recursive: true, force: true });
    const fourth = await syncVaultFiles(vault, { store: storeRef.current, ingest, remove });
    assert.equal(fourth.removed, 1);
    assert.equal(storeRef.current.documents.find(doc => doc.source === path.join('Projects', 'app.md'))?.status, 'deleted');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
