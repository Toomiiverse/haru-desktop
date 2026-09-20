// Watching with her: the three servers behind one ask, and the choices made
// between them. The servers are faked at the fetch, so what is tested is the
// path each answer takes — on the server it plays, off it fetches, two shows
// with one name is a question, a fetch that squeezes the disk waits for the
// word — and that nothing is claimed that did not happen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimeLink, apiKeyFrom, matchTitle, pickRelease, playersWhere, rateRelease, readAnimeConfig, sameShow, type Fetch, type ProwlarrRelease, type Want } from '../electron/anime';
import { chatTools, runChatTool, watchRelevant, type ToolAvailability } from '../electron/tools';
import { deedFrom } from '../electron/deeds';

test('config falls back to the stack on this box, and keeps what is set', () => {
  const plain = readAnimeConfig(undefined);
  assert.equal(plain.enabled, false);
  assert.equal(plain.sonarr.url, 'http://127.0.0.1:8989');
  assert.match(plain.sonarr.apiKeyFile, /anime-server\/sonarr\/config\/config\.xml$/);
  assert.equal(plain.keepFreeGb, 50);
  const set = readAnimeConfig({ enabled: true, sonarr: { url: 'http://sonarr:8989/' }, keepFreeGb: 20, linkUrl: 'http://100.1.2.3:8096/' });
  assert.equal(set.enabled, true);
  assert.equal(set.sonarr.url, 'http://sonarr:8989');
  assert.equal(set.keepFreeGb, 20);
  assert.equal(set.linkUrl, 'http://100.1.2.3:8096');
});

test('the key comes out of a Servarr config.xml, and a missing file is empty rather than an error', () => {
  assert.equal(apiKeyFrom('/x', () => '<Config><ApiKey>abc123</ApiKey></Config>'), 'abc123');
  assert.equal(apiKeyFrom('/nowhere/config.xml'), '');
});

test('the exact title wins, one prefix is taken, two prefixes are a question', () => {
  const shows = [{ title: 'Naruto' }, { title: 'Naruto Shippuden' }, { title: 'Boruto: Naruto Next Generations' }];
  assert.deepEqual(matchTitle('naruto', shows), { one: { title: 'Naruto' } });
  assert.deepEqual(matchTitle('Naruto Ship', shows), { one: { title: 'Naruto Shippuden' } });
  const several = matchTitle('Made', [{ title: 'Made in Abyss' }, { title: 'Made in Heaven' }]);
  assert.ok(several && 'several' in several && several.several.length === 2);
  assert.equal(matchTitle('Bleach', shows), null);
});

const want: Want = { title: 'Naruto', absolute: 1, season: 1, freeGb: 189, keepFreeGb: 50 };
const release = (over: Partial<ProwlarrRelease>): ProwlarrRelease => ({ guid: 'g', indexerId: 1, title: 'x', size: 60 * 2 ** 30, seeders: 100, ...over });
const parsed = (formats: string[], absolutes: number[] = Array.from({ length: 220 }, (_, i) => i + 1), seriesTitle = 'Naruto') =>
  ({ parsedEpisodeInfo: { seriesTitle, absoluteEpisodeNumbers: absolutes, seasonNumber: 0 }, customFormats: formats.map(name => ({ name })) });

test('the show Sonarr read out of the title must be this one, pack words aside', () => {
  assert.equal(sameShow('Naruto Complete', 'Naruto'), true);
  assert.equal(sameShow('Naruto (Complete Series)', 'Naruto'), true);
  assert.equal(sameShow('Naruto Shippuden', 'Naruto'), false);
  assert.equal(sameShow('One Piece', 'Naruto'), false);
  assert.equal(sameShow(undefined, 'Naruto'), null);
  assert.equal(rateRelease(release({ title: '[Naruto-Kun.Hu] One Piece - 1177' }), parsed([], [1], 'One Piece'), want).why, 'another show');
  assert.equal(rateRelease(release({ title: 'Naruto Shippuden (001-500)' }), parsed([], [1], 'Naruto Shippuden'), want).why, 'another show');
  assert.ok(rateRelease(release({ title: '[Anime Time] Naruto Complete (001-220)' }), parsed([], undefined, 'Naruto Complete'), want).ok);
});

test('AV1, foreign subtitles, raws and packs without the episode are out; a low-quality group only costs points', () => {
  assert.equal(rateRelease(release({ title: '[X] Naruto (001-220) AV1' }), parsed(['AV1']), want).why, 'AV1');
  assert.equal(rateRelease(release({ title: 'Naruto 001-220 Czech SUB' }), parsed([]), want).why, 'foreign subtitles');
  assert.equal(rateRelease(release({ title: '[Naruto-Kun.Hu] Naruto - 130 [1080p]' }), parsed([], [130]), want).why, 'foreign subtitles');
  assert.equal(rateRelease(release({ title: 'raw' }), parsed(['Anime Raws']), want).why, 'Anime Raws');
  assert.equal(rateRelease(release({ title: 'later' }), parsed([], [130]), want).why, 'does not hold episode 1');
  assert.equal(rateRelease(release({ seeders: 1 }), parsed([]), want).why, 'no seeders');
  const lq = rateRelease(release({ title: '[Anime Time] Naruto Complete' }), parsed(['Anime LQ Groups', 'Anime Dual Audio']), want);
  assert.ok(lq.ok && lq.score > 0);
  const tier = rateRelease(release({ title: '[Good] Naruto' }), parsed(['Anime BD Tier 02']), want);
  assert.ok(tier.score > lq.score, 'a tiered group still beats a low-quality one when both fit');
});

test('a whole series beats one episode, and a pack that squeezes the disk waits for the word', () => {
  const pack = rateRelease(release({ title: 'pack' }), parsed([]), want);
  const single = rateRelease(release({ title: 'single', size: 2 ** 28, seeders: 300 }), parsed([], [1]), want);
  assert.equal(pickRelease([single, pack])?.pick.release.title, 'pack');
  const huge = rateRelease(release({ title: 'huge', size: 170 * 2 ** 30 }), parsed([]), want);
  assert.equal(huge.fits, false);
  assert.equal(huge.squeezes, true);
  const picked = pickRelease([huge, single]);
  assert.equal(picked?.pick.release.title, 'single', 'the small one that leaves the room is taken over the big one that does not');
  const onlyHuge = pickRelease([huge]);
  assert.equal(onlyHuge?.needsWord, true);
  const tooBig = rateRelease(release({ title: 'too big', size: 300 * 2 ** 30 }), parsed([]), want);
  assert.equal(pickRelease([tooBig]), null);
});

// -- the link against faked servers -------------------------------------------

type Route = (url: URL, init?: { method?: string; body?: string }) => unknown;

function link(routes: Record<string, Route>, calls: string[] = [], fetches: Fetch[] = []) {
  const fetcher = async (url: string, init?: { method?: string; body?: string }) => {
    const parsed = new URL(url);
    const key = `${init?.method ?? 'GET'} ${parsed.pathname}`;
    calls.push(key);
    const route = routes[key] ?? routes[parsed.pathname];
    if (!route) return new Response('', { status: 404 });
    const body = route(parsed, init);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status: 200 });
  };
  return new AnimeLink(
    readAnimeConfig({ enabled: true, keepFreeGb: 50 }),
    { jellyfinUrl: 'http://jf', jellyfinUserId: 'u1', jellyfinKey: 'k', sonarrKey: 's', prowlarrKey: 'p' },
    fetcher,
    { fetches: () => fetches, keep: fetch => { fetches.push(fetch); } },
  );
}

const episode = { Id: 'e2', Name: 'Capital of the Unreturned', ParentIndexNumber: 2, IndexNumber: 2 };

test('on the server with a player open: the next episode is started there', async () => {
  const calls: string[] = [];
  const stack = link({
    '/Items': url => (url.searchParams.get('SearchTerm') ? { Items: [{ Id: 's1', Name: 'Made in Abyss' }] } : { Items: [] }),
    '/Shows/NextUp': () => ({ Items: [episode] }),
    '/Sessions': () => [
      { Id: 'haru', Client: 'Haru', DeviceId: 'haru-desktop', SupportsRemoteControl: true, LastActivityDate: '2026-09-18T01:00:00Z' },
      { Id: 'chrome', Client: 'Jellyfin Web', DeviceName: 'Chrome', SupportsRemoteControl: true, LastActivityDate: '2026-09-18T00:50:00Z' },
    ],
    'POST /Sessions/chrome/Playing': () => undefined,
    '/System/Info': () => ({ Id: 'srv' }),
  }, calls);
  const result = await stack.watch({ title: 'made in abyss' });
  assert.equal(result.outcome, 'playing');
  assert.equal(result.episode, 'S2E2 "Capital of the Unreturned"');
  assert.equal(result.on, 'Chrome');
  assert.ok(calls.includes('POST /Sessions/chrome/Playing'), 'the play command went to his player, not hers');
});

test('"on my phone" goes to the phone, not the PC that was used last; no phone open means the link and the reason', async () => {
  const chrome = { Id: 'chrome', Client: 'Jellyfin Web', DeviceName: 'Chrome', SupportsRemoteControl: true, LastActivityDate: '2026-09-18T01:00:00Z' };
  const phone = { Id: 'phone', Client: 'Jellyfin Web', DeviceName: 'Mobile Safari', SupportsRemoteControl: true, LastActivityDate: '2026-09-18T00:50:00Z' };
  const swiftfin = { Id: 'sf', Client: 'Swiftfin iOS', DeviceName: 'iPhone', SupportsRemoteControl: true, LastActivityDate: '2026-09-18T00:40:00Z' };
  assert.deepEqual(playersWhere([chrome, phone, swiftfin], 'my phone').map(p => p.Id), ['phone', 'sf']);
  assert.deepEqual(playersWhere([chrome, phone, swiftfin], 'desk').map(p => p.Id), ['chrome']);
  assert.deepEqual(playersWhere([chrome, phone, swiftfin], 'tv').map(p => p.Id), []);
  assert.deepEqual(playersWhere([chrome, phone, swiftfin], 'iphone').map(p => p.Id), ['phone', 'sf'], 'a kind of device, not a name');
  assert.deepEqual(playersWhere([chrome, phone, swiftfin], 'safari').map(p => p.Id), ['phone'], 'a name');
  assert.deepEqual(playersWhere([chrome, phone], undefined).map(p => p.Id), ['chrome', 'phone']);
  const calls: string[] = [];
  const routes = {
    '/Items': () => ({ Items: [{ Id: 's1', Name: 'Made in Abyss' }] }),
    '/Shows/NextUp': () => ({ Items: [episode] }),
    '/Sessions': () => [chrome, phone],
    'POST /Sessions/phone/Playing': () => undefined,
    '/System/Info': () => ({ Id: 'srv' }),
  };
  const played = await link(routes, calls).watch({ title: 'Made in Abyss', where: 'phone' });
  assert.equal(played.outcome, 'playing');
  assert.equal(played.on, 'Mobile Safari');
  assert.ok(calls.includes('POST /Sessions/phone/Playing') && !calls.includes('POST /Sessions/chrome/Playing'));
  const none = await link({ ...routes, '/Sessions': () => [chrome] }, []).watch({ title: 'Made in Abyss', where: 'phone' });
  assert.equal(none.outcome, 'ready');
  assert.match(String(none.note), /Nothing on their phone has Jellyfin open \(open right now: Chrome\)/);
  assert.deepEqual(none.openElsewhere, ['Chrome']);
});

test('on the server with nothing open: the link, and no claim of playing', async () => {
  const calls: string[] = [];
  const stack = link({
    '/Items': () => ({ Items: [{ Id: 's1', Name: 'Made in Abyss' }] }),
    '/Shows/NextUp': () => ({ Items: [episode] }),
    '/Sessions': () => [],
    '/System/Info': () => ({ Id: 'srv' }),
  }, calls);
  const result = await stack.watch({ title: 'Made in Abyss' });
  assert.equal(result.outcome, 'ready');
  assert.equal(result.link, 'http://jf/web/#/details?id=e2&serverId=srv');
  assert.ok(!calls.some(call => call.includes('/Playing')));
});

const naruto = { title: 'Naruto', tvdbId: 78857, year: 2002 };
const packTitle = '[Anime Time] Naruto Complete (001-220 + Movies) [BD] [Dual Audio][1080p][HEVC 10bit x265][AAC][Eng Sub] [Batch]';

function fetchRoutes(over: Record<string, Route> = {}): Record<string, Route> {
  return {
    '/Items': () => ({ Items: [] }),
    '/api/v3/series': (_url, init) => (init?.method === 'POST' ? { id: 2, title: 'Naruto', tvdbId: 78857, monitored: true } : []),
    '/api/v3/series/lookup': () => [naruto, { title: 'Naruto Shippuden', tvdbId: 79824 }, { title: 'Raruto', tvdbId: 1 }],
    '/api/v3/episode': () => Array.from({ length: 220 }, (_, i) => ({ id: 100 + i, seasonNumber: 1 + Math.floor(i / 50), episodeNumber: 1 + (i % 50), absoluteEpisodeNumber: i + 1, hasFile: false })),
    '/api/v3/rootfolder': () => [{ path: '/data/media/anime', freeSpace: 189 * 2 ** 30 }],
    '/api/v1/search': (_url, init) => (init?.method === 'POST' ? undefined : [
      { guid: 'hu', indexerId: 1, title: '[Naruto-Kun.Hu] Naruto - 130 [1080p].mkv', size: 2 ** 28, seeders: 256 },
      { guid: 'pack', indexerId: 1, title: packTitle, size: 65 * 2 ** 30, seeders: 657, infoHash: 'ABCDEF' },
      { guid: 'av1', indexerId: 1, title: '[X] Naruto (001-220) AV1', size: 30 * 2 ** 30, seeders: 900 },
    ]),
    '/api/v3/parse': url => {
      const title = url.searchParams.get('title') ?? '';
      if (title.includes('AV1')) return { parsedEpisodeInfo: { seriesTitle: 'Naruto', absoluteEpisodeNumbers: [1, 2, 3] }, customFormats: [{ name: 'AV1' }] };
      if (title.includes('130')) return { parsedEpisodeInfo: { seriesTitle: 'Naruto', absoluteEpisodeNumbers: [130] }, customFormats: [] };
      return { parsedEpisodeInfo: { seriesTitle: 'Naruto Complete', absoluteEpisodeNumbers: Array.from({ length: 220 }, (_, i) => i + 1) }, customFormats: [{ name: 'Anime LQ Groups' }, { name: 'Anime Dual Audio' }] };
    },
    '/api/v3/queue': () => ({ records: [] }),
    '/api/v3/qualityprofile': () => [{ id: 4, name: 'HD-1080p' }, { id: 7, name: '[Anime] Remux-1080p' }],
    ...over,
  };
}

test('not on the server: added to Sonarr as anime under the anime profile, the pack picked over the AV1 and the Hungarian single, and grabbed through Prowlarr', async () => {
  const calls: string[] = [];
  const fetches: Fetch[] = [];
  let added: Record<string, unknown> | null = null;
  const stack = link(fetchRoutes({
    '/api/v3/series': (_url, init) => {
      if (init?.method !== 'POST') return [];
      added = JSON.parse(init.body ?? '{}');
      return { id: 2, title: 'Naruto', tvdbId: 78857, monitored: true };
    },
  }), calls, fetches);
  const result = await stack.watch({ title: 'Naruto' });
  assert.equal(result.outcome, 'fetching');
  assert.equal(result.release, packTitle);
  assert.equal(result.episodes, 220);
  assert.equal(result.sizeGb, 65);
  assert.equal(added!.seriesType, 'anime');
  assert.equal(added!.qualityProfileId, 7);
  assert.equal(added!.rootFolderPath, '/data/media/anime');
  assert.deepEqual(added!.addOptions, { monitor: 'all', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false });
  assert.ok(calls.includes('POST /api/v1/search'), 'the grab went through Prowlarr');
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].infoHash, 'abcdef');
  assert.equal(fetches[0].seriesId, 2);
});

test('two shows fit the name: a question, nothing added, nothing grabbed', async () => {
  const calls: string[] = [];
  const stack = link(fetchRoutes({
    '/api/v3/series/lookup': () => [{ title: 'Made in Abyss', tvdbId: 1 }, { title: 'Made in Heaven', tvdbId: 2 }],
  }), calls);
  const result = await stack.watch({ title: 'Made' });
  assert.equal(result.outcome, 'which');
  assert.equal(result.ok, false);
  assert.equal((result.choices as unknown[]).length, 2);
  assert.ok(!calls.includes('POST /api/v3/series'));
  assert.ok(!calls.includes('POST /api/v1/search'));
});

test('the pick squeezes the disk: their word first, then the grab', async () => {
  const calls: string[] = [];
  const stack = link(fetchRoutes({
    '/api/v3/rootfolder': () => [{ path: '/data/media/anime', freeSpace: 100 * 2 ** 30 }],
  }), calls);
  const asked = await stack.watch({ title: 'Naruto' });
  assert.equal(asked.outcome, 'needs-word');
  assert.equal(asked.confirm, true);
  assert.equal(asked.ok, false);
  assert.equal(asked.sizeGb, 65);
  assert.ok(!calls.includes('POST /api/v1/search'));
  const done = await stack.watch({ title: 'Naruto', confirm: true });
  assert.equal(done.outcome, 'fetching');
  assert.ok(calls.includes('POST /api/v1/search'));
});

test('a 500-episode pack is 500 queue rows: every page is read and they fold to one line per download', async () => {
  const pages: number[] = [];
  const rows = (n: number, downloadId: string, title: string) => Array.from({ length: n }, (_, i) => ({ title, downloadId, seriesId: 3, size: 56 * 2 ** 30, sizeleft: 50 * 2 ** 30, episodeId: i }));
  const all = [...rows(500, 'DE2F', 'Shippuden pack'), { title: 'Naruto pack', downloadId: '58D9', size: 65 * 2 ** 30, sizeleft: 60 * 2 ** 30 }];
  const stack = link({
    '/api/v3/queue': url => {
      const page = Number(url.searchParams.get('page') ?? 1);
      pages.push(page);
      return { totalRecords: all.length, records: all.slice((page - 1) * 500, page * 500) };
    },
  });
  const lines = await stack.queue();
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(lines.map(line => line.downloadId), ['DE2F', '58D9']);
  assert.equal(Math.round(await stack.inFlightGb()), 110, 'what is still coming, once per download, not once per episode');
});

test('what is still downloading counts against the space for the next fetch', async () => {
  const stack = link(fetchRoutes({
    '/api/v3/rootfolder': () => [{ path: '/data/media/anime', freeSpace: 150 * 2 ** 30 }],
    '/api/v3/queue': () => ({ totalRecords: 1, records: [{ title: 'Other pack', downloadId: 'AAAA', seriesId: 9, size: 60 * 2 ** 30, sizeleft: 55 * 2 ** 30 }] }),
  }));
  const asked = await stack.watch({ title: 'Naruto' });
  assert.equal(asked.outcome, 'needs-word', '150 free less 55 in flight is 95, and a 65 GB pack would leave less than 50');
  assert.equal(asked.freeGb, 95);
});

test('already on its way: the progress, and no second grab', async () => {
  const calls: string[] = [];
  const stack = link(fetchRoutes({
    '/api/v3/series': () => [{ id: 2, title: 'Naruto', tvdbId: 78857, monitored: true, statistics: { episodeFileCount: 0 } }],
    '/api/v3/queue': () => ({ records: [{ title: packTitle, size: 65 * 2 ** 30, sizeleft: 13 * 2 ** 30, timeleft: '00:40:00', downloadId: 'ABCDEF', trackedDownloadState: 'downloading' }] }),
  }), calls, [{ title: 'Naruto', seriesId: 2, tvdbId: 78857, release: packTitle, infoHash: 'abcdef', sizeBytes: 0, episodes: 220, grabbedAt: '2026-09-18T01:00:00Z' }]);
  const result = await stack.watch({ title: 'Naruto' });
  assert.equal(result.outcome, 'downloading');
  assert.equal(result.percent, 80);
  assert.equal(result.timeLeft, '00:40:00');
  assert.ok(!calls.includes('POST /api/v1/search'));
  const status = await stack.status('naruto');
  assert.equal(status.outcome, 'downloading');
  assert.equal(status.leftGb, 13);
});

// -- the tool around it ---------------------------------------------------------

const NOTHING: ToolAvailability = {
  choices: false, journal: false, anilist: false, web: false,
  search: { enabled: false, readPages: false, transcripts: false },
  knowledge: false, browser: false, claude: false, system: { enabled: false, level: 0 },
  hands: false, desktop: { launch: false, power: false }, knockedAwake: false, minecraft: false,
};

test('the tool is on the table when the stack is wired up and the message is about watching, hands or not', () => {
  const names = (available: ToolAvailability, said?: string) => chatTools(available, said).map(tool => tool.function.name);
  assert.ok(!names(NOTHING).includes('watch_anime'));
  assert.ok(names({ ...NOTHING, anime: true }).includes('watch_anime'));
  assert.ok(names({ ...NOTHING, anime: true, web: true }, "let's watch some naruto").includes('watch_anime'));
  assert.ok(!names({ ...NOTHING, anime: true }, 'how was your day').includes('watch_anime'));
  assert.ok(watchRelevant('put the next episode on'));
  assert.ok(watchRelevant('can you get Naruto downloaded'));
  assert.ok(watchRelevant('open it on my phone'));
  assert.ok(watchRelevant('can you put that on the tv'));
  assert.ok(!watchRelevant('what did you have for lunch'));
});

test('called without the stack, the handler says so rather than pretending', async () => {
  const result = JSON.parse(await runChatTool(
    { id: 'c1', function: { name: 'watch_anime', arguments: { title: 'Naruto' } } },
    "let's watch naruto",
    // Only what the handler touches; the rest is never reached.
    { anime: null, onWeb: () => false } as never,
  ));
  assert.match(result.error, /not wired up/);
});

test('putting it on or fetching it is a deed; asking how it is going is not', () => {
  assert.match(deedFrom('watch_anime', { title: 'Naruto' }, false, '2026-09-18T01:00:00Z')?.what ?? '', /"Naruto"/);
  assert.equal(deedFrom('watch_anime', { title: 'Naruto', action: 'status' }, false, '2026-09-18T01:00:00Z'), null);
  assert.equal(deedFrom('watch_anime', { title: 'Naruto' }, true, '2026-09-18T01:00:00Z'), null);
});
