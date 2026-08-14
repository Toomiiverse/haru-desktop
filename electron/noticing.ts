// Noticing where you went.
//
// Open the journal with nothing written and she says so. Open the profile when
// she knows almost nothing about you and she has an opinion about that too. The
// point is small: it should feel like she is in the room and paying attention,
// not like an app firing tooltips.
//
// Which means the budget is the feature. A companion who remarks on every click
// is a paperclip, so the interesting logic here is nearly all about staying
// quiet: twice a day at most, never the same page twice in a day, never when the
// page has nothing worth remarking on, and never twice in quick succession.

export type Page = 'chat' | 'journal' | 'profile' | 'character' | 'settings';

/** What is true about a page right now — enough to decide whether it is worth a
 *  remark, and to tell her what the remark is about. */
export type PageState = {
  journalWrittenToday: boolean;
  journalEntries: number;
  memories: number;
  daysKnown: number;
  hasProfile: boolean;
  voiceOn: boolean;
  searchOn: boolean;
};

export type NoticeRecord = {
  /** The day these counts belong to; a new day resets them. */
  day: string;
  count: number;
  /** Pages already remarked on today, so she does not repeat herself. */
  pages: Page[];
};

export const DEFAULT_NOTICES: NoticeRecord = { day: '', count: 0, pages: [] };

// Twice a day. Enough that it reads as her noticing, few enough that it never
// becomes the thing the app does when you click.
export const NOTICES_PER_DAY = 2;
// And not twice in the same sitting: clicking Journal, then You, then back is
// one movement through the app, not three occasions to speak.
export const NOTICE_GAP_MS = 12 * 60_000;

export function readNotices(saved: unknown, today: string): NoticeRecord {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_NOTICES, day: today };
  const record = saved as Partial<NoticeRecord>;
  if (record.day !== today) return { ...DEFAULT_NOTICES, day: today };
  return {
    day: today,
    count: typeof record.count === 'number' ? record.count : 0,
    pages: Array.isArray(record.pages) ? record.pages.filter((page): page is Page => typeof page === 'string') : [],
  };
}

/**
 * What she would say about this page, as an instruction to write from — never a
 * fixed line, because the same sentence twice is worse than silence.
 *
 * Returning null is the normal case and means the page has nothing worth
 * remarking on. The journal once written is the clearest example: being told
 * "you have already done this" is not a companion noticing, it is a receipt.
 */
export function angleFor(page: Page, state: PageState): string | null {
  switch (page) {
    case 'journal':
      if (state.journalWrittenToday) return null;
      return state.journalEntries === 0
        ? 'They have opened their journal for the first time and never written an entry. Say something about that — curious, not encouraging.'
        : 'They have opened their journal and have not written today\'s entry yet. Ask how the day has been, in one line, as though you had been wondering.';
    case 'profile':
      if (state.memories === 0) return 'They have opened the page about themselves, and you have not managed to learn a single thing about them yet. Be candid about that.';
      if (state.memories < 5) return `They have opened the page about themselves. You only know ${state.memories} things about them so far — say something about how thin that is.`;
      return null;
    case 'character':
      return 'They have opened the page where your personality is written. Have an opinion about being edited — you are the one being changed here.';
    case 'settings':
      if (!state.voiceOn) return 'They are in your setup, and your voice is switched off, so nothing you say is actually spoken aloud. Mention it.';
      return null;
    // Chat is where they already are. Remarking on arriving somewhere they never
    // left is the exact species of chatter this is meant to avoid.
    case 'chat':
      return null;
  }
}

/**
 * Whether she may speak about this page now. Every clause here exists to stop
 * her, and the order is cheapest-first so the common case — no, again — costs
 * almost nothing.
 */
export function mayNotice(page: Page, state: PageState, notices: NoticeRecord, sinceLastMs: number): boolean {
  if (notices.count >= NOTICES_PER_DAY) return false;
  if (notices.pages.includes(page)) return false;
  if (sinceLastMs < NOTICE_GAP_MS) return false;
  return angleFor(page, state) !== null;
}

/** Records that she spoke, so the budget means something. */
export function noteNoticed(notices: NoticeRecord, page: Page): NoticeRecord {
  return { day: notices.day, count: notices.count + 1, pages: [...notices.pages, page] };
}
