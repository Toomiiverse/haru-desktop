import {corePolicySync} from './core-policy-sync';
// Lore cards: what he wrote down about a thing, brought in when the thing comes up.
//
// The idea is SillyTavern's World Info, and Backyard's lorebook before it: a
// small card of facts with the words that call it up, put in front of the
// model only while the conversation is on that subject. What memory retrieval
// and the graph (factgraph.ts) find, they find by guessing what matters; a
// card is his own word on it, and comes up whenever its keys do.
//
// The page is his, at the vault root beside People.md:
//
//   Lore.md   - **rego, registration, car*** — The car registration renews on
//               6 October; the reminder is on his list.
//
// One bullet, one card: the bold run holds the keys, comma-separated, a
// trailing * matching any ending ("psych*" is psychologist, psych, psychiatry);
// everything after the dash is the card. A card stays up for a few of his
// messages after its key was said (sticky), so a subject that runs over three
// messages keeps its card without every message naming it. Blockquotes are
// instructions, not cards — no TODO prefix to leave on by accident
// (haru_preferences_are_not_proactive).
//
// Pure: reading the file is main.ts's.

export type LoreCard = { id: string; keys: string[]; text: string };

/** The page at the vault root. */
export const LORE_PAGE = 'Lore.md';

/** How many of his messages a card stays up after its key was said. */
export const LORE_STICKY = 3;
export const LORE_MAX_CARDS = 3;
export const LORE_MAX_CHARS = 900;

function stripFrontmatter(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.trimStart().startsWith('---')) return trimmed;
  const start = trimmed.indexOf('---');
  const end = trimmed.indexOf('\n---', start + 3);
  return end < 0 ? trimmed : trimmed.slice(end + 4);
}

/** The cards on the page. A bullet without a bold run of keys, or without text after it, is not a card. */
export function parseLorePage(text: string): LoreCard[] {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.parseLore',[text]);

  const cards: LoreCard[] = [];
  const seen = new Set<string>();
  for (const raw of stripFrontmatter(String(text ?? '')).split('\n')) {
    const line = raw.trim();
    if (!/^[-*+]\s+/.test(line)) continue;
    const match = line.replace(/^[-*+]\s+/, '').match(/^\*\*(.+?)\*\*\s*[—–:-]\s*(.+)$/);
    if (!match) continue;
    const keys = [...new Set(match[1].split(',').map(key => key.trim().toLowerCase()).filter(key => key.replace(/\*$/, '').length >= 2))];
    const body = match[2].trim();
    if (!keys.length || body.length < 3) continue;
    const id = keys.join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    cards.push({ id, keys, text: body.slice(0, 600) });
  }
  return cards;
}

function searchable(text: string): string {
  return ` ${String(text ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9*]+/g, ' ').trim()} `;
}

/** Whether a key is said in the text: whole words, a trailing * matching any ending. */
export function keySaid(key: string, text: string): boolean {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.keySaid',[key,text]);

  // His text loses its asterisks — only a key's trailing * is a wildcard.
  // Kept, "*rego*" or "**rego**" never matched the rego card (review, 2026-09-17).
  const hay = searchable(String(text ?? '').replace(/\*/g, ' '));
  const wild = key.endsWith('*');
  const words = searchable(key.replace(/\*$/, '')).trim().split(' ').filter(Boolean);
  if (!words.length) return false;
  const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`\\s${escaped}${wild ? '[a-z0-9]*' : 's?'}(?=\\s)`).test(hay);
}

/**
 * The cards in front of her this turn, and what stays up for the next.
 * `memory` maps card id to how many more of his messages it stays for.
 * Cards whose key was just said come first; a sticky one fills what is left.
 */
export function activeCards(cards: LoreCard[], latest: string, memory: Map<string, number>, { sticky = LORE_STICKY, maxCards = LORE_MAX_CARDS, maxChars = LORE_MAX_CHARS } = {}): { cards: LoreCard[]; memory: Map<string, number>; triggered: string[] } {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on'){const p=corePolicySync<any>('conversation-inputs.activeCards',[cards,latest,[...memory],{sticky,maxCards,maxChars}]);return {...p,memory:new Map(p.memory)};}

  const next = new Map<string, number>();
  const triggered = cards.filter(card => card.keys.some(key => keySaid(key, latest)));
  for (const card of cards) {
    if (triggered.includes(card)) next.set(card.id, sticky);
    else if ((memory.get(card.id) ?? 0) > 1) next.set(card.id, (memory.get(card.id) ?? 0) - 1);
  }
  const ordered = [...triggered, ...cards.filter(card => !triggered.includes(card) && next.has(card.id))];
  const shown: LoreCard[] = [];
  let size = 0;
  for (const card of ordered) {
    if (shown.length >= maxCards || size + card.text.length > maxChars) break;
    shown.push(card);
    size += card.text.length;
  }
  return { cards: shown, memory: next, triggered: triggered.map(card => card.id) };
}

export function loreNote(cards: LoreCard[]): string {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.loreNote',[cards]);

  if (!cards.length) return '';
  return `From his own notes on what just came up — his word on it, true unless he says otherwise; use what fits and never read it out:\n${cards.map(card => `- ${card.text}`).join('\n')}`;
}

/** The page as it is first written: how to add a card, and none yet. */
export const LORE_TEMPLATE = `---
tags: [haru/lore]
---

# Lore — what Haru should know when something comes up

> One bullet per card: \`- **key, other key, prefix*** — what she should know\`.
> When one of the keys is in your message, the card is in front of her for that message and the next two.
> Keys are whole words and ignore case; a trailing \`*\` matches any ending (\`psych*\` → psychologist, psych).
> Keep a card to a sentence or two. Lines in a quote like this one are not cards.
> Read on every message — an edit counts from the next one.

`;
