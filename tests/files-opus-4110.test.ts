// 4110: a scanned PDF's first pages are rendered to JPEGs for the picture reader; the attachment loop reads them like video frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreRenderPdfPages } from '../electron/core-attachment-files';
test('the first pages of a scanned PDF render to JPEGs no wider than 1536 px', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-4110-'));
  const files = await coreRenderPdfPages(path.resolve(__dirname, '../../tests/fixtures/scanned-4110.pdf'), 4, dir);
  assert.equal(files.length, 2, 'only the pages that exist');
  for (const f of files) {
    const b = fs.readFileSync(f);
    assert.ok(b.toString('base64').startsWith('/9j/') && b.length > 5000, 'a JPEG with something on it');
    const width = b.readUInt16BE(b.indexOf(Buffer.from([0xff, 0xc0])) + 7);
    assert.ok(width <= 1536 && width > 1000, 'scaled to fit');
  }
});
test('the attachment loop handles pdf-pages and the adapter renders with the scratch dir', async () => {
  const src = fs.readFileSync(require.resolve('../../electron/core-attachments.ts'), 'utf8');
  assert.ok(src.includes("case 'pdf-pages':frames=await adapter.pdfPages(a.saved,command.count);temporary.push(...frames);"));
  const main = fs.readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes('pdfPages:(file:string,count:number)=>coreRenderPdfPages(file,count,scratchDir()),'));
});
