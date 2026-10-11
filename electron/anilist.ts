import {corePolicySync} from './core-policy-sync';
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
 return corePolicySync('final-anilist.config',[saved??null]);
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
 return corePolicySync('final-anilist.media',[raw,kind]);
}

/**
 * One title. `kind` is optional because people do not always say which they
 * mean; without it both are searched and the better match wins, preferring
 * whichever actually exists.
 */
export async function lookUp(search: string, kind: MediaKind | undefined, fetchImpl: Fetcher): Promise<Media | null> {
 return coreAniList('lookup',search,kind,fetchImpl);
}

type RawList = { lists?: { entries?: { status?: string; progress?: number; score?: number; media?: RawMedia & { type?: string } }[] }[] };

/**
 * What they are watching and reading. Only the lists worth mentioning: what is
 * in progress, and what was dropped or paused — a completed list of six hundred
 * titles is not context, it is a database.
 */
export async function userList(username: string, fetchImpl: Fetcher): Promise<ListEntry[]> {
 return coreAniList('list',username,undefined,fetchImpl);
}

const WORD_FOR: Record<MediaKind, string> = { ANIME: 'episodes', MANGA: 'chapters' };

/** One title, written as facts to answer from rather than as a database row. */
export function formatMedia(media: Media): string {
  return corePolicySync('final-tool-values.formatMedia',[media]);
}

/** Nothing found, said in a way that does not invite her to invent one. */
export function formatMissing(search: string): string {
  return corePolicySync('final-tool-values.formatMissing',[search]);
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
 return corePolicySync('final-anilist.formatList',[entries]);
}

async function coreAniList(mode:'lookup'|'list',asked:string,kind:MediaKind|undefined,fetchImpl:Fetcher):Promise<any>{
 let packet=corePolicySync<any>('final-anilist.start',[mode,asked,kind??null]);
 for(let n=0;n<4;n++){
  if(Object.hasOwn(packet,'result'))return packet.result;if(packet.error)throw Error(packet.error);
  const c=packet.command;let document:string,variables:Record<string,unknown>;
  // Fixed GraphQL schemas are wire adapters; Core selects type and requested operation.
  if(c.kind==='lookup'){document=`query($s: String, $t: MediaType) { Media(search: $s, type: $t, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }`;variables={s:c.query,t:c.type};}
  else if(c.kind==='list'){document=`query($u: String, $t: MediaType) { MediaListCollection(userName: $u, type: $t, status_in: [CURRENT, PAUSED, PLANNING]) { lists { entries { status progress score media { title { romaji english } episodes chapters } } } } }`;variables={u:c.query,t:c.type};}
  else throw Error('anilist_command_protocol');
  const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query:document,variables}),signal:AbortSignal.timeout(c.timeoutMs)});
  const parsed=await response.json().catch(()=>null),observation=corePolicySync('final-anilist.response',[response.ok,response.status,parsed]);
  packet=corePolicySync('final-anilist.observed',[packet.state,observation]);
 }
 throw Error('anilist_program_bound');
}
