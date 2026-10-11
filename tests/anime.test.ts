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

test('the key comes out of a Servarr config.xml, and a missing file is empty rather than an error', () => {
  assert.equal(apiKeyFrom('/x', () => '<Config><ApiKey>abc123</ApiKey></Config>'), 'abc123');
  assert.equal(apiKeyFrom('/nowhere/config.xml'), '');
});

const want: Want = { title: 'Naruto', absolute: 1, season: 1, freeGb: 189, keepFreeGb: 50 };
const release = (over: Partial<ProwlarrRelease>): ProwlarrRelease => ({ guid: 'g', indexerId: 1, title: 'x', size: 60 * 2 ** 30, seeders: 100, ...over });
const parsed = (formats: string[], absolutes: number[] = Array.from({ length: 220 }, (_, i) => i + 1), seriesTitle = 'Naruto') =>
  ({ parsedEpisodeInfo: { seriesTitle, absoluteEpisodeNumbers: absolutes, seasonNumber: 0 }, customFormats: formats.map(name => ({ name })) });

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

// -- the tool around it ---------------------------------------------------------

const NOTHING: ToolAvailability = {
  choices: false, journal: false, anilist: false, web: false,
  search: { enabled: false, readPages: false, transcripts: false },
  knowledge: false, browser: false, claude: false, system: { enabled: false, level: 0 },
  hands: false, desktop: { launch: false, power: false }, knockedAwake: false, minecraft: false,
};
