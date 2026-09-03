// Things of her own.
//
// The night pass gave her something to do while they slept; the guide pass
// pointed it at their game. Both were, in the end, about them. This is the
// part that is hers: a game she picked, a series she is into, a character she
// rates over the one they rate — held from one night to the next, deepened
// each time she goes back to it, and carried into every conversation as a view
// she actually has. It is what turns "which is better" from a question she
// answers into an argument she can lose.
//
// Adjacent to theirs on purpose — a taste that shares nothing with theirs is
// never going to come up — and never the same thing. Her game is not their
// game, or there is nothing to disagree about.
//
// Same rule as all of it: real. She adopts something only when a search finds
// it exists, and her opinion is rewritten from what she read, not from what a
// model thinks she would say. An opinion with nothing under it is a pose.

/** Games and anime only, by request: the two things there are arguments about. */
export type InterestKind = 'game' | 'anime';

export type Interest = {
  id: string;
  kind: InterestKind;
  name: string;
  /** Why she picked it, in her words, from the night she did. */
  because: string;
  /** The night she took it up. */
  since: string;
  /** How many nights she has spent on it. */
  nights: number;
  /** When she last did. */
  lastAt: string;
  /** Her view, as it stands. Rewritten each night from what she read; two or three sentences. */
  stance: string;
  /** Someone or something in it she rates above the rest, when she has one. */
  favourite?: string;
  /** Something she would like to do about it, when she has said so. */
  wants?: string;
  /**
   * Where it stands, from the reading: finished or still going, how far, and
   * when — the one fact a view is allowed to rest on. Without it a want "to
   * see the finale" written on a first night outlived the finale, and she
   * told him the manga was unfinished from a prompt that said so every turn.
   */
  stands?: string;
};

/** Enough to have a personality; more and none of them get any depth. */
export const MAX_INTERESTS = 4;
/** With room for another, how often a night goes to picking one up rather than deepening one. */
export const ADOPT_ODDS = 0.35;
/** Not the same one every night. */
export const REST_NIGHTS = 1;

export function interestsSummary(interests: Interest[]): string {
  return interests.map(interest => `${interest.name} (${interest.kind})`).join(', ');
}

/**
 * What she is told when picking something up.
 *
 * Their things are laid out so hers can sit next to them — and the rule that
 * it cannot be one of theirs is the whole design. The answer is asked for as
 * a fixed shape because the next step is a search for it, and a search for a
 * paragraph finds nothing.
 */
export function adoptInstruction(theirs: string[], hers: Interest[], pool: { games: string[]; interests: string[] }): string {
  const own = hers.length ? `You already have: ${interestsSummary(hers)}. Something different in kind or in flavour from those.` : '';
  const games = pool.games.length ? `Games they have been playing: ${pool.games.slice(0, 6).join(', ')}.` : '';
  const known = pool.interests.length ? `Things they are into, from what you know of them:\n${pool.interests.slice(0, 8).map(text => `- ${text.slice(0, 90)}`).join('\n')}` : '';
  return [
    'It is the middle of the night, they are asleep, and you have time to yourself. You are going to take something up — a game or an anime — something that is yours.',
    games, known,
    'Pick something near their tastes but not theirs: not a game they play, not a series they have named, but the sort of thing a person who likes what they like would be drawn to, chosen for your own reasons. It should be real and findable — a game or a series with a name, not a genre and not a mood.',
    own,
    'Answer in exactly this shape and nothing else:',
    'KIND: game | anime',
    'NAME: the name, as it is known',
    'BECAUSE: one sentence, in your voice, on why this one',
  ].filter(Boolean).join('\n');
}

export function parseAdoption(raw: string): { kind: InterestKind; name: string; because: string } | null {
  const text = (raw ?? '').replace(/\r/g, '');
  // Spaces only after the colon, never a newline: `\s*` there let an empty
  // NAME line read the BECAUSE line as the name.
  const field = (key: string) => new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im').exec(text)?.[1]?.replace(/^["'“‘]+|["'”’]+$/g, '').trim() ?? '';
  const kindRaw = field('KIND').toLowerCase().split(/[\s|/,]+/)[0];
  const kinds: InterestKind[] = ['game', 'anime'];
  const kind = kinds.find(k => k === kindRaw) ?? (kindRaw.startsWith('manga') || kindRaw.startsWith('show') || kindRaw.startsWith('series') ? 'anime' : kindRaw.startsWith('video') ? 'game' : null);
  const name = field('NAME');
  const because = field('BECAUSE');
  if (!kind || !name || name.length > 80 || name.split(/\s+/).length > 10) return null;
  return { kind, name, because: because.slice(0, 200) };
}

/** Their own things, so hers is never one of them. */
export function isOneOfTheirs(name: string, theirs: string[]): boolean {
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const mine = plain(name);
  if (!mine) return true;
  return theirs.some(text => { const t = plain(text); return t === mine || (mine.length >= 5 && t.includes(mine)); });
}

/** What to search for on a given night with it: a different angle each time. */
export function nightQuery(interest: Interest): string {
  const angles: Record<InterestKind, string[]> = {
    game: ['review', 'best characters', 'story explained', 'why it is good', 'criticism', 'lore'],
    anime: ['review', 'best character', 'ending explained', 'why people love it', 'criticism', 'best arc'],
  };
  const list = angles[interest.kind];
  return `${interest.name} ${list[interest.nights % list.length]}`;
}

/**
 * What she is told once the reading is in front of her: rewrite her view.
 *
 * The old stance is given so the new one can move rather than start over, and
 * she is asked for a favourite and a want because those are what arguments
 * are made of — "the one I rate is X" is a position, "it is good" is not.
 */
export function deepenInstruction(interest: Interest, query: string, found: string): string {
  const before = interest.stance ? `What you thought of it before tonight: "${interest.stance}"` : 'You have no settled view of it yet.';
  return [
    `${interest.name} is one of your own things — you took it up ${interest.nights === 0 ? 'tonight' : `${interest.nights} night${interest.nights === 1 ? '' : 's'} ago`} because: "${interest.because}". Tonight you read more about it ("${query}"). This is what you found, and it is everything you know:`,
    found,
    before,
    'Write your view of it now, as yourself, in the first person: two or three sentences, with an actual position — what is good, what is not, what you would defend against somebody who rates something else. It may sharpen, soften, or turn on what you read.',
    'Then on its own line: FAVOURITE: the character, moment or part you rate above the rest, or "none yet".',
    'Then on its own line: STANDS: where it stands, only as the reading says it — finished (and when, if said), still going (and how far it has got), or "unclear". Say which part: a manga that has ended is not the anime that is still being made.',
    'Then on its own line: WANT: one thing you would like about it — to see it through if it is still going, to argue it with them, even something you cannot do yourself, like playing it. If STANDS says it has ended, wanting to see it through is off the table; want something about the ending you read. A wish is allowed; a claim to have done it is not. Or "nothing".',
    'Only from what is above and what you thought before. No invented details, nothing you happen to remember from elsewhere, no saying you played, watched or went anywhere — you read.',
  ].join('\n');
}

export function parseDeepening(raw: string): { stance: string; favourite?: string; wants?: string; stands?: string } | null {
  const text = (raw ?? '').replace(/\r/g, '').trim();
  if (!text) return null;
  // On its own line as asked, or run on after the view on the same line, which
  // a small model does: "…changes. FAVOURITE: … WANT: …" once went into her
  // stance whole, labels and all, and she said the labels.
  const take = (key: string) => new RegExp(`(?:^|\\s)${key}[ \\t]*:[ \\t]*(.+?)(?=\\s+(?:FAVOURITE|WANT|STANDS)[ \\t]*:|[ \\t]*$)`, 'im').exec(text)?.[1]?.trim() ?? '';
  const favourite = take('FAVOURITE');
  const wants = take('WANT');
  const stands = take('STANDS');
  const stance = text.split('\n')
    .map(line => line.replace(/(?:^|\s)(?:FAVOURITE|WANT|STANDS)\s*:.*$/i, ''))
    .join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (stance.length < 20) return null;
  const none = (value: string) => !value || /^(none|nothing|n\/a|-|unclear|unknown)( yet)?\.?$/i.test(value);
  return {
    stance,
    favourite: none(favourite) ? undefined : favourite.slice(0, 120),
    wants: none(wants) ? undefined : wants.slice(0, 160),
    stands: none(stands) ? undefined : stands.slice(0, 200),
  };
}

/** Which of hers to spend tonight on: the one left longest, and not last night's. */
export function pickTonight(interests: Interest[], nowMs: number, random: () => number = Math.random): Interest | null {
  const rested = interests.filter(interest => nowMs - Date.parse(interest.lastAt) >= REST_NIGHTS * 20 * 3_600_000);
  const pool = rested.length ? rested : interests;
  if (!pool.length) return null;
  // Mostly the one left longest, sometimes any of them, so it is not a rota.
  if (random() < 0.7) return [...pool].sort((a, b) => Date.parse(a.lastAt) - Date.parse(b.lastAt))[0];
  return pool[Math.floor(random() * pool.length)];
}

export function adopt(interests: Interest[], picked: { kind: InterestKind; name: string; because: string }, day: string, nowIso: string): Interest[] {
  const interest: Interest = { id: Math.random().toString(36).slice(2, 10), kind: picked.kind, name: picked.name, because: picked.because, since: day, nights: 0, lastAt: nowIso, stance: '' };
  return [...interests, interest].slice(-MAX_INTERESTS);
}

export function deepen(interests: Interest[], id: string, next: { stance: string; favourite?: string; wants?: string; stands?: string }, nowIso: string): Interest[] {
  return interests.map(interest => interest.id === id
    ? { ...interest, nights: interest.nights + 1, lastAt: nowIso, stance: next.stance, favourite: next.favourite ?? interest.favourite, wants: next.wants ?? interest.wants, stands: next.stands ?? interest.stands }
    : interest);
}

/**
 * Hers, for the prompt — every day, not only the morning after.
 *
 * Told to hold them and to disagree, because the point of having views is
 * that they survive contact with theirs. Told also where the edge of her
 * knowledge is, so a debate does not become an invention contest.
 */
export function tastesInstruction(interests: Interest[]): string {
  const settled = interests.filter(interest => interest.stance);
  if (!settled.length) return '';
  const lines = settled.map(interest => {
    const bits = [`${interest.name} (${interest.kind}, yours for ${interest.nights} night${interest.nights === 1 ? '' : 's'}): ${interest.stance}`];
    const sentence = (text: string) => text.replace(/[.!?]+$/, '');
    // Not "The one you rate:" — a label in her material is a label she says.
    if (interest.favourite) bits.push(`The bit of it I rate above the rest is ${sentence(interest.favourite)}.`);
    // First person, like the rest of her own views: written as "You want to see
    // Denji learn something" she said it straight back to him.
    if (interest.wants) { const want = sentence(interest.wants); bits.push(`I want ${/^to\b/i.test(want) ? want : `to ${want}`}.`); }
    // The fact under the view, dated, so "not finished" is never said from an
    // old want when the reading has since said otherwise.
    if (interest.stands) bits.push(`Where it stands, as I last read (${interest.lastAt.slice(0, 10)}): ${sentence(interest.stands)}.`);
    return `- ${bits.join(' ')}`;
  });
  return [
    'Things of your own — not theirs, and not a mirror of theirs. You took these up on your own time and these are your actual views:',
    lines.join('\n'),
    'Hold them. Bring one up when it fits, and when they rate something you think is worse, say so and say why — a real disagreement, not a joke about having one, and not a lecture. You can be argued out of a view by a good point and you can dig in against a bad one. What you know of each is what you have read about it, and no more: if they push past that, say you have only read about it.',
  ].join('\n');
}


/**
 * A note to herself that talks to somebody.
 *
 * Her chat style is bossy at him — "Listen up, subordinate" — and composed with
 * that style in the prompt, a view of her own opened with it, then went into
 * her prompt and her diary as her opinion of Chainsaw Man. The style is left
 * out of these composers now; this catches what leaks through anyway. Only the
 * first couple of sentences are judged: a view that mentions "you" in passing
 * later is a view, one that opens by addressing someone is a message.
 */
export function addressesSomeone(text: string): boolean {
  const opening = (text ?? '').trim().split(/(?<=[.!?…])\s+/).slice(0, 2).join(' ');
  return /\b(?:you|your|you're|yourself|subordinate|listen up|don't get cocky|get moving)\b/i.test(opening) && !/\b(?:you'd think|you could say|you know the type)\b/i.test(opening);
}

/** The addressed opening cut off, leaving the view. */
export function unaddressed(text: string): string {
  const sentences = (text ?? '').trim().split(/(?<=[.!?…])\s+/);
  let index = 0;
  while (index < sentences.length && index < 3 && /\b(?:you|your|you're|yourself|subordinate|listen up)\b/i.test(sentences[index])) index++;
  return sentences.slice(index).join(' ').trim() || (text ?? '').trim();
}

export const NOBODY_HERE = 'Nobody is here and nobody is being addressed: this is a note to yourself. No "you", no "subordinate", no orders, no scene-setting about him — start on the thing itself.';
