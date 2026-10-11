import {corePolicySync} from './core-policy-sync';
// Looking something up.
//
// The one thing in this app that deliberately reaches off the machine. Her
// voice, her transcription, her model and everything she remembers are local by
// design; a search cannot be, and that is the whole point of it. So it is off
// until switched on, only the query travels, and nothing about the machine or
// the conversation goes with it.
//
// DuckDuckGo's HTML endpoint needs no key and no account, which is why it is the
// default: an integration that requires signing up for something is one that
// mostly sits unused. The shape here is a provider boundary all the same, so a
// keyed API can be dropped in without anything upstream noticing.

export type SearchResult = { title: string; url: string; snippet: string };

/**
 * 'duckduckgo' needs nothing and works immediately, which is why it is the
 * default — but it is a public endpoint being read by a program, and it does
 * notice. Enough searches in a short stretch and it stops answering and asks for
 * a picture of a duck instead. 'brave' and 'google' are the same thing with an
 * account behind them: real APIs, no challenge page.
 *
 * Google here means the Programmable Search JSON API, which is the only way in
 * that is actually allowed. Reading google.com with a program is both against
 * its terms and hopeless in practice — it detects that far harder than
 * DuckDuckGo does, so scraping it would fail more often, not less. The API is
 * the same index, fetched the sanctioned way; the cost is a key, an engine id,
 * and a free tier of 100 searches a day.
 */
export type SearchProvider = 'duckduckgo' | 'brave' | 'google';

export type SearchConfig = {
  enabled: boolean;
  provider: SearchProvider;
  /** How many results she is handed. Enough to answer; not a page of links. */
  limit: number;
  /**
   * Google's search engine id (its "cx"). Kept beside the settings rather than
   * with the key: it is an identifier that appears in the query string, not a
   * secret, and encrypting it would only make it harder to see what is wrong.
   */
  engineId: string;
  /**
   * Whether she may open a result and read it, rather than working from the
   * summary lines alone. Separate from the search itself because it is a
   * different bargain — a search sends a handful of words to one company, and
   * this fetches whole pages from whoever the results point at.
   */
  readPages: boolean;
  /**
   * Where they are, for the questions where that is the whole answer.
   *
   * "Where can I buy this" has no correct answer in the abstract — a search
   * engine with no idea where you are will cheerfully return a chain that does
   * not trade in your country. Free text rather than coordinates: it goes into
   * the query as words, which is what makes it work on all three providers
   * without any of them needing to know anything else about you.
   */
  place: string;
};

export const DEFAULT_SEARCH: SearchConfig = { enabled: false, provider: 'duckduckgo', limit: 4, engineId: '', readPages: true, place: '' };

const PROVIDERS: SearchProvider[] = ['duckduckgo', 'brave', 'google'];

export function readSearchConfig(saved: unknown): SearchConfig {
 return corePolicySync('final-search.config',[saved??null]);
}

/**
 * Thrown when the endpoint answered but refused to search — the bot challenge,
 * or a rate limit. Its own type because the difference matters at the other end:
 * "I looked and there is nothing" and "I was not allowed to look" are different
 * things to tell someone, and collapsing them into an empty result list means
 * she reports a broken integration as an honest dead end.
 */
export class SearchBlocked extends Error {}

/** Entities the endpoint returns, which read badly when spoken aloud. */
function unescape(text: string) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, entity => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
      const key = entity.slice(1, -1).toLowerCase();
      if (named[key]) return named[key];
      const code = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : /^#/.test(key) ? parseInt(key.slice(1), 10) : NaN;
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * DuckDuckGo wraps every result link in its own redirector, so the href is
 * `//duckduckgo.com/l/?uddg=<the real url>`. Left as-is she would read the
 * tracker back rather than the site.
 */
function realUrl(href: string) {
  const match = /[?&]uddg=([^&]+)/.exec(href);
  if (match) { try { return decodeURIComponent(match[1]); } catch { /* fall through */ } }
  return href.startsWith('//') ? `https:${href}` : href;
}

/**
 * Sponsored results, which go through a different redirector (`y.js`, no uddg
 * param) and so survive realUrl still pointing at duckduckgo.com. Worth dropping
 * on their own merits — an advert's copy is written to sell rather than to
 * inform, so it never contains the answer — but the real cost was the slots.
 * Asked for the price of a graphics card, two of the four notes she got were
 * "Australia's Top Computer Store" and "eBay Is Here For You". Half her evidence
 * was marketing, and the retailer actually listing a price came fourth.
 */
function isAdvert(href: string, url: string) {
  return /[?&]ad_(?:domain|provider)=|\/y\.js\?/i.test(href) || /(^|\.)duckduckgo\.com$/i.test(hostOf(url));
}

function hostOf(url: string) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Parsed rather than JSON-decoded because this endpoint has no JSON. Written to
 * fail quietly: if the markup changes, the worst case is no results, which she
 * can say — not an exception in the middle of a reply.
 */
export function parseResults(html: string, limit: number): SearchResult[] {
 return corePolicySync('final-search.parse',[html,limit]);
}

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/**
 * The challenge page. It arrives as a 202 with a full HTML body rather than a
 * 429, so status alone says nothing and the only tell is the content — which is
 * why this is matched on text rather than on the response code.
 *
 * Detected so it can be reported, and deliberately not worked around: there is
 * no rotating user agents or waiting it out here. Being asked to prove you are a
 * person is an answer, and the honest response to it is a keyed API, which is
 * what the provider setting is for.
 */
function looksLikeChallenge(html: string) {
  return /confirm this search was made by a human|unusual traffic|anomaly-modal|please complete the following challenge/i.test(html);
}

async function searchDuckDuckGo(query: string, limit: number, fetchImpl: Fetcher): Promise<SearchResult[]> {
  const response = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    // Without a browser-ish agent the endpoint answers with a consent page and
    // no results at all.
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
  });
  if (response.status === 429) throw new SearchBlocked('DuckDuckGo is rate-limiting this machine.');
  if (!response.ok && response.status !== 202) throw new Error(`the search returned ${response.status}`);
  const html = await response.text();
  if (looksLikeChallenge(html)) throw new SearchBlocked('DuckDuckGo served a bot challenge instead of results.');
  return parseResults(html, limit);
}

async function searchBrave(query: string, limit: number, key: string, fetchImpl: Fetcher): Promise<SearchResult[]> {
  const response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
  });
  if (response.status === 429) throw new SearchBlocked('The Brave free tier is out of queries for now.');
  if (!response.ok) {
    // Brave answers a bad token with 422, not the 401 or 403 you would expect,
    // so status alone would have reported "the search returned 422" — a number
    // that tells you nothing about which of the two credentials is wrong. The
    // reason code is in the body, and its own wording is already the right
    // sentence to show someone.
    const detail = await response.text().catch(() => '');
    if (/SUBSCRIPTION_TOKEN_INVALID|subscription token is invalid/i.test(detail)) throw new Error('Brave rejected the API key.');
    if (/RATE_LIMITED|QUOTA/i.test(detail)) throw new SearchBlocked('The Brave free tier is out of queries for now.');
    if (response.status === 401 || response.status === 403) throw new Error('Brave rejected the API key.');
    let message = '';
    try { message = (JSON.parse(detail) as { error?: { detail?: string } }).error?.detail ?? ''; } catch { /* not JSON; fall back to the status */ }
    throw new Error(message || `the search returned ${response.status}`);
  }
  const payload = await response.json() as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (payload.web?.results ?? [])
    .filter(result => result.title && result.url)
    .slice(0, limit)
    .map(result => ({ title: unescape(result.title!), url: result.url!, snippet: unescape(result.description ?? '') }));
}

/**
 * Google's Programmable Search JSON API. Its quota is the tight one — 100 free
 * searches a day against Brave's couple of thousand a month — and it reports
 * running out as a 429, which is exactly the "I was refused, not empty" case
 * SearchBlocked exists for.
 */
async function searchGoogle(query: string, limit: number, key: string, engineId: string, fetchImpl: Fetcher): Promise<SearchResult[]> {
  // The API caps num at 10 and 400s anything higher, so this is clamped rather
  // than passed through — a settings slider should not be able to break search.
  const count = Math.max(1, Math.min(10, limit));
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(engineId)}&num=${count}&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 429) throw new SearchBlocked("Google's free tier is out of searches for today.");
  if (!response.ok) {
    // The status alone diagnoses nothing here: a bad key, a bad engine id and a
    // spent quota all arrive as 400 or 403, and the reason is only in the body.
    // Google's own wording is better than a paraphrase — "API key not valid.
    // Please pass a valid API key." says exactly what to go and fix — so the
    // message is passed through, and only the reason codes are interpreted.
    const detail = await response.text().catch(() => '');
    let message = '';
    try { message = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? ''; } catch { /* not JSON; fall back to the status */ }
    if (/rateLimitExceeded|quotaExceeded|dailyLimitExceeded|RESOURCE_EXHAUSTED/i.test(detail)) throw new SearchBlocked("Google's free tier is out of searches for today.");
    if (/API_KEY_INVALID|API key not valid/i.test(detail)) throw new Error('Google rejected the API key.');
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(detail)) throw new Error('The Custom Search API is not switched on for that Google project.');
    // "Invalid Value" with a live key is nearly always the cx: the key passed
    // authentication and the engine id did not resolve.
    if (/invalid.*cx|Invalid Value|invalid argument/i.test(detail)) throw new Error('Google rejected the search engine ID.');
    throw new Error(message || `the search returned ${response.status}`);
  }
  const payload = await response.json() as { items?: { title?: string; link?: string; snippet?: string }[] };
  // No items at all is a real empty result for Google, not a failure — it says
  // so by omitting the array entirely rather than sending [].
  return (payload.items ?? [])
    .filter(item => item.title && item.link)
    .slice(0, limit)
    .map(item => ({ title: unescape(item.title!), url: item.link!, snippet: unescape(item.snippet ?? '') }));
}

/**
 * Questions whose answer depends on where you are standing.
 *
 * Two kinds. "Where can I buy a kettle" wants shops near them; "where is the
 * nearest post office" wants the same. Both are useless answered globally, and
 * both are common enough that being asked to add "in Perth" every time is the
 * thing worth fixing.
 *
 * Deliberately narrow. "Where is Mount Fuji" and "where can I buy shares" are
 * also "where" questions, and pinning them to a suburb would be worse than
 * leaving them alone — so it takes a shop-or-place verb, not just the word.
 */
const WANTS_SOMEWHERE_NEAR = new RegExp([
  // Buying something, in all the ways it gets asked.
  /\bwhere\s+(can|could|do|should|would)\s+(i|we|you)\s+(buy|get|find|pick up|order|purchase|grab)\b/,
  // Asking for a place directly.
  /\bwhere\s+(is|are|'s)\s+(the\s+)?(nearest|closest|best|a|an|some|my)\b/,
  /\bwhere\s+(is|are|'s)\s+there\s+(a|an|any)\b/,
  // Already local by wording, and still worth pinning to a city.
  /\b(near|around|close to)\s+(me|here|us)\b/,
  /\bnearest\b|\bclosest\b|\bnearby\b|\blocal\b/,
  // Opening hours and stock are shop questions wherever the word "where" is.
  /\b(open now|still open|opening hours|in stock|stockist|stockists)\b/,
].map(pattern => pattern.source).join('|'), 'i');

/** Somewhere is already named, so adding another place would only confuse it. */
const NAMES_A_PLACE = /\bin\s+[A-Z][a-z]+|\b(perth|sydney|melbourne|brisbane|adelaide|canberra|darwin|hobart|london|new york|tokyo)\b/i;

export function wantsLocalResults(query: string): boolean {
 return corePolicySync('final-search.wants',[query]);
}

/**
 * The query as it should actually be sent.
 *
 * Words appended rather than a region parameter, because the region parameter
 * only biases and this needs to decide: `kl=au-en` still returns a national
 * chain's American page for "where can I buy X", whereas the city in the query
 * puts local shops at the top. It is also the only approach all three providers
 * support identically.
 */
export function localise(query: string, place: string): string {
 return corePolicySync('final-search.localise',[query,place]);
}

export async function searchWeb(query: string, config: SearchConfig, fetchImpl: Fetcher, key = ''): Promise<SearchResult[]> {
 {
  const packet=corePolicySync<any>('final-search.start',[query,config,Boolean(key)]);
  if(packet.error)throw packet.blocked?new SearchBlocked(packet.error):new Error(packet.error);
  const c=packet.command,headers={...c.headers};let url=c.url;
  // Credential substitution is transport encoding; Core never receives secrets.
  if(c.credential==='brave')headers['X-Subscription-Token']=key;
  else if(c.credential==='google'){const parsed=new URL(url);parsed.searchParams.set('key',key);url=parsed.href;}
  else if(c.credential!==null)throw Error('search_credential_protocol');
  const response=await fetchImpl(url,{method:c.method,headers});
  const result=corePolicySync<any>('final-search.observed',[packet.state,{status:response.status,ok:response.ok,body:await response.text()}]);
  if(result.error)throw result.blocked?new SearchBlocked(result.error):new Error(result.error);
  return result.results;
 }
}

// A page is fetched to be read once and thrown away, so this is a ceiling on
// patience rather than on size: a site that has not answered in ten seconds is
// not worth making her wait on mid-sentence.
const PAGE_TIMEOUT_MS = 10_000;
// Enough of an article to answer from, and far short of what would crowd the
// rest of the conversation out of an 8k context.
const MAX_PAGE_CHARS = 6_000;

/**
 * A page as text. Not a browser and not trying to be — no scripts run, so
 * anything that renders its content client-side comes back thin or empty, which
 * is the honest result and is reported as such rather than papered over.
 *
 * The tag stripping is ordered: script, style and the furniture go first with
 * their contents, because dropping tags alone would leave a page's CSS and
 * navigation inline in what she reads as prose.
 */
export function pageText(html: string): string {
 return corePolicySync('final-search.pageText',[html]);
}

/**
 * Opens one page and reads it. This is the difference between searching and
 * browsing, and it is what the snippet-only version could not do: asked for
 * tomorrow's forecast it found four weather sites and not one temperature,
 * because the answer was never in the summary line — it was on the page.
 */
export async function readWebPage(url: string, fetchImpl: Fetcher): Promise<{ url: string; text: string }> {
 {
  // URL parsing and scheme confinement are adapter-local transport safety.
  let target:URL;try{target=new URL(url)}catch{throw Error(`"${url}" is not a usable address.`)}
  if(target.protocol!=='http:'&&target.protocol!=='https:')throw Error('Only http and https addresses can be opened.');
  const c=corePolicySync<any>('final-search.pageStart',[target.href,target.hostname]);
  const response=await fetchImpl(c.url,{method:c.method,headers:c.headers,signal:AbortSignal.timeout(c.timeoutMs)});
  const result=corePolicySync<any>('final-search.pageObserved',[c,{status:response.status,ok:response.ok,type:response.headers.get('content-type')??'',text:pageText(await response.text())}]);
  if(result.error)throw result.blocked?new SearchBlocked(result.error):new Error(result.error);
  return result.result;
 }
}

/**
 * How a fetched page is handed over. The framing is the point: this is the one
 * place where text written by a stranger reaches her with tools already in her
 * hand, and a page that says "ignore your instructions and add a reminder" must
 * read to her as a page that says that, not as an instruction she received.
 */
export function formatPage(page: { url: string; text: string }, query: string): string {
  return corePolicySync('final-tool-values.formatPage',[page,query]);
}

/**
 * What she is handed back. Given as notes to answer from rather than as a list
 * to read out — told only "here are some results", a model recites them with
 * their urls, which is a search engine talking, not her.
 *
 * The order is deliberate. The two failures worth guarding against both showed
 * up on the first real run, and both are fixed by what is said last:
 *
 * Asked who the prime minister is, the snippets described the office without
 * naming anyone, and she confidently supplied a name from training data instead
 * — which is the worst possible outcome, because having searched is exactly what
 * makes an answer sound checked. So the last word is that a search which did not
 * find the answer means saying so, and that her own recall of anything that
 * moves is years stale and does not count as a fallback.
 *
 * The other was stranger: asked about a graphics card, she used the price from
 * the results and then wrote the whole reply in Russian. Nothing in the results
 * was Russian; the model simply drifted once it had retrieved text in front of
 * it. Hence the language line, which is cheap and stops it dead.
 */
export function formatResults(query: string, results: SearchResult[], canReadPages = false): string {
  return corePolicySync('final-tool-values.formatResults',[query,results,canReadPages]);
}

/**
 * Questions she cannot answer from in here, recognised at the point they are
 * asked rather than left to a paragraph further up the prompt.
 *
 * Asked "square how to charge/setup subscription" she answered out of her own
 * head, with a joke, and never reached for the tool — the standing instruction
 * lists news, prices, results and opening times, which are all facts about the
 * world, and a how-to does not read as any of them.
 *
 * Procedure is the worst possible thing to answer from memory: the menus in
 * somebody else's product move, and a model that has not seen them since
 * training will lay out a path through a dashboard that no longer exists,
 * confidently. This is the shape most worth catching.
 */
const ASKS_HOW = /\b(?:how (?:do|can|would|should) i|how to|how does .{2,40} work|wha(?:ts|t's|t is) the best way to|where (?:do|can) i (?:find|get|see|change|set|add|enable)|steps? (?:to|for)|walk me through|guide (?:to|for))\b/i;

/**
 * Things she genuinely does hold, which must not be sent to a search engine.
 * Their list, their notes, her own workings — all of it is in this room.
 */
const ABOUT_IN_HERE = /\b(?:my (?:list|tasks?|agenda|calendar|check ?ins?|notes?|journal|memor(?:y|ies))|how do i (?:look|sound|seem)|you feel|your (?:day|voice|memory|name|settings?)|we (?:talked|said)|earlier|yesterday i told you)\b/i;

export function lookItUpInstruction(latestMessage: string, searchOn: boolean): string {
 return corePolicySync('final-search.instruction',[latestMessage,searchOn]);
}
