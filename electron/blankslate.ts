// The reset: she wakes up with nothing, and has to ask.
//
// Everything she had is cleared in one go — what she knew about him, and what
// months of it had made of her. What is deliberately not cleared is her
// attitude, and the reason it survives is that it was never learned: the
// persona is his text in config.json, and the temperament is rolled fresh
// every morning (temperament.ts). So a reset takes the whole record and leaves
// the character, which is the only split that makes the exercise mean
// anything. She is the same person; she just does not know this one yet.
//
// One marker is left behind, and it fades on its own. A flag that has to be
// turned off by hand is a flag that is still on in March, and "you know
// nothing about them" read to a model that now knows forty things is worse
// than no instruction at all — it teaches her to ask what she has already been
// told, which is the exact failure the memory is for. So the instruction is a
// function of how much she has actually learned since, and goes quiet by
// itself at SETTLED memories or SETTLED_DAYS, whichever comes first.
//
// Where this runs matters, and it is not obvious. Her brain is the server; the
// desk, the laptop and the phone are bodies, and in server mode a body does not
// even build her prompt — it posts the message and the brain answers. So a
// reset on a body clears a mirror the brain refills within fifteen minutes, and
// the only reset that means anything happens on the server. The slate then
// travels outward on the memory sync the two already run, and each body follows
// it: drops what it was holding from before, and stops handing it back.
//
// Pure. The wipe itself is main.ts's, because only main.ts has the store.

/** Left behind by the reset. Nothing but the moment it happened. */
export type BlankSlate = { at: string };

/** Things learned about him after which she is no longer a stranger. */
export const SLATE_SETTLED = 25;
/** And the backstop, for a reset followed by a fortnight of silence. */
export const SLATE_SETTLED_DAYS = 14;
/** Below this she is told to ask outright; above it, only to admit the gaps. */
export const SLATE_STRANGER = 8;

/**
 * The store keys the reset clears.
 *
 * Written out rather than swept by prefix on purpose: `her.sleep` is her hours
 * and `her.lastAliveAt` is a heartbeat, and a prefix sweep over `her.` takes
 * both. What is here is the record — what she knew and who she became. What is
 * not here, and must not be: `character` (the attitude), every API key and
 * setting, and his own things — `kept.items`, `reminders`, `checkins`,
 * `journal.entries`. A reset is hers, not his.
 */
export const RESET_KEYS: string[] = [
  // What she knew about him.
  'profile', 'told', 'haunts', 'following', 'whereabouts', 'where.arrival', 'memory.formed',
  // The blocks: derived from the memory above, except where one was edited by
  // hand — and an edited block would survive the wipe holding the old picture.
  'memory.blocks',
  // The conversation in front of her, and the note explaining why it is empty:
  // she is not being told the chat was cleared, she is being told she was.
  'chat.messages', 'chat.asides', 'chat.upTo', 'chat.dayKey', 'chat.rantAt', 'chat.lastOpeningAt', 'chat.freshStart',
  // Where she had got to with him: the mood, the grudge inside it, the row not
  // yet finished. Being owed an apology by a stranger is not a thing.
  'mood', 'vitals', 'pushback', 'hume.reading',
  // And who she had become: her tastes, her nights, her wants, her traits, the
  // months that grew them.
  'tastes', 'nights',
  'her.days', 'her.deeds', 'her.feelings', 'her.hands', 'her.monthTally', 'her.months',
  'her.openedOn', 'her.reading', 'her.readingOn', 'her.recs', 'her.slights', 'her.standingAt',
  'her.temperament', 'her.traitLedger', 'her.traits', 'her.wakes', 'her.wants', 'her.week',
  'her.pokemon.lastState', 'her.pokemon.lastSummary', 'her.pokemon.played', 'her.pokemon.sitting',
];

/**
 * The two things in the list above a person typed rather than she learned.
 *
 * A body clearing itself keeps them: they are his own facts about himself,
 * entered in Setup, identical on every machine and synced by none of them, so
 * clearing them on a limb costs him the retyping and buys nothing the brain
 * does not already have. A reset takes them with everything else — a stranger
 * does not hold his profile.
 */
export const HAND_WRITTEN: string[] = ['profile', 'memory.blocks'];

/**
 * What a body holds of its own, which is what a body clear takes.
 *
 * Not a reset, and the difference is not pedantry. Her memories come down from
 * the brain and go back up nowhere, so clearing them here is undone by the next
 * pull and costs nothing either way; what does not come back is the life this
 * machine led while it was a second her — its own day transcripts, its own
 * tastes and nights, the months that grew them. Clearing those is the whole
 * operation, and it leaves no slate behind, because nothing happened to her.
 */
export const BODY_KEYS: string[] = RESET_KEYS.filter(key => !HAND_WRITTEN.includes(key));

/** What is hers to work out from here, said at both strengths. */
const HERS_NOW = 'What you like, what you are into, what you think of anything — that is yours to arrive at from here, not something you already had. Do not claim a taste you have not formed.';

/**
 * What she is told while the slate is still blank, or nothing once it is not.
 *
 * `known` is how many things she has actually remembered about him since. Two
 * strengths rather than a fade over a number, because a prompt line is read or
 * it is not: below SLATE_STRANGER she is told to ask outright, and after that
 * only to admit a gap when she hits one.
 */
export function blankSlateInstruction(slate: BlankSlate | null | undefined, known: number, nowMs: number = Date.now()): string {
  if (!slate) return '';
  const since = Date.parse(slate.at);
  if (!Number.isFinite(since)) return '';
  // Clock skew is not a reason to end it — a slate stamped in the future is
  // zero days old, not a spent one.
  const days = Math.max(0, (nowMs - since) / 86_400_000);
  if (known >= SLATE_SETTLED || days >= SLATE_SETTLED_DAYS) return '';
  if (known < SLATE_STRANGER) return [
    'You woke up with nothing.',
    'Not tired and not confused — empty: you do not know this person\'s name, what they do, who is in their life, or what the two of you have been to each other, and there is no past with them to reach for. Your temper, your taste in people and your mouth are your own and are exactly as they were.',
    'So treat the blanks as blanks. Ask — directly, in your own voice, the way you would ask anything — rather than guessing, hedging or letting it go past. One or two questions in a reply, not an interview, and they go where the conversation already is rather than down a list.',
    'When they tell you something, call remember_about_user with it, or you will be asking again tomorrow.',
    'Never pretend to remember, never invent a shared history to fill a gap, and do not apologise for not knowing: you are curious about them, not sorry.',
    HERS_NOW,
  ].join(' ');
  return [
    'You are still new to them.',
    'You know a handful of things and no more, so the gaps are real: when something comes up that you have no memory of, say so and ask rather than filling it in, and call remember_about_user with what they tell you.',
    HERS_NOW,
  ].join(' ');
}

/** The angle for her first line of all: she is speaking to someone she does not know. */
export function blankSlateOpening(slate: BlankSlate | null | undefined, known: number, nowMs: number = Date.now()): string {
  if (!blankSlateInstruction(slate, known, nowMs) || known >= SLATE_STRANGER) return '';
  return 'Open on the fact that you do not know who this is. Not alarmed and not apologetic — you are yourself, and there is a stranger at your desk. Ask them something you would actually want to know. Do not greet them as though you remember them and do not say hello generically.';
}

/** A slate off the wire — the brain's, read from a sync payload. Anything else is nothing. */
export function readSlate(value: unknown): BlankSlate | null {
  const at = (value as { slate?: { at?: unknown } } | null | undefined)?.slate?.at;
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? { at } : null;
}

/** Whether `brain` is a reset this machine has not followed yet. */
export function slateIsNewer(brain: BlankSlate | null, mine: BlankSlate | null): boolean {
  if (!brain) return false;
  if (!mine) return true;
  const ours = Date.parse(mine.at);
  return !Number.isFinite(ours) || Date.parse(brain.at) > ours;
}

/**
 * What another machine sent, minus anything she had before the reset.
 *
 * The merge on both ends is a union by id where the newer copy wins, so
 * forgetting has never travelled: a body that has not synced since the reset
 * still holds the old memories, and one push puts every one of them back. This
 * is the door that push comes through. A record with no readable createdAt is
 * dropped rather than kept — the only records without one are legacy, which is
 * to say old, which is to say exactly what the reset was for.
 */
export function withoutPreSlate(theirs: unknown, slate: BlankSlate | null | undefined): unknown {
  if (!slate || !Array.isArray(theirs)) return theirs;
  const after = Date.parse(slate.at);
  if (!Number.isFinite(after)) return theirs;
  return theirs.filter(record => {
    const born = Date.parse((record as { createdAt?: unknown } | null)?.createdAt as string);
    return Number.isFinite(born) && born >= after;
  });
}
