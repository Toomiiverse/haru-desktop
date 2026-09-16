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
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<RevoiceState>;
  const rewrites: Record<string, Revoice> = {};
  for (const [id, value] of Object.entries(record.rewrites ?? {})) {
    if (value && typeof value.text === 'string' && typeof value.original === 'string') rewrites[id] = { id, original: value.original, text: value.text, at: typeof value.at === 'string' ? value.at : '' };
  }
  return { lastAt: typeof record.lastAt === 'string' ? record.lastAt : null, rewrites };
}

/** Each reply of hers with the message of his it answered, newest last. */
export function exchangesFrom(turns: Turn[], limit = REVOICE_WINDOW): Exchange[] {
  const out: Exchange[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== 'assistant' || !turn.id || !turn.content?.trim()) continue;
    let theirs = '';
    for (let j = i - 1; j >= 0; j--) { if (turns[j].role === 'user') { theirs = turns[j].content ?? ''; break; } }
    out.push({ id: turn.id, theirs, hers: turn.content, ...(turn.at ? { at: turn.at } : {}), ...(turn.reaction === 'up' || turn.reaction === 'down' ? { reaction: turn.reaction } : {}) });
  }
  return out.slice(-limit);
}

export function dueForRevoice(messagesSince: number, every = REVOICE_EVERY): boolean {
  return every > 0 && messagesSince >= every;
}

/** The brief to the voice model: who she is, how she writes, and what may and may not change. */
export function revoicePrompt(persona: { identity: string; style: string }, howSheWrites: string, exchanges: Exchange[], limit = REVOICE_LIMIT): { system: string; user: string } {
  const system = [
    'You are editing the transcript of a companion called Haru so that her past replies read the way she would actually have said them. You are not answering; you are her voice, applied after the fact.',
    `Who she is: ${persona.identity}`,
    `How she carries herself: ${persona.style}`,
    `How she writes: ${howSheWrites}`,
    `What falls short, in his own words: "What's with your short replies" and "Kind of want you to act like you actually care." So the replies to rewrite are the ones where he shared news, effort, good news or a bad day and got a grunt or an order back ("Good. Now hand it over."); where he said he just wanted to talk and she treated it as an excuse; where she answered like an assistant; where she ended on a chore, an order, or a question handing the subject back to him; where the bite had no care under it. Leave alone anything that already reads as her, and leave alone anything factual she got wrong — that is not yours to fix. Rewrite at most ${limit}, the worst first.`,
    'A rewrite is a different reply, not a tidier one. It keeps the facts and changes the shape: what she notices, where the warmth shows, how it ends. If you would keep more than two thirds of the words, do not touch it — a copy-edit is worthless here and will be thrown away. Bite stays; it is bite with the care visible, said once and not taken back.',
    'He has rated some of her replies himself. One marked "he said this fell flat" is the first to rewrite; one marked "he liked this one" is his favourite of hers as it stands — never rewrite it.',
    'Every rewrite is in her first person — "I", never her name, never third person about herself. She is the one who said it.',
    'A rewrite keeps every fact exactly: the same events, names, places, numbers, times, promises and opinions as the original, and nothing new — no new plans, no new claims about him or about her, nothing she did not say. About the same length as the original, never more than twice it. Her emoji are 😏 👀 😤 💢 😒 🔥 🙄, at most one, and only where it bites.',
    'Answer with JSON only, no prose and no code fence: an array of objects, each {"id": "<the id shown>", "text": "<her reply, rewritten>"}. An empty array if nothing needs it.',
  ].join('\n\n');
  const rated = (exchange: Exchange) => (exchange.reaction === 'down' ? '\n(he said this fell flat)' : exchange.reaction === 'up' ? '\n(he liked this one)' : '');
  const user = exchanges.map(exchange => `#${exchange.id}\nHim: ${exchange.theirs || '(nothing — she spoke first)'}\nHer: ${exchange.hers}${rated(exchange)}`).join('\n\n');
  return { system, user };
}

/** The model's answer, as rewrites of exchanges it was actually shown. */
export function parseRevoices(text: string, exchanges: Exchange[]): { id: string; text: string }[] {
  const body = (text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = body.indexOf('['); const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const known = new Map(exchanges.map(exchange => [exchange.id, exchange]));
  const out: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const id = String((item as { id?: unknown })?.id ?? '').replace(/^#/, '').trim();
    const rewritten = String((item as { text?: unknown })?.text ?? '').trim();
    if (!known.has(id) || seen.has(id) || !rewritten) continue;
    // A reply he gave a thumbs up is his favourite of hers as it is, whatever the voice model thinks of it.
    if (known.get(id)?.reaction === 'up') continue;
    seen.add(id);
    out.push({ id, text: rewritten });
  }
  return out;
}

/** A rewrite that keeps more than two thirds of the words is a copy-edit, and a copy-edit teaches her nothing. */
export function changedEnough(original: string, text: string): boolean {
  const words = (value: string) => value.toLowerCase().replace(/[^\p{Letter}\p{Number}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  const a = words(original); const b = new Set(words(text));
  if (!a.length) return true;
  const kept = a.filter(word => b.has(word)).length;
  return kept / a.length <= 2 / 3;
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
  const clean = (text ?? '').trim();
  if (clean.length < 3 || clean === original.trim()) return false;
  if (clean.length > Math.max(60, original.length * 2 + 40)) return false;
  if (NEVER_IN_A_REWRITE.test(clean)) return false;
  if (!changedEnough(original, clean)) return false;
  const known = `${original} ${theirs} ${alsoAllowed.join(' ')}`.toLowerCase();
  // The first word of a sentence is capitalised for free — "That is not
  // nothing" names nobody — so only what is capitalised mid-sentence, and
  // every number, has to be accounted for.
  for (const sentence of clean.split(/(?<=[.!?…])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    const first = words.findIndex(word => /\p{Letter}/u.test(word));
    for (const [index, word] of words.entries()) {
      for (const token of word.match(NAME_OR_NUMBER) ?? []) {
        if (index === first && !/^\d/.test(token) && !/^[A-Z]{2,}/.test(token)) continue;
        if (!known.includes(token.toLowerCase())) return false;
      }
    }
  }
  return true;
}

/** The conversation with her rewritten replies in place of the originals — by id, or by the exact words when the id is not carried. */
export function applyRevoices<T extends Turn>(conversation: T[], rewrites: Record<string, Revoice>): { shown: T[]; applied: number } {
  const byText = new Map(Object.values(rewrites).map(rewrite => [rewrite.original, rewrite]));
  let applied = 0;
  const shown = conversation.map(turn => {
    if (turn.role !== 'assistant') return turn;
    const match = (turn.id && rewrites[turn.id]) || byText.get(turn.content);
    if (!match) return turn;
    applied++;
    return { ...turn, content: match.text };
  });
  return { shown, applied };
}

/** The state with a pass's rewrites folded in, the oldest dropped past the cap. */
export function withRewrites(state: RevoiceState, fresh: Revoice[], now: string, keep = REVOICES_KEPT): RevoiceState {
  const rewrites = { ...state.rewrites };
  for (const rewrite of fresh) rewrites[rewrite.id] = rewrite;
  const kept = Object.values(rewrites).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, keep);
  return { lastAt: now, rewrites: Object.fromEntries(kept.map(rewrite => [rewrite.id, rewrite])) };
}
