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

export type SuwayomiConfig = {
  url: string;
  username: string;
  passwordFile: string;
  /** Her category. */
  shelf: string;
  /** The extension she installs, and the source name it provides. */
  extension: string;
  source: string;
  lang: string;
};

export const DEFAULT_SUWAYOMI: SuwayomiConfig = {
  url: 'http://127.0.0.1:4567',
  username: 'toomii',
  passwordFile: path.join(homedir(), 'anime-server', 'suwayomi', 'auth-password'),
  shelf: 'Haru',
  extension: 'eu.kanade.tachiyomi.extension.all.mangadex',
  source: 'MangaDex',
  lang: 'en',
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
    const find = async () => {
      const got = await this.gql<{ sources: { nodes: { id: string; name: string; lang: string }[] } }>('query { sources { nodes { id name lang } } }');
      return got.sources.nodes.find(node => node.name === this.config.source && (node.lang === this.config.lang || node.lang === 'all')) ?? got.sources.nodes.find(node => node.name === this.config.source) ?? null;
    };
    let found = await find();
    if (!found) {
      await this.gql('mutation { fetchExtensions(input: {}) { clientMutationId } }');
      await this.gql('mutation($id: String!) { updateExtension(input: { id: $id, patch: { install: true } }) { clientMutationId } }', { id: this.config.extension });
      this.log(`[suwayomi] installed the ${this.config.source} extension`);
      found = await find();
      if (!found) throw new Error(`the ${this.config.source} source did not appear after installing ${this.config.extension}`);
    }
    this.sourceId = found.id;
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

  /** Search the source by title. */
  async search(title: string): Promise<{ id: number; title: string }[]> {
    const source = await this.source();
    const got = await this.gql<{ fetchSourceManga: { mangas: { id: number; title: string }[] } }>(
      'mutation($source: LongString!, $query: String!) { fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: 1 }) { mangas { id title } } }', { source, query: title });
    return got.fetchSourceManga.mangas;
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
