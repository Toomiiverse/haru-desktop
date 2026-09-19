// Her shelf on Suwayomi through a fake server: the login, the source she installs, her category, and what she may say about his reading.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Suwayomi, SPITE_GRUDGE, fetchFits, fetchSummary, hisReading, hisReadingNote, matchManga, onHisShelf, readerLink, readSuwayomiConfig, spiteful, type Fetcher, type ShelfManga } from '../electron/suwayomi';

function fake() {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let installed = false;
  let weeb = false;
  let shelfMade = false;
  let logins = 0;
  const respond = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(4) });
  const fetch: Fetcher = async (url, init) => {
    if (!url.endsWith('/api/graphql')) return init?.headers?.Authorization === 'Bearer tok' ? { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : respond(401, {});
    const { query, variables } = JSON.parse(init?.body ?? '{}') as { query: string; variables: Record<string, unknown> };
    calls.push({ query, variables });
    if (query.includes('login(')) { logins++; return variables.p === 'pw' ? respond(200, { data: { login: { accessToken: 'tok' } } }) : respond(401, { errors: [{ message: 'bad' }] }); }
    if (init?.headers?.Authorization !== 'Bearer tok') return respond(401, {});
    if (query.startsWith('query { sources')) return respond(200, { data: { sources: { nodes: [...(installed ? [{ id: '2499283573021220255', name: 'MangaDex', lang: 'en' }] : []), ...(weeb ? [{ id: '77', name: 'Weeb Central', lang: 'en' }] : []), { id: '0', name: 'Local source', lang: 'localsourcelang' }] } } });
    if (query.includes('updateExtension')) { if (variables.id === 'eu.kanade.tachiyomi.extension.en.weebcentral') weeb = true; else installed = true; return respond(200, { data: { updateExtension: { clientMutationId: null } } }); }
    if (query.includes('fetchExtensions')) return respond(200, { data: { fetchExtensions: { clientMutationId: null } } });
    if (query.startsWith('query { categories')) return respond(200, { data: { categories: { nodes: [{ id: 0, name: 'Default', default: true }, ...(shelfMade ? [{ id: 7, name: 'Haru', default: false }] : [])] } } });
    if (query.includes('createCategory')) { shelfMade = true; return respond(200, { data: { createCategory: { category: { id: 7, name: 'Haru' } } } }); }
    if (query.includes('fetchSourceManga')) {
      if (variables.source === '77') return respond(200, { data: { fetchSourceManga: { mangas: variables.query === 'Berserk' ? [{ id: 90, title: 'Berserk' }] : [] } } });
      if (variables.query === 'Berserk') return respond(200, { data: { fetchSourceManga: { mangas: [{ id: 11, title: 'Berserk of Gluttony' }, { id: 12, title: "The Berserker's Second Playthrough" }] } } });
      return respond(200, { data: { fetchSourceManga: { mangas: [{ id: 42, title: 'Chainsaw Man' }] } } });
    }
    if (query.includes('enqueueChapterDownloads') || query.includes('startDownloader')) return respond(200, { data: { x: { clientMutationId: null } } });
    if (query.includes('downloadStatus')) return respond(200, { data: { downloadStatus: { state: 'STARTED', queue: [{ progress: 0.4, state: 'DOWNLOADING', chapter: { id: 3, name: 'Ch. 2', mangaId: 42 } }, { progress: 0, state: 'QUEUED', chapter: { id: 4, name: 'Ch. 3', mangaId: 42 } }, { progress: 0, state: 'QUEUED', chapter: { id: 99, name: 'x', mangaId: 1 } }] } } });
    if (query.includes('updateManga(') || query.includes('updateMangaCategories') || query.includes('fetchMangaAndChapters') || query.includes('setMangaMeta')) return respond(200, { data: { x: { clientMutationId: null } } });
    if (query.includes('chapters(condition')) return respond(200, { data: { chapters: { nodes: [{ id: 3, name: 'Ch. 2', chapterNumber: 2, pageCount: 20, isRead: false, lastPageRead: 0, isDownloaded: false }, { id: 2, name: 'Ch. 1', chapterNumber: 1, pageCount: 19, isRead: true, lastPageRead: 19, isDownloaded: true }] } } });
    if (query.includes('fetchChapterPages')) return respond(200, { data: { fetchChapterPages: { pages: ['/api/v1/manga/42/chapter/1/page/0', '/api/v1/manga/42/chapter/1/page/1'] } } });
    if (query.includes('mangas(condition')) return respond(200, { data: { mangas: { nodes: [
      { id: 42, title: 'Chainsaw Man', sourceId: '1', unreadCount: 3, downloadCount: 1, highestNumberedChapter: { chapterNumber: 190 }, lastReadChapter: null, categories: { nodes: [{ name: 'Haru' }] }, meta: [{ key: 'haru.chapter', value: '2' }] },
      { id: 43, title: 'Berserk', sourceId: '1', unreadCount: 300, downloadCount: 0, highestNumberedChapter: { chapterNumber: 375 }, lastReadChapter: { chapterNumber: 3, lastPageRead: 12, lastReadAt: '1789600000', isRead: false }, categories: { nodes: [{ name: 'Default' }] }, meta: [] },
    ] } } });
    return respond(400, { errors: [{ message: `unexpected: ${query.slice(0, 40)}` }] });
  };
  const client = new Suwayomi({ url: 'http://s:4567', username: 'toomii', passwordFile: '/pw', shelf: 'Haru', extension: 'eu.kanade.tachiyomi.extension.all.mangadex', source: 'MangaDex', lang: 'en', sources: ['MangaDex', 'Weeb Central', 'Comick (Unoriginal)'], keepFreeGb: 50, linkUrl: 'http://100.1.2.3:4567', downloadsDir: '/tmp' }, fetch, { readFile: () => 'pw\n' });
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
  // Suwayomi's Default category is implicit: Berserk fetched for him came back with no category at all (2026-09-18).
  assert.equal(onHisShelf({ categories: [] }, 'Haru'), true);
  assert.equal(onHisShelf({ categories: ['Haru'] }, 'Haru'), false);
  assert.equal(onHisShelf({ categories: ['Haru', 'Default'] }, 'Haru'), true);
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
  assert.match(spite, /furious with him \(a grudge held for days/);
  assert.match(spite, /spoil one thing from past where he is/);
  assert.equal(hisReadingNote([], null, Date.now(), 0, false), '');
  assert.equal(spiteful(SPITE_GRUDGE, 0.1), true);
  assert.equal(spiteful(SPITE_GRUDGE, 0.9), false);
  assert.equal(spiteful(SPITE_GRUDGE - 1, 0.0), false);
});

test('a wrong password is an error, and a lapsed token logs in again once', async () => {
  const { client } = fake();
  const wrong = new Suwayomi({ url: 'http://s:4567', username: 'toomii', passwordFile: '/pw', shelf: 'Haru', extension: 'x', source: 'MangaDex', lang: 'en', sources: ['MangaDex'], keepFreeGb: 50, linkUrl: '', downloadsDir: '/tmp' }, (client as unknown as { fetch: Fetcher }).fetch, { readFile: () => 'nope' });
  await assert.rejects(() => wrong.library(), /refused the login/);
});


test('a title for him is found on the first source that has it outright, installing the next source on the way; look-alikes are choices', async () => {
  const { client, calls } = fake();
  const found = await client.find('Berserk');
  assert.deepEqual(found, { one: { id: 90, title: 'Berserk', source: 'Weeb Central' } });
  assert.ok(calls.some(c => c.query.includes('updateExtension') && c.variables.id === 'eu.kanade.tachiyomi.extension.en.weebcentral'), 'Weeb Central was installed when MangaDex had only look-alikes');
  assert.deepEqual(await client.find('Chainsaw Man'), { one: { id: 42, title: 'Chainsaw Man', source: 'MangaDex' } });
  assert.equal(await client.find('Zzz Nothing'), null);
  assert.deepEqual(matchManga('Berserk', [{ title: 'Berserk of Gluttony' }, { title: 'REAL PLAY: BERSERKER' }]), { several: [{ title: 'Berserk of Gluttony' }] });
  assert.deepEqual(matchManga('berserk', [{ title: 'Berserk of Gluttony' }, { title: 'Berserk' }]), { one: { title: 'Berserk' } });
});

test('his shelf is the default category, downloads queue and start, and the summary reads the queue', async () => {
  const { client, calls } = fake();
  await client.takeUpForHim(42);
  assert.deepEqual(calls.find(c => c.query.includes('updateMangaCategories'))!.variables, { id: 42, cat: [0] });
  await client.download([2, 3, 4]);
  assert.deepEqual(calls.find(c => c.query.includes('enqueueChapterDownloads'))!.variables, { ids: [2, 3, 4] });
  assert.ok(calls.some(c => c.query.includes('startDownloader')));
  const queue = await client.queue(42);
  assert.equal(queue.length, 2, 'only this title');
  const summary = fetchSummary(await client.chapters(42), queue);
  assert.deepEqual(summary, { total: 2, downloaded: 1, downloading: { name: 'Ch. 2', percent: 40 }, queued: 1, failed: 0 });
  assert.deepEqual(fetchFits(375, 617, 50), { fits: true, gb: 5.6 });
  assert.deepEqual(fetchFits(375, 54, 50), { fits: false, gb: 5.6 });
  assert.equal(readerLink({ ...client['config'], linkUrl: 'http://100.1.2.3:4567' }, 42), 'http://100.1.2.3:4567/manga/42');
});
