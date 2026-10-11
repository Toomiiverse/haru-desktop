import {corePolicySync} from './core-policy-sync';
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
  return corePolicySync<any>('context-preparation.readNotices',[saved,today]);
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
  return corePolicySync<any>('context-preparation.angleFor',[page,state]);
}

/**
 * Whether she may speak about this page now. Every clause here exists to stop
 * her, and the order is cheapest-first so the common case — no, again — costs
 * almost nothing.
 */
export function mayNotice(page: Page, state: PageState, notices: NoticeRecord, sinceLastMs: number): boolean {
  return corePolicySync<any>('context-preparation.mayNotice',[page,state,notices,sinceLastMs]);
}

/** Records that she spoke, so the budget means something. */
export function noteNoticed(notices: NoticeRecord, page: Page): NoticeRecord {
  return corePolicySync<any>('context-preparation.noteNoticed',[notices,page]);
}
