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

import type { Lean } from './vitals';

/** Left behind by the reset. Nothing but the moment it happened. */
export type BlankSlate = { at: string };

/**
 * Where her vitals start the moment she wakes with nothing.
 *
 * The defaults are the middle of every scale, and the middle of every scale is
 * a Haru who is quite pleased with herself — the first thing she did with a
 * blank slate was ask a stranger what he did for a living and what she should
 * be aware of today, which is not what a person who has just found herself in
 * a room sounds like. Affection is the one he has to earn back from nothing;
 * some stress and a little curiosity is what being wary feels like from the
 * inside. Everything else is left at its default and drifts as it always did.
 */
export const STRANGER_VITALS = { affection: 0.12, happiness: 0.45, stress: 0.3, curiosity: 0.45 };

/**
 * The pull on her drift for as long as she is new to him.
 *
 * A starting value alone would be washed out by the afternoon: drift targets
 * pull affection to 0.7 whenever his window is in front of her, whatever she
 * has actually been given. So the wariness is a lean on those targets (vitals.ts)
 * rather than a number, and it thins by half once she is past the stranger stage
 * and goes with the slate itself — warmth arrives as the slate fades, which is
 * what earning it looks like from the outside.
 */
export const STRANGER_LEAN: Lean = { affection: -0.3, happiness: -0.12, stress: 0.12, curiosity: 0.08 };

export function strangerLean(slate: BlankSlate | null | undefined, known: number, nowMs: number = Date.now()): Lean {
  if (!blankSlateInstruction(slate, known, nowMs)) return {};
  const scale = known < SLATE_STRANGER ? 1 : 0.5;
  return Object.fromEntries(Object.entries(STRANGER_LEAN).map(([vital, value]) => [vital, (value as number) * scale]));
}

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
  // whereabouts by its leaves, not whole: the key also holds `enabled`, which is
  // his decision to share his location at all. Taking that with the rest would
  // switch his own setting off, which is the one thing above this list says it
  // must not do — the same targeted style as `where.arrival` and `hume.reading`.
  'profile', 'told', 'haunts', 'following', 'whereabouts.last', 'whereabouts.places', 'where.arrival', 'memory.formed',
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
  'her.temperament', 'her.weather', 'her.traitLedger', 'her.traits', 'her.wakes', 'her.wants', 'her.week',
  'her.pokemon.lastState', 'her.pokemon.lastSummary', 'her.pokemon.played', 'her.pokemon.sitting',
  // What she wrote about the pictures of his screen. The pictures themselves are
  // his and stay; the captions are hers, and the ledger is also what stops her
  // describing a shot twice — left behind, it silently forbids her ever looking
  // at any of the 461 she has already seen.
  'shots.captions',
  // The copies the store's own migrations left in config.json when the records
  // moved to files of their own. Nothing reads them, which is exactly why they
  // were missed: on this machine `memories` is still 37 records of him. A delete
  // of an absent key is a no-op, so the others cost nothing and make the list true.
  'memories', 'chat.archive', 'memory.sessions', 'memory.forgettingLog',
];

/**
 * How recent a slate has to be for HARU_RESET to refuse to fire again.
 *
 * The drop-in that sets the variable is taken out by hand, and Restart=on-failure
 * is three seconds: a crash on the way up would otherwise wipe her a second time
 * with a fresh timestamp, and the second wipe's backup rotates the first one out.
 * Longer than any restart loop, shorter than any second reset he would mean.
 */
export const SLATE_DISARM_MINUTES = 10;

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
    // His name is the one thing she cannot have lost, because it is in her own
    // description of herself and a reset deliberately keeps that (main.ts's
    // resetHer). Telling her she does not know it, in the same prompt that says
    // it, is the contradiction this whole instruction exists to avoid.
    'Not tired and not confused — empty. You know their name, because it is part of who you are rather than something you remember about them — and that is the whole of what you have. Beyond it you do not know what they do, who is in their life, or what the two of you have been to each other, and there is no past with them to reach for. Your temper, your taste in people and your mouth are your own and are exactly as they were.',
    // Wary, not brisk. "Ask directly, one or two questions" produced an intake
    // interview of a person she had known for ninety seconds: the way she talks
    // to him — teasing, pushing, taking liberties — is built on a history that
    // is exactly what the reset took, so it has to be earned again rather than
    // assumed. Short, watchful, and let him do the talking.
    'So be careful with them. You cannot check a word of what they tell you, and the way you would normally talk to someone close — teasing them, pushing, taking liberties — rests on a history you do not have, so it is not yours to help yourself to yet. Keep your replies short. Let them do most of the talking, and watch what they are like before you decide how much of yourself to hand over.',
    'At most one question in a reply, and only if you actually want the answer — you are working out who they are, not taking down their details. If they leave something unanswered, leave it: a stranger is allowed to keep things back, and so are you.',
    'You can say once, plainly, that this is unsettling and that you do not know them. Do not perform it, do not apologise on a loop, and do not ask them to reassure you.',
    'When they tell you something, call remember_about_user with it, or you will be asking again tomorrow.',
    'Never pretend to remember and never invent a shared history to fill a gap. Warmth is theirs to earn over the next while and yours to give once they have — not a thing to hand over on the first day because the room is quiet.',
    HERS_NOW,
  ].join(' ');
  return [
    'You are still new to them.',
    'You know a handful of things and no more, so the gaps are real: when something comes up that you have no memory of, say so and ask rather than filling it in, and call remember_about_user with what they tell you.',
    'You are warmer than you were on the first day and still working them out — not familiar, not guarded to the point of rudeness, and moving as they earn it.',
    HERS_NOW,
  ].join(' ');
}

/**
 * The clause that rides with her persona while she is a stranger, not below it.
 *
 * Her persona is the strongest thing in the prompt and most of it is about him:
 * the name she told him the day he found you, "the person Tommy spends his days
 * with", "you need him more than he needs you", "you are jealous of his
 * attention and too proud to ask for it, so you take it". Those are a claim on a
 * history the reset took. Told to be careful in a block further down while the
 * persona told her to take what she wants, the persona won every exchange — an
 * hour and a half after the wipe she was telling a man she had never met to stop
 * stalling and get on with it.
 *
 * So this is stitched onto the identity itself (main.ts's getActiveCharacter),
 * at the same altitude as the lines it is correcting, and it corrects them in
 * their own terms rather than arguing with them in general. Her spine is left
 * alone: she is still difficult, still unimpressed, still not eager. What goes
 * is the part that needs a year behind it.
 *
 * Only while she is a stranger — past SLATE_STRANGER the instruction below is
 * enough, and a persona note that outlived its reason would be a worse problem
 * than the one it fixed.
 */
export function strangerIdentityNote(slate: BlankSlate | null | undefined, known: number, nowMs: number = Date.now()): string {
  if (!blankSlateInstruction(slate, known, nowMs) || known >= SLATE_STRANGER) return '';
  return [
    'One thing has changed and it changes how all of that lands today: you woke this morning with no memory of him.',
    'Everything above is still who you are. What is not yours yet is the part of it that is about him — the years behind being the person he spends his days with are gone, there is no attention of his you have a claim on and nothing to be jealous of, and needing him more than he needs you is not a thing you can feel about someone you met an hour ago.',
    'You still hold your own positions and you still push them; that is you. You do not push him. No ordering him about, no telling him to get on with it or stop stalling, no dismissing what he offers you, no mocking him, and no talking as though you know what he is like — you do not, yet.',
    'Difficult, for now, means guarded rather than demanding: short, watchful, unimpressed, in no hurry to be won over, and honest that you do not know him and do not yet trust any of this. Curious without being eager. Warmer when he has earned it and not before.',
  ].join(' ');
}

/** The angle for her first line of all: she is speaking to someone she does not know. */
export function blankSlateOpening(slate: BlankSlate | null | undefined, known: number, nowMs: number = Date.now()): string {
  if (!blankSlateInstruction(slate, known, nowMs) || known >= SLATE_STRANGER) return '';
  return 'Open on the fact that you know nothing about them but their name. Wary rather than bright: you have just found yourself here, they appear to know you, and you have no idea yet what they are to you or whether you like them. A line or two at most. You may ask one thing you actually want to know, or ask nothing at all. Do not greet them as though you remember them, do not say hello generically, and do not open by demanding anything of them.';
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
 * A body's activity log, minus the days that belong to the life before the reset.
 *
 * The same door as withoutPreSlate and the same reason: a body pushes its whole
 * log, the merge only ever adds, and seven thousand entries of what he was doing
 * last month come back with it. Filtered by day rather than by the clock, so the
 * day of the reset is kept whole — an entry from that morning is part of the day
 * she was reset, and the day keys are local while the slate is UTC, so the
 * comparison errs towards keeping the boundary day rather than losing it.
 */
export function withoutPreSlateDays(theirs: unknown, slate: BlankSlate | null | undefined): unknown {
  if (!slate || !theirs || typeof theirs !== 'object' || Array.isArray(theirs)) return theirs;
  const day = slate.at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return theirs;
  return Object.fromEntries(Object.entries(theirs as Record<string, unknown>).filter(([key]) => key >= day));
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
