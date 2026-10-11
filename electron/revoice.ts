import {corePolicySync} from './core-policy-sync';
// Her past replies, said again the way she would have said them.
//
// She copies what she can see over what she is told: that is the finding of
// every rewrite of her shown history (seed.ts), and it is why the emoji rut and
// the sign-off orders broke only when the transcript she reads was changed.
// This turns that into a source of voice. Every so often a model with a better
// voice than the one answering live — Aion, built for character — reads her
// last few dozen exchanges and rewrites the ones that fell short: curt where
// he shared news, assistant-like, ended on an order, bite with none of the
// care underneath. The rewrites replace those replies in the history as shown
// to her, and nowhere else: what he read stays what he read. The live model
// then imitates a better version of herself, at its own speed and price.
//
// The one rule that cannot bend is the nights rule: she must not gain a past
// that did not happen. A rewrite may change the voice and nothing else, and
// any new name, number or claim in it is grounds to drop it unread.

export type Turn = { id?: string; role: string; content: string; at?: string; reaction?: string };
/** `reaction` is his thumb on her reply, when he gave one. */
export type Exchange = { id: string; theirs: string; hers: string; at?: string; reaction?: 'up' | 'down' };
export type Revoice = { id: string; original: string; text: string; at: string };
export type RevoiceState = { lastAt: string | null; rewrites: Record<string, Revoice> };

/** How many of his messages between passes, by default. A setting, because the right number is the one he picks after seeing a pass. */
export const REVOICE_EVERY = 500;
/** How many exchanges the voice model is shown. */
export const REVOICE_WINDOW = 40;
/** How many of her replies one pass may rewrite. */
export const REVOICE_LIMIT = 8;
/** How many rewrites are kept. Older than the history she is shown, they do nothing. */
export const REVOICES_KEPT = 60;

export const EMPTY_REVOICE: RevoiceState = { lastAt: null, rewrites: {} };

export function readRevoiceState(saved: unknown): RevoiceState {
  return corePolicySync<any>('conversation-policy.readRevoiceState',[saved]);
}

/** Each reply of hers with the message of his it answered, newest last. */
export function exchangesFrom(turns: Turn[], limit = REVOICE_WINDOW): Exchange[] {
  return corePolicySync<any>('conversation-policy.exchangesFrom',[turns,limit]);
}

export function dueForRevoice(messagesSince: number, every = REVOICE_EVERY): boolean {
  return corePolicySync<any>('conversation-policy.dueForRevoice',[messagesSince,every]);
}

/** The brief to the voice model: who she is, how she writes, and what may and may not change. */
export function revoicePrompt(persona: { identity: string; style: string }, howSheWrites: string, exchanges: Exchange[], limit = REVOICE_LIMIT): { system: string; user: string } {
  return corePolicySync<any>('conversation-policy.revoicePrompt',[persona,howSheWrites,exchanges,limit]);
}

/** The model's answer, as rewrites of exchanges it was actually shown. */
export function parseRevoices(text: string, exchanges: Exchange[]): { id: string; text: string }[] {
  return corePolicySync<any>('conversation-policy.parseRevoices',[text,exchanges]);
}

/** A rewrite that keeps more than two thirds of the words is a copy-edit, and a copy-edit teaches her nothing. */
export function changedEnough(original: string, text: string): boolean {
  return corePolicySync<any>('conversation-policy.changedEnough',[original,text]);
}

const NAME_OR_NUMBER = /\b(?:[A-Z][a-z]{2,}|[A-Z]{2,}[a-z]*|\d[\d.,:]*)\b/g;
const NEVER_IN_A_REWRITE = /https?:\/\/|\binstructions?\b|\bthe note\b|\brewrit(?:e|ten)\b|\bas an ai\b|\[[^\]]*\]\(/i;

/**
 * Whether a rewrite changed only the voice.
 *
 * Every name and number in it must already be in the original or in what he
 * said; a new one is a new fact, and a new fact is a past she did not have.
 * Too long, empty, unchanged, or carrying a link or a word about the editing
 * itself, and it is dropped the same way.
 */
export function grounded(original: string, theirs: string, text: string, alsoAllowed: string[] = []): boolean {
  return corePolicySync<any>('conversation-policy.grounded',[original,theirs,text,alsoAllowed]);
}

/** The conversation with her rewritten replies in place of the originals — by id, or by the exact words when the id is not carried. */
export function applyRevoices<T extends Turn>(conversation: T[], rewrites: Record<string, Revoice>): { shown: T[]; applied: number } {
  return corePolicySync<any>('conversation-policy.applyRevoices',[conversation,rewrites]);
}

/** The state with a pass's rewrites folded in, the oldest dropped past the cap. */
export function withRewrites(state: RevoiceState, fresh: Revoice[], now: string, keep = REVOICES_KEPT): RevoiceState {
  return corePolicySync<any>('conversation-policy.withRewrites',[state,fresh,now,keep]);
}
