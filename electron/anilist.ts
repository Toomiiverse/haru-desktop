// What she knows about anime and manga.
//
// AniList rather than a directory of reading sites: this is the catalogue, and
// it is also where progress actually lives — the reading sites themselves nearly
// all advertise syncing to it, because none of them is a record you would trust
// to still exist next year.
//
// No key, no account, no OAuth. Public queries are open, and a public profile's
// list is readable by name alone, so the whole integration costs the user one
// username typed into a box. Writing back would need OAuth; reading does not,
// and reading is what makes her know you rather than know anime.

/** The two halves of the catalogue. Kept apart because "did you finish it" means
 *  episodes for one and chapters for the other. */
export type MediaKind = 'ANIME' | 'MANGA';

export type Media = {
  title: string;
  altTitle?: string;
  kind: MediaKind;
  format?: string;
  status?: string;
  /** Episodes for anime, chapters for manga — whichever this one counts in. */
  units?: number;
  volumes?: number;
  year?: number;
  score?: number;
  genres: string[];
  /** Studio for anime, author for manga. */
  by?: string;
  summary?: string;
};

/** One row of somebody's list: what they are on and how far in. */
export type ListEntry = { title: string; kind: MediaKind; status: string; progress: number; total?: number; score?: number };

export type AniListConfig = {
  enabled: boolean;
  /** Their AniList username. Empty means lookups still work and the list does not. */
  username: string;
};

export const DEFAULT_ANILIST: AniListConfig = { enabled: false, username: '' };

export function readAniListConfig(saved: unknown): AniListConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_ANILIST;
  const record = saved as Partial<AniListConfig>;
  return {
    enabled: record.enabled === true,
    username: typeof record.username === 'string' ? record.username.trim() : '',
  };
}

const ENDPOINT = 'https://graphql.anilist.co';
const REQUEST_TIMEOUT_MS = 10_000;

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

/**
 * AniList answers a 200 with an `errors` array for things like an unknown user,
 * so a bad username looks exactly like a good one until the body is read. The
 * status is checked second, not first.
 */
async function query<T>(document: string, variables: Record<string, unknown>, fetchImpl: Fetcher): Promise<T> {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null) as { data?: T; errors?: { message?: string }[] } | null;
  const complaint = payload?.errors?.[0]?.message;
  if (complaint) throw new Error(complaint);
  if (!response.ok) throw new Error(`AniList returned ${response.status}`);
  if (!payload?.data) throw new Error('AniList sent back nothing usable.');
  return payload.data;
}

const MEDIA_FIELDS = `
  title { romaji english }
  format status episodes chapters volumes
  startDate { year }
  averageScore genres
  studios(isMain: true) { nodes { name } }
  staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
  description(asHtml: false)
`;

type RawMedia = {
  title?: { romaji?: string; english?: string };
  format?: string; status?: string;
  episodes?: number; chapters?: number; volumes?: number;
  startDate?: { year?: number };
  averageScore?: number; genres?: string[];
  studios?: { nodes?: { name?: string }[] };
  staff?: { edges?: { role?: string; node?: { name?: { full?: string } } }[] };
  description?: string;
};

/**
 * The description is written for a website: HTML breaks, and often several
 * paragraphs of plot. Cut to the first couple of sentences, because she is
 * meant to know what a thing is, not recite its back cover.
 */
function tidySummary(description?: string) {
  if (!description) return undefined;
  const flat = description.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  // Cut at a sentence end near 300 characters rather than mid-clause.
  if (flat.length <= 300) return flat || undefined;
  const cut = flat.slice(0, 300);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > 120 ? cut.slice(0, stop + 1) : cut) + (stop > 120 ? '' : '…');
}

/**
 * Who made it. For manga the useful credit is the author, and AniList files that
 * under staff with a role of "Story & Art" — the first staff entry is not it,
 * because assistants are listed too and sort above nobody in particular.
 */
function creditFor(raw: RawMedia, kind: MediaKind) {
  if (kind === 'ANIME') return raw.studios?.nodes?.[0]?.name;
  const edges = raw.staff?.edges ?? [];
  const authored = edges.find(edge => /story|art/i.test(edge.role ?? '') && !/assistant/i.test(edge.role ?? ''));
  return (authored ?? edges[0])?.node?.name?.full;
}

function toMedia(raw: RawMedia, kind: MediaKind): Media {
  const romaji = raw.title?.romaji?.trim();
  const english = raw.title?.english?.trim();
  return {
    title: english || romaji || 'Untitled',
    // Kept only when it genuinely differs, so she can recognise whichever name
    // the user says without repeating the same words back at them.
    altTitle: english && romaji && english.toLowerCase() !== romaji.toLowerCase() ? romaji : undefined,
    kind,
    format: raw.format ?? undefined,
    status: raw.status ?? undefined,
    units: (kind === 'ANIME' ? raw.episodes : raw.chapters) ?? undefined,
    volumes: raw.volumes ?? undefined,
    year: raw.startDate?.year ?? undefined,
    score: raw.averageScore ?? undefined,
    genres: raw.genres ?? [],
    by: creditFor(raw, kind),
    summary: tidySummary(raw.description),
  };
}

/**
 * One title. `kind` is optional because people do not always say which they
 * mean; without it both are searched and the better match wins, preferring
 * whichever actually exists.
 */
export async function lookUp(search: string, kind: MediaKind | undefined, fetchImpl: Fetcher): Promise<Media | null> {
  const wanted = search.trim();
  if (!wanted) throw new Error('There was nothing to look up.');
  const kinds: MediaKind[] = kind ? [kind] : ['ANIME', 'MANGA'];
  const found: Media[] = [];
  for (const type of kinds) {
    try {
      const data = await query<{ Media: RawMedia | null }>(
        `query($s: String, $t: MediaType) { Media(search: $s, type: $t, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }`,
        { s: wanted, t: type }, fetchImpl);
      if (data.Media) found.push(toMedia(data.Media, type));
    } catch (error) {
      // "Not Found" for one type is not a failure when the other may have it.
      if (!/not found/i.test(error instanceof Error ? error.message : '')) throw error;
    }
  }
  if (!found.length) return null;
  // With both to choose from, prefer the one that has actually finished being
  // counted — a series with a chapter count is the real entry, and the other is
  // usually an adaptation stub.
  return found.sort((a, b) => (b.units ?? 0) - (a.units ?? 0))[0];
}

type RawList = { lists?: { entries?: { status?: string; progress?: number; score?: number; media?: RawMedia & { type?: string } }[] }[] };

/**
 * What they are watching and reading. Only the lists worth mentioning: what is
 * in progress, and what was dropped or paused — a completed list of six hundred
 * titles is not context, it is a database.
 */
export async function userList(username: string, fetchImpl: Fetcher): Promise<ListEntry[]> {
  const name = username.trim();
  if (!name) throw new Error('No AniList username has been saved.');
  const entries: ListEntry[] = [];
  for (const type of ['ANIME', 'MANGA'] as MediaKind[]) {
    let data: { MediaListCollection: RawList | null };
    try {
      data = await query<{ MediaListCollection: RawList | null }>(
      `query($u: String, $t: MediaType) {
        MediaListCollection(userName: $u, type: $t, status_in: [CURRENT, PAUSED, PLANNING]) {
          lists { entries { status progress score media { title { romaji english } episodes chapters } } }
        }
      }`, { u: name, t: type }, fetchImpl);
    } catch (error) {
      // A private profile is the one failure the user can actually do something
      // about, and AniList reports it as the bare string "Private User" — which
      // shown raw reads like a bug rather than a setting of theirs.
      const complaint = error instanceof Error ? error.message : String(error);
      if (/private user/i.test(complaint)) throw new Error(`The AniList profile "${name}" is private, so its list cannot be read. Make the list public in AniList's privacy settings, or leave the username blank and she will still look titles up.`);
      if (/user not found/i.test(complaint)) throw new Error(`AniList has no user called "${name}".`);
      throw error;
    }
    for (const list of data.MediaListCollection?.lists ?? []) {
      for (const entry of list.entries ?? []) {
        const title = entry.media?.title?.english?.trim() || entry.media?.title?.romaji?.trim();
        if (!title) continue;
        entries.push({
          title,
          kind: type,
          status: (entry.status ?? 'CURRENT').toLowerCase(),
          progress: entry.progress ?? 0,
          total: (type === 'ANIME' ? entry.media?.episodes : entry.media?.chapters) ?? undefined,
          score: entry.score || undefined,
        });
      }
    }
  }
  return entries;
}

const WORD_FOR: Record<MediaKind, string> = { ANIME: 'episodes', MANGA: 'chapters' };

/** One title, written as facts to answer from rather than as a database row. */
export function formatMedia(media: Media): string {
  const counted = media.units ? `${media.units} ${WORD_FOR[media.kind]}${media.volumes ? ` across ${media.volumes} volumes` : ''}` : '';
  // The name carries the colon and the rest is comma-joined after it — built as
  // one list, the empty gap between them came out as "Fire Punch:, manga".
  const name = `${media.title}${media.altTitle ? ` (also called ${media.altTitle})` : ''}`;
  const parts = [
    media.kind === 'ANIME' ? 'anime' : 'manga',
    media.by ? `by ${media.by}` : '',
    media.year ? `from ${media.year}` : '',
    counted,
    media.status ? `status ${media.status.toLowerCase().replace(/_/g, ' ')}` : '',
    media.score ? `rated ${media.score}/100 on AniList` : '',
    media.genres.length ? `genres ${media.genres.slice(0, 4).join(', ')}` : '',
  ].filter(Boolean).join(', ');
  return [
    `${name}: ${parts}.`,
    media.summary ? `What it is about: ${media.summary}` : '',
    'Answer them from this in your own words. Do not recite the whole entry, and do not give them a score out of 100 unless they asked what it is rated — you have opinions of your own.',
  ].filter(Boolean).join(' ');
}

/** Nothing found, said in a way that does not invite her to invent one. */
export function formatMissing(search: string): string {
  return `AniList has nothing matching "${search}". Say you have not heard of it, or ask whether they have the name slightly wrong. Do not describe it from memory as though you had looked it up.`;
}

// Enough for her to know what they are in the middle of, and short enough to sit
// in a prompt beside everything else she is holding.
const LIST_LIMIT = 12;

/**
 * Their list as a line for the system prompt. Put in front of her rather than
 * behind a tool for the same reason the agenda is: asked "what am I watching",
 * a model that has to choose to look will often just answer instead.
 */
export function formatList(entries: ListEntry[]): string {
  if (!entries.length) return '';
  const current = entries.filter(entry => entry.status === 'current');
  const paused = entries.filter(entry => entry.status === 'paused');
  const say = (entry: ListEntry) => `${entry.title} (${entry.progress}${entry.total ? `/${entry.total}` : ''})`;
  const lines: string[] = [];
  if (current.length) lines.push(`They are part-way through: ${current.slice(0, LIST_LIMIT).map(say).join('; ')}.`);
  if (paused.length) lines.push(`Stalled and not finished: ${paused.slice(0, LIST_LIMIT).map(say).join('; ')}.`);
  if (!lines.length) return '';
  // The last sentence is load-bearing and was learned the hard way. With the
  // list simply present, she stopped calling look_up_anime and started answering
  // from it — asked how long Fire Punch was she said it was "the English title
  // for I Am a Hero", a title she had picked up off the stalled list two lines
  // above. A list of names reads to a model as knowledge of those names, so it
  // has to be labelled as the opposite: progress markers, and nothing else.
  return `${lines.join(' ')} That is from their AniList. Use it when it is relevant — you know what they are in the middle of — but do not list it back at them or nag about the stalled ones unless it comes up. It is a record of their progress and nothing more: it tells you no facts about any series, not even these. For anything about what a series is, how long it runs, who made it or whether it has finished, call look_up_anime — including for titles on this list.`;
}
