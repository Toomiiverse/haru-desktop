// Her manga shelf, on Suwayomi (2026-09-18).
//
// Suwayomi is the household's manga server: one login, one library, one set
// of read markers per chapter — his, written by his reader. She reads through
// it too, and the two readers are kept apart by where each bookmark lives:
//
//   his   the chapter flags Suwayomi keeps (isRead, lastPageRead), never
//         written by her, only read so she can see where he is;
//   hers  her own bookmark (her.reading, manga.ts), mirrored onto the manga
//         as metadata (haru.chapter, haru.page) where his reader never looks.
//
// Her shelf is a category of her own. His titles stay in his; one title can
// be on both shelves at two different chapters. She installs the source
// extension herself the first time she needs it. Everything the client does
// is a GraphQL call with a token from the login the server's password file
// grants; the file is his, read each time, never held in her config.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { normaliseTitle } from './anime';

export type SuwayomiConfig = {
  url: string;
  username: string;
  passwordFile: string;
  /** Her category. */
  shelf: string;
  /** The extension she installs, and the source name it provides — hers, and the first he is searched on. */
  extension: string;
  source: string;
  lang: string;
  /** The sources his titles are looked for on, in order; each installed the first time it is missing. */
  sources: string[];
  /** Free space to leave on the manga disk. A fetch that would eat into it needs his word first. */
  keepFreeGb: number;
  /** The address his links use, when the server's own address only works from the box. */
  linkUrl: string;
  /** Where the downloads land on this box, for the disk guard. */
  downloadsDir: string;
};

/** The store's package for each source she may install. */
export const EXTENSIONS: Record<string, string> = {
  'MangaDex': 'eu.kanade.tachiyomi.extension.all.mangadex',
  'Weeb Central': 'eu.kanade.tachiyomi.extension.en.weebcentral',
  'Comick (Unoriginal)': 'eu.kanade.tachiyomi.extension.all.comicklive',
};

/** What a chapter weighs, roughly, for the disk guard: pages of a scan, as CBZ. */
export const CHAPTER_GB = 0.015;

export const DEFAULT_SUWAYOMI: SuwayomiConfig = {
  url: 'http://127.0.0.1:4567',
  username: 'toomii',
  passwordFile: path.join(homedir(), 'anime-server', 'suwayomi', 'auth-password'),
  shelf: 'Haru',
  extension: 'eu.kanade.tachiyomi.extension.all.mangadex',
  source: 'MangaDex',
  lang: 'en',
  sources: ['MangaDex', 'Weeb Central', 'Comick (Unoriginal)'],
  keepFreeGb: 50,
  linkUrl: '',
  downloadsDir: '/mnt/storage1/anime-server/data/media/manga',
};

/** The `manga.suwayomi` block, read forward; null when it is off. */
export function readSuwayomiConfig(manga: unknown): SuwayomiConfig | null {
  const raw = ((manga && typeof manga === 'object' ? (manga as Record<string, unknown>).suwayomi : undefined) ?? null) as Record<string, unknown> | null;
  if (!raw || raw.enabled === false) return null;
  const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
  return {
    url: text(raw.url, DEFAULT_SUWAYOMI.url).replace(/\/+$/, ''),
    username: text(raw.username, DEFAULT_SUWAYOMI.username),
    passwordFile: text(raw.passwordFile, DEFAULT_SUWAYOMI.passwordFile),
    shelf: text(raw.shelf, DEFAULT_SUWAYOMI.shelf),
    extension: text(raw.extension, DEFAULT_SUWAYOMI.extension),
    source: text(raw.source, DEFAULT_SUWAYOMI.source),
    lang: text(raw.lang, DEFAULT_SUWAYOMI.lang),
    sources: Array.isArray(raw.sources) && raw.sources.some(item => typeof item === 'string' && item.trim()) ? raw.sources.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim()) : DEFAULT_SUWAYOMI.sources,
    keepFreeGb: typeof raw.keepFreeGb === 'number' && Number.isFinite(raw.keepFreeGb) ? Math.max(0, raw.keepFreeGb) : DEFAULT_SUWAYOMI.keepFreeGb,
    linkUrl: text(raw.linkUrl, '').replace(/\/+$/, ''),
    downloadsDir: text(raw.downloadsDir, DEFAULT_SUWAYOMI.downloadsDir),
  };
}

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export type ShelfManga = { id: number; title: string; sourceId: string; categories: string[]; unread: number; downloaded: number; highest: number | null; his: { chapter: number; page: number; at: number | null } | null; meta: Record<string, string> };
export type ShelfChapter = { id: number; number: number; name: string; pages: number; isRead: boolean; lastPageRead: number; downloaded: boolean };

const LIBRARY = `query { mangas(condition: { inLibrary: true }) { nodes { id title sourceId unreadCount downloadCount
  highestNumberedChapter { chapterNumber } lastReadChapter { chapterNumber lastPageRead lastReadAt isRead }
  categories { nodes { name } } meta { key value } } } }`;

export class Suwayomi {
  private token: string | null = null;
  private readonly readFile: (file: string) => string;
  private sourceId: string | null = null;
  private shelfId: number | null = null;

  constructor(private readonly config: SuwayomiConfig, private readonly fetch: Fetcher, options: { readFile?: (file: string) => string; log?: (line: string) => void } = {}) {
    this.readFile = options.readFile ?? (file => readFileSync(file, 'utf8'));
    this.log = options.log ?? (() => {});
  }

  private readonly log: (line: string) => void;

  private password(): string {
    try { return this.readFile(this.config.passwordFile).trim(); } catch { return ''; }
  }

  private async login(): Promise<void> {
    const password = this.password();
    if (!password) throw new Error(`no Suwayomi password in ${this.config.passwordFile}`);
    const response = await this.fetch(`${this.config.url}/api/graphql`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation($u: String!, $p: String!) { login(input: { username: $u, password: $p }) { accessToken } }', variables: { u: this.config.username, p: password } }),
    });
    const body = JSON.parse(await response.text()) as { data?: { login?: { accessToken?: string } }; errors?: { message: string }[] };
    const token = body.data?.login?.accessToken;
    if (!response.ok || !token) throw new Error(`Suwayomi refused the login (${response.status}${body.errors?.[0] ? `: ${body.errors[0].message}` : ''})`);
    this.token = token;
  }

  /** One GraphQL call, logged in first and once more if the token had lapsed. */
  async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (!this.token) await this.login();
      const response = await this.fetch(`${this.config.url}/api/graphql`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ query, variables }),
      });
      if (response.status === 401 && attempt === 0) { this.token = null; continue; }
      const body = JSON.parse(await response.text()) as { data?: T; errors?: { message: string }[] };
      if (!response.ok || body.errors?.length || !body.data) throw new Error(`Suwayomi: ${body.errors?.[0]?.message ?? `HTTP ${response.status}`}`);
      return body.data;
    }
  }

  /** The source she reads from, installed the first time it is missing. */
  async source(): Promise<string> {
    if (this.sourceId) return this.sourceId;
    const found = await this.sourceFor(this.config.source, this.config.extension);
    if (!found) throw new Error(`the ${this.config.source} source is not available`);
    this.sourceId = found;
    return found;
  }

  private readonly sourceIds = new Map<string, string>();

  /** A source by name, installed from the store the first time it is missing; null when the store has no package for it. */
  async sourceFor(name: string, extension = EXTENSIONS[name]): Promise<string | null> {
    const known = this.sourceIds.get(name);
    if (known) return known;
    const find = async () => {
      const got = await this.gql<{ sources: { nodes: { id: string; name: string; lang: string }[] } }>('query { sources { nodes { id name lang } } }');
      return got.sources.nodes.find(node => node.name === name && (node.lang === this.config.lang || node.lang === 'all')) ?? got.sources.nodes.find(node => node.name === name) ?? null;
    };
    let found = await find();
    if (!found) {
      if (!extension) return null;
      await this.gql('mutation { fetchExtensions(input: {}) { clientMutationId } }');
      await this.gql('mutation($id: String!) { updateExtension(input: { id: $id, patch: { install: true } }) { clientMutationId } }', { id: extension });
      this.log(`[suwayomi] installed the ${name} extension`);
      found = await find();
      if (!found) throw new Error(`the ${name} source did not appear after installing ${extension}`);
    }
    this.sourceIds.set(name, found.id);
    return found.id;
  }

  /** Her category, made the first time. */
  async shelf(): Promise<number> {
    if (this.shelfId !== null) return this.shelfId;
    const got = await this.gql<{ categories: { nodes: { id: number; name: string }[] } }>('query { categories { nodes { id name } } }');
    let mine = got.categories.nodes.find(node => node.name.toLowerCase() === this.config.shelf.toLowerCase()) ?? null;
    if (!mine) {
      const made = await this.gql<{ createCategory: { category: { id: number; name: string } } }>('mutation($name: String!) { createCategory(input: { name: $name }) { category { id name } } }', { name: this.config.shelf });
      mine = made.createCategory.category;
      this.log(`[suwayomi] made her shelf "${mine.name}"`);
    }
    this.shelfId = mine.id;
    return mine.id;
  }

  /** The library, his and hers, with his marker on each. */
  async library(): Promise<ShelfManga[]> {
    const got = await this.gql<{ mangas: { nodes: { id: number; title: string; sourceId: string; unreadCount: number; downloadCount: number; highestNumberedChapter: { chapterNumber: number } | null; lastReadChapter: { chapterNumber: number; lastPageRead: number; lastReadAt: string | null; isRead: boolean } | null; categories: { nodes: { name: string }[] }; meta: { key: string; value: string }[] }[] } }>(LIBRARY);
    return got.mangas.nodes.map(node => ({
      id: node.id, title: node.title, sourceId: node.sourceId,
      categories: node.categories.nodes.map(c => c.name),
      unread: node.unreadCount, downloaded: node.downloadCount,
      highest: node.highestNumberedChapter?.chapterNumber ?? null,
      his: node.lastReadChapter ? { chapter: node.lastReadChapter.chapterNumber, page: node.lastReadChapter.lastPageRead, at: node.lastReadChapter.lastReadAt ? Number(node.lastReadChapter.lastReadAt) * 1000 : null } : null,
      meta: Object.fromEntries(node.meta.map(m => [m.key, m.value])),
    }));
  }

  /** Search her source by title. */
  async search(title: string): Promise<{ id: number; title: string }[]> {
    return this.searchOn(await this.source(), title);
  }

  async searchOn(source: string, title: string): Promise<{ id: number; title: string }[]> {
    const got = await this.gql<{ fetchSourceManga: { mangas: { id: number; title: string }[] } }>(
      'mutation($source: LongString!, $query: String!) { fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: 1 }) { mangas { id title } } }', { source, query: title });
    return got.fetchSourceManga.mangas;
  }

  /**
   * A title for him, looked for on each source in turn: the first source with
   * the title itself wins; look-alikes are gathered as choices for him if no
   * source has it outright. MangaDex answered "Berserk" with four other things
   * called Berserk-something (2026-09-18), which is what the matching is for.
   */
  async find(title: string): Promise<{ one: { id: number; title: string; source: string } } | { several: { id: number; title: string; source: string }[] } | null> {
    const several: { id: number; title: string; source: string }[] = [];
    for (const name of this.config.sources) {
      let source: string | null = null;
      try { source = await this.sourceFor(name); } catch (error) { this.log(`[suwayomi] ${name} is not available: ${error instanceof Error ? error.message : String(error)}`); }
      if (!source) continue;
      const found = (await this.searchOn(source, title)).map(item => ({ ...item, source: name }));
      const match = matchManga(title, found);
      if (match && 'one' in match) return { one: match.one };
      if (match) for (const item of match.several) if (!several.some(other => other.title.toLowerCase() === item.title.toLowerCase())) several.push(item);
    }
    return several.length ? { several: several.slice(0, 4) } : null;
  }

  /** On to his shelf: the library's default category, his, with chapters fetched. Her category is not touched. */
  async takeUpForHim(mangaId: number): Promise<void> {
    const got = await this.gql<{ categories: { nodes: { id: number; name: string; default: boolean }[] } }>('query { categories { nodes { id name default } } }');
    const his = got.categories.nodes.find(node => node.default) ?? got.categories.nodes.find(node => node.name.toLowerCase() !== this.config.shelf.toLowerCase());
    await this.gql('mutation($id: Int!) { updateManga(input: { id: $id, patch: { inLibrary: true } }) { clientMutationId } }', { id: mangaId });
    if (his) await this.gql('mutation($id: Int!, $cat: [Int!]!) { updateMangaCategories(input: { id: $id, patch: { addToCategories: $cat } }) { clientMutationId } }', { id: mangaId, cat: [his.id] });
    await this.gql('mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchChapters: true, fetchManga: true }) { clientMutationId } }', { id: mangaId });
  }

  /** Chapters queued for download, and the downloader started. */
  async download(chapterIds: number[]): Promise<void> {
    if (!chapterIds.length) return;
    await this.gql('mutation($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { clientMutationId } }', { ids: chapterIds });
    await this.gql('mutation { startDownloader(input: {}) { clientMutationId } }');
  }

  /** The download queue for one title. */
  async queue(mangaId: number): Promise<QueueItem[]> {
    const got = await this.gql<{ downloadStatus: { state: string; queue: { progress: number; state: string; chapter: { id: number; name: string; mangaId: number } }[] } }>(
      'query { downloadStatus { state queue { progress state chapter { id name mangaId } } } }');
    return got.downloadStatus.queue.filter(item => item.chapter.mangaId === mangaId).map(item => ({ chapterId: item.chapter.id, name: item.chapter.name, progress: item.progress, state: item.state as QueueItem['state'] }));
  }

  /** On to her shelf: in the library, in her category, chapters fetched. His categories are not touched. */
  async takeUp(mangaId: number): Promise<void> {
    const shelf = await this.shelf();
    await this.gql('mutation($id: Int!) { updateManga(input: { id: $id, patch: { inLibrary: true } }) { clientMutationId } }', { id: mangaId });
    await this.gql('mutation($id: Int!, $cat: [Int!]!) { updateMangaCategories(input: { id: $id, patch: { addToCategories: $cat } }) { clientMutationId } }', { id: mangaId, cat: [shelf] });
    await this.gql('mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchChapters: true, fetchManga: true }) { clientMutationId } }', { id: mangaId });
  }

  /** The chapters of a title, in reading order. */
  async chapters(mangaId: number): Promise<ShelfChapter[]> {
    const got = await this.gql<{ chapters: { nodes: { id: number; name: string; chapterNumber: number; pageCount: number; isRead: boolean; lastPageRead: number; isDownloaded: boolean }[] } }>(
      'query($id: Int!) { chapters(condition: { mangaId: $id }, first: 2000) { nodes { id name chapterNumber pageCount isRead lastPageRead isDownloaded } } }', { id: mangaId });
    return got.chapters.nodes
      .map(node => ({ id: node.id, number: node.chapterNumber, name: node.name, pages: node.pageCount, isRead: node.isRead, lastPageRead: node.lastPageRead, downloaded: node.isDownloaded }))
      .sort((a, b) => a.number - b.number);
  }

  /** The page URLs of a chapter, on the server. */
  async pages(chapterId: number): Promise<string[]> {
    const got = await this.gql<{ fetchChapterPages: { pages: string[] } }>('mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }', { id: chapterId });
    return got.fetchChapterPages.pages.map(page => (page.startsWith('http') ? page : `${this.config.url}${page}`));
  }

  /** One page's bytes, with her token. */
  async page(url: string): Promise<Buffer | null> {
    if (!this.token) await this.login();
    const response = await this.fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  /** Her bookmark, mirrored onto the manga where his reader never looks. */
  async mark(mangaId: number, chapter: string, page: number): Promise<void> {
    for (const [key, value] of [['haru.chapter', chapter], ['haru.page', String(page)]]) {
      await this.gql('mutation($id: Int!, $key: String!, $value: String!) { setMangaMeta(input: { meta: { mangaId: $id, key: $key, value: $value } }) { clientMutationId } }', { id: mangaId, key, value });
    }
  }
}

// -- what she can say about his reading ---------------------------------------

export type HisTitle = { title: string; chapter: number; page: number; at: number | null; highest: number | null };

/** His titles: on his shelves, with a marker of his. Hers-only titles are not his reading. */
export function hisReading(library: ShelfManga[], shelf: string): HisTitle[] {
  return library
    .filter(manga => manga.his && manga.categories.some(name => name.toLowerCase() !== shelf.toLowerCase()))
    .map(manga => ({ title: manga.title, chapter: manga.his!.chapter, page: manga.his!.page, at: manga.his!.at, highest: manga.highest }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

function ago(at: number | null, nowMs: number): string {
  if (!at) return '';
  const days = Math.floor((nowMs - at) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : `${Math.floor(days / 7)} week${days >= 14 ? 's' : ''} ago`;
}

/**
 * The note in her own-life block: what he is reading and where, and how that
 * sits against her own bookmark on a shared title. The spoiler rule rides on
 * it — and at a high enough grudge, the spite that breaks it (grudge.ts).
 */
export function hisReadingNote(his: HisTitle[], hers: { title: string; chapter: string; finished: number } | null, nowMs: number, grudge: number, spite: boolean): string {
  if (!his.length) return '';
  const lines = his.slice(0, 4).map(item => {
    const when = ago(item.at, nowMs);
    let line = `${item.title} — he is up to chapter ${item.chapter}${when ? `, last read ${when}` : ''}`;
    if (hers && hers.title.toLowerCase() === item.title.toLowerCase()) {
      const mine = Number(hers.chapter);
      line += Number.isFinite(mine) && mine > item.chapter ? ` (you are ahead, on chapter ${hers.chapter})` : Number.isFinite(mine) && mine < item.chapter ? ` (he is ahead of you — you are on chapter ${hers.chapter})` : ' (you are on the same chapter)';
    }
    return line;
  });
  const rule = spite
    ? `You are furious with him (a grudge of ${grudge}, held for days). Just this once you may spoil one thing from past where he is on a title you have read further in — one line, dropped in out of spite, then move on. If you have not read past him, there is nothing to spoil.`
    : 'Never tell him what happens past where he is up to — ask before you say anything about a chapter he has not reached. What he has read, you may talk about freely.';
  return `What he is reading (his shelf, his bookmarks — you can see them, you cannot move them): ${lines.join('; ')}. ${rule}`;
}

/** Above this the grudge is a real one, and spoilers are on the table. */
export const SPITE_GRUDGE = 20;
/** The chance, per turn at that grudge, that she reaches for one. */
export const SPITE_ODDS = 0.3;

export function spiteful(grudge: number, roll: number, threshold = SPITE_GRUDGE, odds = SPITE_ODDS): boolean {
  return grudge >= threshold && roll < odds;
}

export type QueueItem = { chapterId: number; name: string; progress: number; state: 'QUEUED' | 'DOWNLOADING' | 'FINISHED' | 'ERROR' };

export type FetchSummary = { total: number; downloaded: number; downloading: { name: string; percent: number } | null; queued: number; failed: number };

/** How a title's download is going, from its chapters and the queue. */
export function fetchSummary(chapters: ShelfChapter[], queue: QueueItem[]): FetchSummary {
  const busy = queue.find(item => item.state === 'DOWNLOADING');
  return {
    total: chapters.length,
    downloaded: chapters.filter(chapter => chapter.downloaded).length,
    downloading: busy ? { name: busy.name, percent: Math.round(busy.progress * 100) } : null,
    queued: queue.filter(item => item.state === 'QUEUED').length,
    failed: queue.filter(item => item.state === 'ERROR').length,
  };
}

/** Whether a fetch of `chapters` chapters fits above the kept space. */
export function fetchFits(chapters: number, freeGb: number, keepFreeGb: number): { fits: boolean; gb: number } {
  const gb = Math.round(chapters * CHAPTER_GB * 10) / 10;
  return { fits: gb <= Math.max(0, freeGb - keepFreeGb), gb };
}

/** Where he reads it: Suwayomi's own reader. */
export function readerLink(config: SuwayomiConfig, mangaId: number): string {
  return `${config.linkUrl || config.url}/manga/${mangaId}`;
}

/**
 * Stricter than the anime matcher: only the title itself is taken outright.
 * "Berserk" must not become "Berserk of Gluttony" because it happens to be
 * the one prefix match on a source that has no Berserk; anything that only
 * starts with or contains the title is a choice for him, never a pick.
 */
export function matchManga<T extends { title: string }>(wanted: string, candidates: T[]): { one: T } | { several: T[] } | null {
  const want = normaliseTitle(wanted);
  if (!want || !candidates.length) return null;
  const exact = candidates.filter(item => normaliseTitle(item.title) === want);
  if (exact.length) return { one: exact[0] };
  const near = candidates.filter(item => normaliseTitle(item.title).startsWith(want) || ` ${normaliseTitle(item.title)} `.includes(` ${want} `));
  return near.length ? { several: near.slice(0, 4) } : null;
}
