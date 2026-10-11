import {coreExchanges,corePickRecalled} from './core-final-recall';
import {corePolicySync} from './core-policy-sync';
// What she said weeks ago, found again.
//
// The last few days of conversation go into the prompt whole (history.ts), and
// everything older became a one-line summary of the day. That is thirty days
// and two and a half thousand messages on disk that she cannot reach: asked
// about the motherboard she picked up in Belmont a fortnight ago she has the
// sentence "they did errands and talked about hardware" and nothing else.
//
// So the older days are cut into exchanges — one thing he said and what she
// said back — embedded once, and searched per turn against what he has just
// asked. Only a handful come back, only when they are actually close to the
// question, and never from a day already in the prompt.
//
// Unasked, so it has to be sure. Since 2026-09-17 it needs the message to name
// something specific that the old exchange names too (chatsearch.ts rareTerms),
// and only two come back: the embedding score alone fired on nearly every
// message, small talk included. When he refers back to something without naming
// it, search_chats is hers to use instead.

import { withRelativeDates } from './dates';

export type Exchange = { id: string; day: string; text: string };

/**
 * Enough of a match to be the thing he means; below this it is a coincidence.
 * For nomic-embed-text with its search prefixes (chatsearch.ts embedText), and
 * only alongside a shared specific word — see RARE_SHARE for what that bought.
 */
export const RECALL_FLOOR = 0.64;
/** How many come back at most: this is a jog of the memory, not a transcript. */
export const RECALL_LIMIT = 2;
/** Nothing older than this: past a couple of months it is a different life. */
export const RECALL_DAYS = 60;

const clean = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The archive as searchable exchanges, newest day last.
 *
 * One exchange is what he said and her answer to it, which is the smallest
 * piece that still makes sense on its own — a lone "yeah, fine" retrieved
 * without its question is worse than nothing.
 */
export function exchangesFrom(archive: Record<string, { role?: string; content?: string }[]>, before: string[], todayKey: string, days = RECALL_DAYS): Exchange[] {
 return coreExchanges(archive,before,todayKey,days);
}

export function cosine(a: number[], b: number[]): number {
 return corePolicySync('final-recall.cosine',[a,b]);
}

/** The closest few, best first, and none that is merely nearby — or, given `shares`, that is not about the same thing. */
export function pickRecalled(exchanges: Exchange[], vectors: Map<string, number[]>, query: number[], limit = RECALL_LIMIT, floor = RECALL_FLOOR, shares?: (exchange: Exchange) => boolean): { exchange: Exchange; score: number }[] {
 return corePickRecalled(exchanges,vectors,query,limit,floor,shares);
}

/**
 * What she is told about them. Dated, because an exchange from three weeks ago
 * read as current is the whole reason time gaps are marked at all, and framed
 * as a record rather than as something she remembers word for word.
 */
export function recallNote(found: { exchange: Exchange; score: number }[], weekday: Intl.DateTimeFormat): string {
 return corePolicySync('final-recall.note',[found]);
}
