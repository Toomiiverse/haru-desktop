import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown, chunkText } from '../electron/chunking';

const OPTIONS = { maxSize: 500, overlap: 60 };

test('chunkMarkdown keeps a heading at the top of its section', () => {
  const chunks = chunkMarkdown('# Server Setup\n\nThe server runs Arch Linux.\n\n## Users\n\nOnly Tommy has an account.', OPTIONS);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].content.includes('# Server Setup'));
  assert.equal(chunks[0].heading, 'Server Setup');
  assert.equal(chunks[1].heading, 'Users');
});

test('chunkMarkdown keeps a list together instead of splitting it', () => {
  const md = ['# Shopping', ''];
  for (let i = 1; i <= 10; i++) md.push(`- item number ${i} with a long enough description`);
  const chunks = chunkMarkdown(md.join('\n'), OPTIONS);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].content.includes('item number 1'));
  assert.ok(chunks[0].content.includes('item number 10'));
});

test('chunkMarkdown keeps a code block whole', () => {
  const code = '# Example\n\n```\nline one\nline two\nline three\nline four\n```\n\nAfter the fence.\n';
  const chunks = chunkMarkdown(code, OPTIONS);
  assert.ok(chunks.some(chunk => chunk.content.includes('line one') && chunk.content.includes('line four')));
});

test('chunkMarkdown splits a single oversized paragraph rather than overflowing', () => {
  const paragraph = 'word '.repeat(400).trim();
  const chunks = chunkMarkdown(`# Big\n\n${paragraph}`, { maxSize: 200, overlap: 0 });
  assert.ok(chunks.every(chunk => chunk.content.length <= 200 || chunk.content.length < 400));
  assert.ok(chunks.length > 1);
});

test('chunkMarkdown honours overlap across a long passage', () => {
  const md = '# Long\n\n' + Array.from({ length: 40 }, (_, i) => `Paragraph ${i} has enough words in it to fill up the space.`).join('\n\n');
  const chunks = chunkMarkdown(md, { maxSize: 300, overlap: 40 });
  assert.ok(chunks.length > 1);
  const first = chunks[0].content;
  const second = chunks[1].content;
  let shared = 0;
  for (let len = Math.min(first.length, second.length); len > 0; len--) {
    if (first.slice(-len) === second.slice(0, len)) { shared = len; break; }
  }
  assert.ok(shared > 10, `expected the next chunk to reuse the previous chunk's tail, got ${shared} shared chars`);
});

test('chunkText splits on blank lines', () => {
  const text = 'First paragraph of plain text.\n\nSecond paragraph, completely separate.\n\nThird paragraph here.';
  const chunks = chunkText(text, { maxSize: 40, overlap: 0 });
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].content.includes('First paragraph'));
  assert.ok(chunks[1].content.includes('Second paragraph'));
  assert.ok(chunks[2].content.includes('Third paragraph'));
});

test('chunkMarkdown ignores empty documents', () => {
  assert.deepEqual(chunkMarkdown('', OPTIONS), []);
  assert.deepEqual(chunkMarkdown('   \n\n  ', OPTIONS), []);
});
