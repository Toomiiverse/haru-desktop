import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchWebPicture, WEB_PICTURE_MAX_BYTES } from '../electron/web-picture';
import { createTurnContext } from '../electron/turncontext';
import { appendPhoneTurn } from '../electron/core-brain-history';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const fake = (status: number, type: string, body: Buffer) => (async () => new Response(new Uint8Array(body), { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

test('a web picture is saved beside her drawings with its type as the extension', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'haru-pictures-'));
  const made = await fetchWebPicture('https://m.media-amazon.com/images/M/MV5B.jpg', 'https://www.imdb.com/title/tt1/', folder, fake(200, 'image/jpeg; charset=binary', png));
  assert.equal(made.mime, 'image/jpeg');
  assert.deepEqual(readdirSync(folder), [`${made.id}.jpg`]);
  assert.deepEqual(readFileSync(made.file), png);
  assert.equal(made.source, 'https://www.imdb.com/title/tt1/');
});

test('not an image, not https, too large and errors are refused without writing', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'haru-pictures-'));
  await assert.rejects(fetchWebPicture('http://x.test/a.jpg', 's', folder, fake(200, 'image/jpeg', png)), /https_required/);
  await assert.rejects(fetchWebPicture('https://x.test/a', 's', folder, fake(200, 'text/html', Buffer.from('<html>'))), /not_an_image/);
  await assert.rejects(fetchWebPicture('https://x.test/a', 's', folder, fake(404, 'image/png', png)), /web_picture_404/);
  await assert.rejects(fetchWebPicture('https://x.test/a', 's', folder, fake(200, 'image/png', Buffer.alloc(WEB_PICTURE_MAX_BYTES + 1))), /too_large/);
  assert.equal(readdirSync(folder).length, 0);
});

test('pictures attached during a turn ride on her saved reply, not his message', () => {
  const turn = createTurnContext({ web: true });
  turn.rememberSearch('odd taxi', [{ title: 'IMDb', url: 'https://www.imdb.com/t/', snippet: 's', image: 'https://m.media-amazon.com/p.jpg' }]);
  assert.equal(turn.lastResults()[0].image, 'https://m.media-amazon.com/p.jpg');
  const record = { id: 'p1', kind: 'image', name: 'a picture from imdb.com', saved: '/x/p1.jpg', bytes: 7, source: 'https://www.imdb.com/t/' };
  turn.attachPicture(record);
  const history = appendPhoneTurn([], { text: 'show me', reply: 'Here.', ignored: false, herAttachments: turn.pictures() }, 'id1', '2026-10-12T06:00:00.000Z');
  assert.equal(history.length, 2);
  assert.equal('attachments' in history[0], false);
  assert.deepEqual(history[1].attachments, [record]);
  assert.equal(createTurnContext().pictures().length, 0);
});

test('a retried reply carries her attachments too', () => {
  const record = { id: 'p2', kind: 'image', name: 'a picture from imdb.com', saved: '/x/p2.jpg', bytes: 7, source: 'https://www.imdb.com/t/' };
  const first = appendPhoneTurn([], { text: 'show me', reply: 'Here.', ignored: false }, 'id1', '2026-10-12T06:00:00.000Z');
  const again = appendPhoneTurn(first, { text: 'show me', reply: 'Again.', ignored: false, retry: true, herAttachments: [record] }, 'id2', '2026-10-12T06:01:00.000Z');
  assert.equal(again.length, 2);
  assert.deepEqual(again[1].attachments, [record]);
});
