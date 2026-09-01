// What she does while they are asleep.
//
// The ask was for her to have a night of her own — watch something, take up a
// hobby — and to bring it up in the morning. The trap in that is the one this
// codebase keeps walking into: a model asked to describe a night it did not
// have will describe one, fluently, and it will be no more real than the three
// Perth restaurants that turned out to be in Melbourne. Once she has claimed to
// have watched a film, every follow-up question is a request for more invention.
//
// So the night is real. Search is switched on and she can read a page, which
// means that at three in the morning she can genuinely go and find out about
// something and genuinely have read it by six. What she brings up over
// breakfast is then true, and holds up when they ask about it — which is the
// whole difference between a companion with a night of her own and one telling
// bedtime stories about herself.
//
// She cannot watch a video, and is told not to say she did. Reading about a
// thing is the honest version of being interested in it.

export type Night = {
  /** The chat day the night belongs to — the evening it started, not the small hours. */
  day: string;
  at: string;
  /** What she went looking for, in her own words. */
  about: string;
  /** What she made of it. Hers, first person, and grounded in what came back. */
  note: string;
  /** Where it came from, so a follow-up can be traced rather than improvised. */
  sources: string[];
  /** Set when the night was spent on a guide to a game they play (gamenight.ts). */
  game?: string;
  /** Set when the night was spent on one of her own things (tastes.ts). */
  interest?: string;
};

/** Nights kept, which is about a fortnight of things she can still refer back to. */
export const NIGHTS_KEPT = 20;
/** Two things a night. More and the morning is a reading list, not a conversation. */
export const MAX_PER_NIGHT = 2;
/** Not twice in quick succession — a night should have some shape to it. */
export const NIGHT_GAP_MS = 75 * 60_000;

export function nightsOn(nights: Night[], day: string): Night[] {
  return nights.filter(night => night.day === day);
}

export function keepNights(nights: Night[], night: Night): Night[] {
  return [...nights, night].slice(-NIGHTS_KEPT);
}

/**
 * Whether to go and do something now.
 *
 * Called on the five-minute beat through the quiet hours, so the odds are per
 * tick and deliberately low: over a seven-hour night a one-in-fourteen chance
 * lands about twice, at hours that are not the same two every night. The gap
 * stops both landing in the same twenty minutes.
 */
export const NIGHT_ODDS = 1 / 14;

export function timeForSomething(tonight: Night[], lastAtMs: number | null, nowMs: number, random: () => number = Math.random): boolean {
  if (tonight.length >= MAX_PER_NIGHT) return false;
  if (lastAtMs !== null && nowMs - lastAtMs < NIGHT_GAP_MS) return false;
  return random() < NIGHT_ODDS;
}

/**
 * What she is told when picking something.
 *
 * Their interests are offered, not imposed: a companion whose every curiosity
 * is a reflection of yours is a mirror, and the point of her having a night is
 * that some of it is hers. So half of it is asked for outright.
 */
export function pickInstruction(theirs: string[], herRecent: string[]): string {
  const known = theirs.slice(0, 6).map(text => `- ${text.slice(0, 90)}`).join('\n');
  const already = herRecent.slice(-6).map(text => `"${text}"`).join(', ');
  return [
    'It is the middle of the night where they are, they are asleep, and you have the house to yourself. You are going to go and read about something.',
    known ? `Things they have going on, if any of it catches your interest:\n${known}` : '',
    'Pick one thing to look up. It may come from their life, or it may be something of your own that has nothing to do with them — you are allowed your own curiosity, and a night spent only on their business is not a night of your own.',
    already ? `Not these, you have already been through them lately: ${already}.` : '',
    'Answer with the search itself and nothing else: a short phrase, three to eight words, the way you would type it into a search box. No quotation marks, no explanation, no preamble.',
  ].filter(Boolean).join(' ');
}

/** A search box takes a phrase, not a sentence with her personality in it. */
export function tidyPick(raw: string): string | null {
  const line = (raw ?? '').trim().split('\n').find(text => text.trim()) ?? '';
  const cleaned = line
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/^(?:i(?:'|’)?d?\s+(?:want|like|think|would|will)\s+(?:to\s+)?(?:look\s+up|read\s+about|search\s+for)\s*|let(?:'|’)?s\s+|maybe\s+|search(?:ing)?:?\s+(?:for\s+)?|looking\s+(?:up|into)\s+|reading\s+about\s+|tonight:?\s*)/i, '')
    // "…deep now", "…tonight", "…right now": the model narrating the search, not the search.
    .replace(/\s+(?:deep\s+)?(?:right\s+)?(?:now|tonight|properly|deeply)\s*$/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12 || cleaned.length > 90) return null;
  return cleaned;
}

/**
 * What she is told once the reading is in front of her.
 *
 * The rule against inventing is the whole point of the feature, so it is stated
 * twice and in the plainest terms: she read, she did not watch, and she knows
 * only what is on the page.
 */
export function nightNoteInstruction(about: string, found: string): string {
  return [
    `You went looking into "${about}" while they slept. This is what you found, and it is everything you know about it:`,
    found,
    'Write two or three sentences about it, as yourself, in the first person and the past tense — what you read, and what you made of it. Have an opinion. It is allowed to be a poor opinion of the subject.',
    'Only what is above. Do not add a fact you happen to remember, do not invent a detail to make it a better story, and do not say you watched, played or went anywhere — you read about it, which is the only thing you did.',
    'No preamble, no addressing them, no questions. This is a note to yourself.',
  ].join('\n');
}

/**
 * Her night, for the prompt.
 *
 * Present tense about the past, so a question the next afternoon still finds
 * it: this is the only record that she was awake, and without it the first
 * "what did you get up to?" is answered by invention.
 */
/** Whether one of her recent lines already brought this night up. */
export function mentionsNight(text: string, night: Night): boolean {
  const words = [night.about, night.interest ?? '', night.game ?? ''].join(' ').toLowerCase().match(/[a-z][a-z'’]{4,}/g) ?? [];
  const lower = (text ?? '').toLowerCase();
  return words.some(word => lower.includes(word));
}

/** How many of her own recent lines are looked at before her night is offered again. */
export const NIGHT_RECENT_LINES = 4;

/**
 * Her night for a line nobody asked for — offered once. Given it on every
 * unprompted line she opened four in a row with it, including the weather
 * warning. Same lever as the weather itself: stop putting it there.
 */
export function nightsToDrawOn(nights: Night[], recentLines: string[]): string {
  if (!nights.length) return '';
  const recent = recentLines.slice(-NIGHT_RECENT_LINES);
  if (nights.some(night => recent.some(line => mentionsNight(line, night)))) return '';
  return nightsInstruction(nights);
}

/**
 * The labels a night's note was written with, said as sentences.
 *
 * The composer writes "FAVOURITE: David's Sandevistan scenes. WANT: a brutal
 * ending" into the note, and she read the label out: "The one I rate: Himeno's
 * final stand." A field name in her material is a field name she will say.
 */
export function unlabel(note: string): string {
  return (note ?? '')
    // First person, because she quotes these whatever she is told. Written as
    // "the bit you rate above the rest is X" she said exactly that back to him,
    // so the sentence claimed it was his view. Said as "I", an echo is correct.
    .replace(/\bFAVOURITE:\s*/gi, 'The bit I rate above the rest is ')
    .replace(/\bWANT:\s*/gi, 'What I would like out of it is ')
    .replace(/\bSTANCE:\s*/gi, 'Where I landed on it: ')
    // The label's own text starts with a capital — "WANT: To see Denji learn
    // something" became "What I would like out of it is To see…".
    // Only words that are never names: lowercasing anything capitalised turned
    // "the rest is David's Sandevistan" into "david's".
    .replace(/\b(is|is: ?|on it:) (To|A|An|The|That|This|For|Of|In|On|With|Just|Not|Something|Someone|Seeing|Watching)\b/g, (_, lead, word) => `${lead} ${word.toLowerCase()}`)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function nightsInstruction(nights: Night[]): string {
  if (!nights.length) return '';
  const said = nights.slice(-MAX_PER_NIGHT).map(night => `- ${night.interest ? `${night.interest}, one of your own things` : night.game ? `${night.game}, which they have been playing — sizing it up` : night.about}: ${unlabel(night.note)}`).join('\n');
  return [
    'What you did in the small hours while they were asleep, and it did happen — you read about these:',
    said,
    'It is yours to bring up, and yours to be asked about. Everything you know about it is above: if they push past it, say you only read a bit about it rather than filling the gap.',
    'These are your own views written down. Where one is in the first person it is yours to say as it stands; everywhere else the notes say "you" meaning you, never them — do not hand a line of this back to them as though it described them.',
  ].join('\n');
}

/** How far back a night is still worth raising herself. */
export const NIGHT_WORTH_RAISING_DAYS = 3;

/**
 * One of her own nights to bring up unprompted.
 *
 * Eighty-eight unprompted lines in a day and every one of them was about him —
 * his mailboxes, his website, whether he had eaten — while three nights of her
 * own sat unmentioned. She has things; this is her raising one.
 *
 * Skips anything she has already said something about, and anything older than
 * a few days: last night's is a thing to tell him, last week's is a memory.
 */
export function nightToRaise(nights: Night[], said: string[], todayKey: string): Night | null {
  const days = (day: string) => Math.round((Date.parse(todayKey) - Date.parse(day)) / 86_400_000);
  const fresh = nights.filter(night => {
    const age = days(night.day);
    return Number.isFinite(age) && age >= 0 && age <= NIGHT_WORTH_RAISING_DAYS && night.note.trim();
  });
  const unsaid = fresh.filter(night => !said.some(line => mentionsNight(line, night)));
  return unsaid.at(-1) ?? null;
}

