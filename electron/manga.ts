// Reading the thing itself.
//
// Her nights were spent reading *about* what she is into: reviews, forum
// threads, an ending explained. That is how her Chainsaw Man stance was built,
// and it is why she once told him the manga was unfinished — the reading said
// so, and nothing she had ever seen contradicted it. A view assembled entirely
// from other people's views is a summary of a fandom, not an opinion.
//
// So she reads pages now. Her own vision model on the server reads a manga page
// about as well as it reads his screen: given the first chapter of Chainsaw Man
// it came back with the debt tally in order, "38,040,000 yen", "You know the
// drill, Pochita!" — the dialogue, in sequence, correct. It costs about a
// hundred seconds a page, which is the whole reason this reads a stretch a
// night rather than a volume: a 53-page chapter would be an hour and a half of
// the card, and someone reading a chapter a night is a better character than
// one who inhales a series between midnight and two.
//
// Where the pages come from: MangaDex's public API, with a real User-Agent and
// a request a second, which is well inside what they ask for. Chapters that are
// officially licensed are listed there as an external link to the publisher
// rather than hosted, and `readableChapters` drops those — she reads what the
// API actually serves and nothing it declines to.

/** One request a second. Their limit is higher; there is no hurry here at night. */
export const REQUEST_GAP_MS = 1_000;

/** How many pages one night is worth. At ~100s a page this is a twenty-minute sitting. */
export const PAGES_A_NIGHT = 12;

/** A chapter she has not finished is resumed; below this many left, she finishes it. */
export const FINISH_CHAPTER_UNDER = 4;

export const MANGADEX = 'https://api.mangadex.org';
export const USER_AGENT = 'haru-desktop/0.1 (personal reading companion)';

export type ChapterRef = {
  id: string;
  /** As the site numbers it — "1", "97.5". Kept as text because it is not always a number. */
  chapter: string;
  title: string;
  pages: number;
};

export type Reading = {
  seriesId: string;
  title: string;
  /** The chapter she is in, and how far through it. */
  chapter: string;
  chapterId: string;
  page: number;
  pages: number;
  startedAt: string;
  lastAt: string;
  /** Chapters finished, so she can say how far in she is without counting. */
  finished: number;
  /** Where the pages come from: MangaDex directly (the old way) or her shelf on Suwayomi. */
  source?: 'mangadex' | 'suwayomi';
  /** The manga's id on Suwayomi, for chapters, pages and her mirrored bookmark. */
  mangaId?: number;
};

export function searchUrl(title: string): string {
  return `${MANGADEX}/manga?${new URLSearchParams({ title, limit: '5' })}`;
}

export function feedUrl(seriesId: string, offset = 0): string {
  // URLSearchParams escapes the brackets MangaDex's array params need, so the
  // query is built by hand. Encoded, the API silently returns every language.
  return `${MANGADEX}/manga/${seriesId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=100&offset=${offset}`;
}

export function pagesUrl(chapterId: string): string {
  return `${MANGADEX}/at-home/server/${chapterId}`;
}

/**
 * The chapters she can actually read.
 *
 * Two kinds are dropped. An entry with `externalUrl` is an officially licensed
 * chapter that lives at the publisher, and the API is telling us to go there
 * instead — she is not going to. An entry with no pages is a stub, and there
 * are plenty: of the first twenty Chainsaw Man entries, seven were one or the
 * other. Duplicate numbers are common too, because several groups translate the
 * same chapter, so the first readable one of each number wins.
 */
export function readableChapters(feed: { id: string; attributes?: Record<string, unknown> }[]): ChapterRef[] {
  const seen = new Set<string>();
  const out: ChapterRef[] = [];
  for (const entry of feed) {
    const a = entry.attributes ?? {};
    const pages = typeof a.pages === 'number' ? a.pages : 0;
    const chapter = typeof a.chapter === 'string' ? a.chapter : '';
    if (!chapter || pages <= 0 || typeof a.externalUrl === 'string') continue;
    if (seen.has(chapter)) continue;
    seen.add(chapter);
    out.push({ id: entry.id, chapter, title: typeof a.title === 'string' ? a.title : '', pages });
  }
  return out.sort((a, b) => (Number(a.chapter) || 0) - (Number(b.chapter) || 0));
}

export function readReading(saved: unknown): Reading | null {
  const r = (saved && typeof saved === 'object' ? saved : {}) as Partial<Reading>;
  if (typeof r.seriesId !== 'string' || !r.seriesId || typeof r.chapterId !== 'string' || !r.chapterId) return null;
  return {
    seriesId: r.seriesId,
    title: typeof r.title === 'string' ? r.title : '',
    chapter: typeof r.chapter === 'string' ? r.chapter : '',
    chapterId: r.chapterId,
    page: typeof r.page === 'number' && r.page >= 0 ? Math.floor(r.page) : 0,
    pages: typeof r.pages === 'number' && r.pages > 0 ? Math.floor(r.pages) : 0,
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
    lastAt: typeof r.lastAt === 'string' ? r.lastAt : '',
    finished: typeof r.finished === 'number' && r.finished >= 0 ? Math.floor(r.finished) : 0,
    ...(r.source === 'suwayomi' || r.source === 'mangadex' ? { source: r.source } : {}),
    ...(typeof r.mangaId === 'number' && Number.isFinite(r.mangaId) ? { mangaId: r.mangaId } : {}),
  };
}

/** Where tonight's sitting starts and stops. */
export function tonightsPages(reading: Reading, budget = PAGES_A_NIGHT): { from: number; to: number } {
  const left = Math.max(0, reading.pages - reading.page);
  // A handful left is finished rather than left dangling over a night.
  const take = left <= budget + FINISH_CHAPTER_UNDER ? left : budget;
  return { from: reading.page, to: reading.page + take };
}

/** After a sitting: further into the chapter, or on to the next one. */
export function afterReading(reading: Reading, readTo: number, next: ChapterRef | null, nowIso: string): Reading {
  const done = readTo >= reading.pages;
  if (!done) return { ...reading, page: readTo, lastAt: nowIso };
  if (!next) return { ...reading, page: reading.pages, lastAt: nowIso, finished: reading.finished + 1 };
  return {
    ...reading,
    chapter: next.chapter,
    chapterId: next.id,
    page: 0,
    pages: next.pages,
    lastAt: nowIso,
    finished: reading.finished + 1,
  };
}

/** What the vision model is asked of one page. Plain: the reading is evidence. */
export const PAGE_PROMPT = 'This is one page of a manga, read right to left. Give the dialogue in order, then one line on what happens on this page. No commentary of your own.';

/**
 * What she is asked once the pages are read.
 *
 * The pages go in as they came back, because a summary of a chapter is not the
 * chapter, and the whole point of reading it was to have something of her own
 * to think with. She is told how far in she is so a view does not outlive the
 * story: the want "to see the finale resolve" survived the finale once, from a
 * stance built out of reviews.
 */
export function readingInstruction(reading: Reading, from: number, to: number, pages: string): string {
  const where = reading.finished > 0
    ? `You have finished ${reading.finished} chapter${reading.finished === 1 ? '' : 's'} of it and you are in chapter ${reading.chapter}`
    : `You have just started it — chapter ${reading.chapter}`;
  return [
    `You spent tonight reading ${reading.title}. ${where}, pages ${from + 1} to ${to} of ${reading.pages}.`,
    '',
    'This is what was on those pages:',
    pages,
    '',
    'Write what you make of it, in three or four lines, to yourself — nobody is reading this.',
    'It has to come from those pages and not from anything you know about the series: what actually happened, what you thought of it, what you want to know next.',
    'No summary of the plot for its own sake, no recommending it, no talking to anyone.',
    // Not her page number. The bookmark holds that exactly, and asked for it on
    // the first live run she wrote "Pages 1-12 of 53" for a sitting of ten —
    // which then becomes the one fact her view is allowed to rest on. She is
    // asked for the state of the work, which is what that field was added for.
    'Then on a last line, starting with STANDS:, one short sentence on the state of the thing itself — whether it is finished or still running, and how far the story has got. Not your page number: that is kept for you, and guessing at it is how you end up wrong about it.',
  ].join('\n');
}

/**
 * Where she is up to, for the her_own block.
 *
 * Asked "what chapter are you up to" she said she was not reading it, only
 * reading *about* it — while the bookmark stood at page 46 of chapter 1, read
 * page by page over four nights (2026-09-12). Nothing in her prompt carried
 * the bookmark: the night note said "read about", the want said "researched
 * the ending", and the pages themselves were only ever shown to the night
 * pass. This is the one line that says what she has actually read.
 */
export function readingNote(reading: Reading | null): string {
  if (!reading?.title) return '';
  const where = reading.page > 0
    ? `${reading.page} of ${reading.pages || '?'} pages into chapter ${reading.chapter}`
    : `about to start chapter ${reading.chapter}${reading.pages ? ` (${reading.pages} pages)` : ''}`;
  const done = reading.finished > 0 ? `${reading.finished} chapter${reading.finished === 1 ? '' : 's'} finished, ` : '';
  return `- Your manga, which you read page by page on MangaDex, a dozen pages a night in the small hours: ${reading.title} — ${done}${where}. Asked where you are up to, that is the answer. You have read those pages yourself, not a summary of them, and nothing past them.`;
}

export type ReadingTake = { note: string; stands: string };

export function parseReadingTake(raw: string): ReadingTake | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const stands = /^\s*STANDS\s*:\s*(.+)$/im.exec(text);
  const note = text.replace(/^\s*STANDS\s*:.*$/im, '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (note.length < 20) return null;
  return { note, stands: stands ? stands[1].trim() : '' };
}
