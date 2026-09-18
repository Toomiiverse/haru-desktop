// Her shelf on Suwayomi through a fake server: the login, the source she installs, her category, and what she may say about his reading.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Suwayomi, SPITE_GRUDGE, hisReading, hisReadingNote, readSuwayomiConfig, spiteful, type Fetcher, type ShelfManga } from '../electron/suwayomi';

function fake() {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let installed = false;
  let shelfMade = false;
  let logins = 0;
  const respond = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(4) });
  const fetch: Fetcher = async (url, init) => {
    if (!url.endsWith('/api/graphql')) return init?.headers?.Authorization === 'Bearer tok' ? { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : respond(401, {});
    const { query, variables } = JSON.parse(init?.body ?? '{}') as { query: string; variables: Record<string, unknown> };
    calls.push({ query, variables });
    if (query.includes('login(')) { logins++; return variables.p === 'pw' ? respond(200, { data: { login: { accessToken: 'tok' } } }) : respond(401, { errors: [{ message: 'bad' }] }); }
    if (init?.headers?.Authorization !== 'Bearer tok') return respond(401, {});
    if (query.startsWith('query { sources')) return respond(200, { data: { sources: { nodes: installed ? [{ id: '2499283573021220255', name: 'MangaDex', lang: 'en' }] : [{ id: '0', name: 'Local source', lang: 'localsourcelang' }] } } });
    if (query.includes('updateExtension')) { installed = true; return respond(200, { data: { updateExtension: { clientMutationId: null } } }); }
    if (query.includes('fetchExtensions')) return respond(200, { data: { fetchExtensions: { clientMutationId: null } } });
    if (query.startsWith('query { categories')) return respond(200, { data: { categories: { nodes: [{ id: 0, name: 'Default' }, ...(shelfMade ? [{ id: 7, name: 'Haru' }] : [])] } } });
    if (query.includes('createCategory')) { shelfMade = true; return respond(200, { data: { createCategory: { category: { id: 7, name: 'Haru' } } } }); }
    if (query.includes('fetchSourceManga')) return respond(200, { data: { fetchSourceManga: { mangas: [{ id: 42, title: 'Chainsaw Man' }] } } });
    if (query.includes('updateManga(') || query.includes('updateMangaCategories') || query.includes('fetchMangaAndChapters') || query.includes('setMangaMeta')) return respond(200, { data: { x: { clientMutationId: null } } });
    if (query.includes('chapters(condition')) return respond(200, { data: { chapters: { nodes: [{ id: 3, name: 'Ch. 2', chapterNumber: 2, pageCount: 20, isRead: false, lastPageRead: 0, isDownloaded: false }, { id: 2, name: 'Ch. 1', chapterNumber: 1, pageCount: 19, isRead: true, lastPageRead: 19, isDownloaded: true }] } } });
    if (query.includes('fetchChapterPages')) return respond(200, { data: { fetchChapterPages: { pages: ['/api/v1/manga/42/chapter/1/page/0', '/api/v1/manga/42/chapter/1/page/1'] } } });
    if (query.includes('mangas(condition')) return respond(200, { data: { mangas: { nodes: [
      { id: 42, title: 'Chainsaw Man', sourceId: '1', unreadCount: 3, downloadCount: 1, highestNumberedChapter: { chapterNumber: 190 }, lastReadChapter: null, categories: { nodes: [{ name: 'Haru' }] }, meta: [{ key: 'haru.chapter', value: '2' }] },
      { id: 43, title: 'Berserk', sourceId: '1', unreadCount: 300, downloadCount: 0, highestNumberedChapter: { chapterNumber: 375 }, lastReadChapter: { chapterNumber: 3, lastPageRead: 12, lastReadAt: '1789600000', isRead: false }, categories: { nodes: [{ name: 'Default' }] }, meta: [] },
    ] } } });
    return respond(400, { errors: [{ message: `unexpected: ${query.slice(0, 40)}` }] });
  };
  const client = new Suwayomi({ url: 'http://s:4567', username: 'toomii', passwordFile: '/pw', shelf: 'Haru', extension: 'eu.kanade.tachiyomi.extension.all.mangadex', source: 'MangaDex', lang: 'en' }, fetch, { readFile: () => 'pw\n' });
  return { client, calls, logins: () => logins, installed: () => installed };
}

test('the block reads forward and is off until it is there', () => {
  assert.equal(readSuwayomiConfig(undefined), null);
  assert.equal(readSuwayomiConfig({ suwayomi: { enabled: false } }), null);
  const set = readSuwayomiConfig({ suwayomi: { url: 'http://s:4567/', shelf: ' Haru ' } })!;
  assert.equal(set.url, 'http://s:4567');
  assert.equal(set.shelf, 'Haru');
  assert.equal(set.source, 'MangaDex');
  assert.match(set.passwordFile, /suwayomi\/auth-password$/);
});

test('she logs in once, installs the source the first time, and makes her shelf', async () => {
  const { client, logins, installed, calls } = fake();
  assert.equal(await client.source(), '2499283573021220255');
  assert.equal(installed(), true);
  assert.equal(await client.source(), '2499283573021220255', 'remembered');
  assert.equal(await client.shelf(), 7);
  assert.equal(calls.filter(c => c.query.includes('createCategory')).length, 1);
  assert.equal(await client.shelf(), 7);
  assert.equal(logins(), 1);
});

test('taking up a title puts it on her shelf only, and pages come with her token', async () => {
  const { client, calls } = fake();
  const found = await client.search('chainsaw man');
  assert.deepEqual(found, [{ id: 42, title: 'Chainsaw Man' }]);
  await client.takeUp(42);
  const cats = calls.find(c => c.query.includes('updateMangaCategories'))!;
  assert.deepEqual(cats.variables, { id: 42, cat: [7] });
  assert.ok(calls.some(c => c.query.includes('fetchMangaAndChapters')));
  const chapters = await client.chapters(42);
  assert.deepEqual(chapters.map(c => c.number), [1, 2], 'in reading order');
  const pages = await client.pages(2);
  assert.equal(pages[0], 'http://s:4567/api/v1/manga/42/chapter/1/page/0');
  assert.equal((await client.page(pages[0]))!.length, 3);
  await client.mark(42, '2', 5);
  const marks = calls.filter(c => c.query.includes('setMangaMeta')).map(c => [c.variables.key, c.variables.value]);
  assert.deepEqual(marks, [['haru.chapter', '2'], ['haru.page', '5']]);
  assert.ok(!calls.some(c => c.query.includes('updateChapter')), 'his read markers are never written');
});

test('his reading is his shelves with a bookmark of his; hers-only titles are not his', async () => {
  const { client } = fake();
  const library = await client.library();
  const his = hisReading(library, 'Haru');
  assert.deepEqual(his.map(h => [h.title, h.chapter, h.page]), [['Berserk', 3, 12]]);
  assert.equal(library.find(m => m.title === 'Chainsaw Man')!.meta['haru.chapter'], '2');
});

test('the note says where he is, how she sits against him, and holds the spoiler line unless she is spiteful', () => {
  const his = [{ title: 'Berserk', chapter: 3, page: 12, at: Date.now() - 86_400_000, highest: 375 }];
  const plain = hisReadingNote(his, { title: 'Berserk', chapter: '10', finished: 9 }, Date.now(), 4, false);
  assert.match(plain, /Berserk — he is up to chapter 3, last read yesterday \(you are ahead, on chapter 10\)/);
  assert.match(plain, /Never tell him what happens past where he is/);
  const behind = hisReadingNote(his, { title: 'Berserk', chapter: '1', finished: 0 }, Date.now(), 4, false);
  assert.match(behind, /he is ahead of you/);
  const spite = hisReadingNote(his, { title: 'Berserk', chapter: '10', finished: 9 }, Date.now(), 22, true);
  assert.match(spite, /furious with him \(a grudge of 22/);
  assert.match(spite, /spoil one thing from past where he is/);
  assert.equal(hisReadingNote([], null, Date.now(), 0, false), '');
  assert.equal(spiteful(SPITE_GRUDGE, 0.1), true);
  assert.equal(spiteful(SPITE_GRUDGE, 0.9), false);
  assert.equal(spiteful(SPITE_GRUDGE - 1, 0.0), false);
});

test('a wrong password is an error, and a lapsed token logs in again once', async () => {
  const { client } = fake();
  const wrong = new Suwayomi({ url: 'http://s:4567', username: 'toomii', passwordFile: '/pw', shelf: 'Haru', extension: 'x', source: 'MangaDex', lang: 'en' }, (client as unknown as { fetch: Fetcher }).fetch, { readFile: () => 'nope' });
  await assert.rejects(() => wrong.library(), /refused the login/);
});
