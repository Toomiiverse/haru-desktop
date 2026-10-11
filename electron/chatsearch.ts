import {coreChatIndex,coreChatSearch,coreChatKeywordScores} from './core-final-chat';
import {corePolicySync} from './core-policy-sync';
// Her old chats, searched on purpose.
//
// recall.ts puts an old exchange or two in front of her unasked. That can only
// ever be a guess at what he means, and it was guessing on nearly every message:
// measured on the 44 archived days (2026-09-17), 12 of 15 small-talk lines and
// 27 of 40 of his real messages cleared its floor, and haru.log had 238 recall
// lines against 268 replies. The embedding score alone cannot tell "goodnight"
// from "what was wrong with Logan's pc" — small talk topped out at 0.56–0.76
// against 0.61–0.83 for real questions.
//
// So this is the other half, after ReFind (Li et al. 2026, "When Your Agent
// Opens the Chat App"): the raw log, and her searching it herself when he refers
// back to something — words and meaning both, a date range when she has one,
// and the exchange either side of each find so a "yeah, that one" comes with
// what it answered. The same index also tells recall.ts which words in a
// message are specific enough to be worth a guess at all (rareTerms).

import { cosine, type Exchange } from './recall';
import { isDay, withRelativeDates } from './dates';

/** Words that say nothing about what was talked about. */
const STOP = new Set(`a an the and or but if of to in on at for with from by is are was were be been being am
i im i'm ive i've id i'd ill i'll me my mine myself you your yours youre you're youve you've yourself we us our
it its it's that thats that's this these those there theres there's here what whats what's which who whom whose
when where why how did do does doing done dont don't didnt didn't doesnt doesn't have has had having not no nor
so just like about up out then than them they their theyre they're he she her him his hers its into onto over
very really too also can cant can't could would should will wont won't shall may might must get got gets going
gonna wanna want some any all more most much many one ones other such only own same few again ever still even
now well back yes yeah yep yup nah nope okay ok alright alrighty haha hahaha lol lmao omg wow hmm umm uh uhh
thanks thank sorry please hey hi hello bye goodnight night morning sweet dreams cool fine sure haru tommy`.split(/\s+/));

/** The commonest endings off, so "drives", "booted" and "batteries" meet "drive", "boot" and "battery". */
function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ed')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase words, stop words out, endings off. */
export function chatTerms(text: string): string[] {
 return corePolicySync('final-chat.terms',[text]);
}

export type ChatIndex = {
  exchanges: Exchange[];
  /** Exchange id → its place in `exchanges`. */
  position: Map<string, number>;
  counts: Map<string, number>[];
  lengths: number[];
  average: number;
  /** How many exchanges each word appears in. */
  spread: Map<string, number>;
};

export function buildChatIndex(exchanges: Exchange[]): ChatIndex {
 return coreChatIndex(exchanges);
}

/** BM25 (k1 1.2, b 0.75, ReFind's values) of every exchange against the query; 0 where no word is shared. */
export function keywordScores(index: ChatIndex, query: string): number[] {
 return coreChatKeywordScores(index,query);
}

/**
 * A word counts as specific when at most this share of all exchanges use it —
 * a name, a part, a place, the thing a message is actually about. Tuned on the
 * 44 days (1,187 exchanges, so 12 of them): with the embedding floor of 0.64 it
 * kept 27 of 40 real questions finding their exchange (30 before) and cut
 * small talk from 12 of 15 to none. Floored at 5 so a young archive is not all
 * rare.
 */
export const RARE_SHARE = 0.01;
const RARE_FLOOR = 5;

/** The specific words of `text` that some kept exchange also uses. */
export function rareTerms(index: ChatIndex, text: string): Set<string> {
 return new Set(corePolicySync<string[]>('final-chat.rare',[index.exchanges.length,Object.fromEntries(index.spread),text]));
}

/** Whether the exchange uses any of these words. */
export function mentionsAny(index: ChatIndex, id: string, terms: Set<string>): boolean {
 return corePolicySync('final-chat.mentions',[Object.fromEntries(index.counts[index.position.get(id)??-1]??new Map()),[...terms]]);
}

/**
 * The text an embedding is made from. nomic-embed-text was trained with a task
 * prefix on everything it embeds and without one it scores every pair of chat
 * lines alike; other models get the text as it is.
 */
export function embedText(model: string, kind: 'query' | 'document', text: string): string {
 return corePolicySync('final-chat.embed',[model,kind,text]);
}

/** Which vectors are comparable: the model and whether the prefixes were used. */
export function embedFormat(model: string): string {
 return corePolicySync('final-chat.embedFormat',[model]);
}

/**
 * Nearer than this in meaning counts as a find even with no word in common.
 * Searches for things never talked about (a trip to Japan, a brother called
 * Jake) topped out at 0.536–0.622 on the 44 days; the two real questions found
 * only by meaning ("that cable for the telly") scored 0.635 and 0.643.
 */
export const SEARCH_FLOOR = 0.63;
/**
 * A shared word only counts when no more than this share of exchanges use it
 * ("went" or "time" in common is not a find, "Logan" is), and, when there are
 * vectors to say so, when the exchange is at least this close in meaning too.
 * On the 44 days every real question's exchange that shared such a word scored
 * 0.613 or more; searches for things never talked about matched an odd word
 * ("return", "trip", "boat") at 0.43–0.555. At 1% rather than 5% the five finds
 * held the right exchange for 39 of the 40 questions instead of 37.
 */
export const WORD_SHARE = 0.01;
export const WORD_FLOOR = 0.56;
export const SEARCH_LIMIT = 5;

export type ChatHit = { exchange: Exchange; score: number; before?: Exchange; after?: Exchange };

/** A real calendar day (dates.ts): "2026-13-01" has the shape and would have thrown in shiftDay, failing the whole reply. */
export { isDay };
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
/** Words only — no vectors to go on — a name he uses often is still a find: "Emma" is in 28 of 1,187 exchanges. */
const WORD_SHARE_WITHOUT_MEANING = 0.05;

/**
 * The best few exchanges for a query, each with its neighbours.
 *
 * Words and meaning are ranked separately and fused by reciprocal rank, so a
 * name typed exactly and a thing described loosely both surface. A find needs a
 * shared word that says something (WORD_SHARE) or real closeness (SEARCH_FLOOR);
 * otherwise nothing comes back, which she is told to say rather than fill in. `from`/`to` are widened by a day each way:
 * the model works the dates out itself and is known to land a day out.
 */
export function searchChats(index: ChatIndex, input: { query: string; queryVector?: number[] | null; vectors: Map<string, number[]>; from?: string; to?: string; limit?: number }): ChatHit[] {
 return coreChatSearch(index,input);
}

const clip = (text: string, most: number) => text.split('\n').map(line => line.length > most ? `${line.slice(0, most - 1)}…` : line).join('\n');

/** What she is handed: each find under its date, with the exchange either side trimmed, and relative dates written out. */
export function chatHitsNote(hits: ChatHit[], weekday: Intl.DateTimeFormat): string {
 return corePolicySync('final-chat.note',[hits]);
}
