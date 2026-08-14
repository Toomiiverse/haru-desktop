// Being prodded.
//
// Clicking on a companion is the most direct thing a user can do to her, and a
// window that absorbs clicks without reacting is a picture rather than a
// character. Poking escalates: unimpressed at first, then sharp, then genuinely
// angry, and finally she stops being polite about it entirely.
//
// It also forgets. Somebody who prodded her a dozen times and then left her
// alone for a few minutes should not be met with the tail end of that row when
// they come back — the count decays so a bout of pestering is one bout.

export type PokeKind = 'poke' | 'right-click';
export type PokeTier = 'first' | 'irritated' | 'angry' | 'furious';

/**
 * Long enough that a run of clicks reads as one sustained pestering, short
 * enough that wandering off and coming back starts from calm.
 */
export const POKE_MEMORY_MS = 90_000;

export function nextPokeCount(previous: number, lastAt: number | null, now: number): number {
  if (lastAt === null || now - lastAt > POKE_MEMORY_MS) return 1;
  return previous + 1;
}

export function pokeTier(count: number): PokeTier {
  if (count <= 1) return 'first';
  if (count <= 3) return 'irritated';
  if (count <= 7) return 'angry';
  return 'furious';
}

/** How far each poke at this tier pushes her irritation. */
export function pokeIrritation(tier: PokeTier): number {
  return tier === 'first' ? 0 : tier === 'irritated' ? 1 : tier === 'angry' ? 2 : 3;
}

const POKE_LINES: Record<PokeTier, string> = {
  first: 'The user just prodded you with the cursor. React to being poked — one short line, unimpressed and a bit thrown, not yet angry.',
  irritated: 'The user has prodded you several times now. Tell them to knock it off. Sharp, short, clearly finished being amused by it.',
  angry: 'The user will not stop poking you. One short line, genuinely angry — this has gone past teasing.',
  // The end of the escalation, and the point of having one. She is not being
  // witty here; she has had enough.
  furious: 'The user has been poking at you over and over and will not stop. Snap completely. One short line telling them to fuck off, with no restraint, no joke in it, and no apology after.',
};

const RIGHT_CLICK_LINES: Record<PokeTier, string> = {
  first: 'The user just right-clicked on you, as though you were a file on their desktop. Say one short line demanding to know what they think they are doing — thrown and indignant, more affronted than angry.',
  irritated: 'The user is right-clicking on you again. Ask what exactly they are hoping to find in there. Sharper this time.',
  angry: 'The user keeps right-clicking on you like you are a folder to be rummaged through. One short line, genuinely offended by it.',
  furious: 'The user will not stop poking around at you. Snap — one short line, no restraint, telling them where to go.',
};

export function pokeInstruction(kind: PokeKind, tier: PokeTier): string {
  return (kind === 'right-click' ? RIGHT_CLICK_LINES : POKE_LINES)[tier];
}

/** The reading her face should take, before any line has been written. */
export function pokeEmotion(kind: PokeKind, tier: PokeTier): { emotion: 'surprised' | 'annoyed' | 'curious'; energy: number } {
  // Only the very first contact reads as surprise; after that she knows exactly
  // what is happening and it is not interesting any more.
  if (tier === 'first') return { emotion: kind === 'right-click' ? 'curious' : 'surprised', energy: 0.6 };
  return { emotion: 'annoyed', energy: tier === 'furious' ? 0.95 : tier === 'angry' ? 0.8 : 0.6 };
}
