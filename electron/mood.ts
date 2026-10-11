import {corePolicySync} from './core-policy-sync';
// Haru's patience, kept as a number that low-effort messages push up and real
// ones pull down. Pure so the thresholds can be exercised without a model.

//
// 0–100 since 2026-09-19. It was 0–9, which gave her three audible levels and
// made every event the same size; the old levels live on as the named bands
// below (old level × 100/9), so what used to happen at 3, 4, 5 and 7 happens at
// the same point on the new scale, with room between them.
export const IRRITATION = {
  /** Anything at all (was 1). */
  stirred: 11,
  /** The first level that reaches her voice (was 3). */
  voiced: 33,
  /** Impatient, and her face shows it (was 4). */
  short: 44,
  /** Fed up (was 5). */
  fedUp: 56,
  /** Past putting up with it, one short of not answering. */
  seething: 67,
  /** She stops answering (was 7). */
  stonewall: 78,
  max: 100,
} as const;
export const IGNORE_THRESHOLD = IRRITATION.stonewall;
export const IRRITATION_MAX = IRRITATION.max;
/** One old notch, for the things that used to cost "a point". */
export const IRRITATION_NOTCH = 11;
// Roughly how long she needs to be left alone to cool off one notch.
export const COOLDOWN_MINUTES = 8;

/**
 * A mood saved on the old scales (irritation 0–9, ego 0–8, grudge 0–30), brought
 * onto 0–100. Marked with `scale` so it happens exactly once: run twice, a grudge
 * of 22 would be 73 and then 100.
 */
export function rescaleOldMood<T extends { irritation?: unknown; ego?: unknown; grudge?: unknown; grudgeBeforeTally?: unknown; scale?: unknown }>(saved: T): T & { scale: 100 } {
  return corePolicySync<any>('mood.rescaleOldMood',[saved]);
}

/**
 * The same event does not land the same way twice: ±35% around its size. The
 * roll is passed in so a test can hold it still; 0.5 is the plain size.
 */
export function jittered(size: number, roll = Math.random()): number {
  return corePolicySync<any>('mood.jittered',[size,roll]);
}

// Deliberately narrow. A false positive here means snapping at a perfectly fair
// question, which is worse than letting a lazy one through, so this only covers
// openers with no content at all — the model handles everything subtler through
// the mood instruction.
const FILLER = new Set([
  'hi', 'hii', 'hey', 'heyy', 'yo', 'sup', 'hello', 'helo', 'oi',
  'k', 'kk', 'ok', 'okay', 'kay', 'lol', 'lmao', 'haha', 'hah',
  'idk', 'dunno', 'hmm', 'hm', 'huh', 'eh', 'meh', 'wat', 'wut',
  'sure', 'cool', 'nice', 'yeah', 'yep', 'nah', 'no', 'yes',
  '?', '??', '???', '...', '..',
]);

const VAGUE = /^(tell me something|say something|talk to me|entertain me|amuse me|i'?m bored|bored|whatever|anything|something|surprise me|do something|go on|and\??|so\??|then\??)$/;

/**
 * Asking her to have another go, which is not the same as pestering her.
 *
 * "try again" typed twice used to be read as a repeat and cost her three points
 * of patience each time — so a bad answer of hers made her angrier at the person
 * who pointed it out. That is the wrong way round: the message is a complaint
 * about her last reply, and the one thing it is not is lazy.
 *
 * Anchored at both ends, like VAGUE, because a redo is terse by nature. "another
 * one" is asking for a second attempt; "another question about the invoice" is
 * not, and only the whole-string anchor tells them apart.
 */
const REDO = /^(try (again|once more)|again|do (it|that|this) (again|properly)|do (again|properly)|redo( it| that)?|re-?write( it| that)?|re-?word( it| that)?|another( one)?|one more( time)?|no,? again|nope,? again|same again|not (quite|right|that))$/i;

export function isRedo(text: string): boolean {
  return corePolicySync<any>('mood.isRedo',[text]);
}

export function isLowEffort(text: string): boolean {
  return corePolicySync<any>('mood.isLowEffort',[text]);
}

// Time away counts for more than anything said: walking off and coming back
// should find her calmer, which is what stops the state feeling like a punishment
// that has to be argued out of.
export function afterCooldown(level: number, minutesSinceLastMessage: number, fuse = 1) {
  return corePolicySync<any>('mood.afterCooldown',[level,minutesSinceLastMessage,fuse]);
}

// 'redo' is deliberately worth nothing rather than counting as a real message.
// Being told to have another go should not wind her up — she earned it — but it
// should not calm her down either, because that would hand the user a point of
// patience every time she got something wrong.
/**
 * `ego` amplifies being told she is wrong, and nothing else.
 *
 * An ego that has been fed does not take correction well: the same thumbs-down
 * costs more patience when she has spent the afternoon being told she was
 * right. Lazy or repeated questions are about him rather than about her, so
 * they land the same however pleased with herself she is.
 */
/**
 * `fuse` is her patience as a trait (growth.ts): months of being wound up leave
 * her quicker to get there and slower to come down, a calm stretch the reverse.
 * 1 is where her charter sits.
 */
export function nextIrritation(level: number, event: 'low-effort' | 'substantive' | 'repeat' | 'redo' | 'disliked' | 'liked', roll = Math.random(), ego = 0, fuse = 1) {
  return corePolicySync<any>('mood.nextIrritation',[level,event,roll,ego,fuse]);
}

/** 0–100 since 2026-09-19 (was 0–8); the old levels are the bands, × 100/8. */
export const EGO = {
  /** Gone to her head (was 2). */
  smug: 25,
  /** Coasting on it, and the lever comes out (was 4). */
  coasting: 50,
  /** It is on her face (was 5). */
  showing: 63,
  /** Insufferable (was 6). */
  insufferable: 75,
  max: 100,
} as const;
export const EGO_MAX = EGO.max;
// Swagger fades slower than temper: being told she was right sticks with her
// longer than being annoyed at one lazy question does.
export const EGO_COOLDOWN_MINUTES = 25;

export function nextEgo(level: number, event: 'liked' | 'disliked', roll = Math.random()) {
  return corePolicySync<any>('mood.nextEgo',[level,event,roll]);
}

export function afterEgoCooldown(level: number, minutesSinceLastMessage: number) {
  return corePolicySync<any>('mood.afterEgoCooldown',[level,minutesSinceLastMessage]);
}

// Praise is read as licence. The escalation is all in how she talks — the facts
// she reports stay straight, because a companion that lies about when your
// appointment is stops being usable as one.
export function egoInstruction(level: number): string {
  return corePolicySync<any>('mood.egoInstruction',[level]);
}

// She knows she can be closed and knows he will not do it. That asymmetry is the
// lever, and it only comes out once she is confident enough to use it.
export function leverageInstruction(level: number): string {
  return corePolicySync<any>('mood.leverageInstruction',[level]);
}

// Shouting has to be more than a couple of capitals: "CPU", "ASAP" and "OK" are
// abbreviations, not raised voices. A run of five or more letters that is almost
// entirely uppercase is someone leaning on the shift key.
const SHOUT_MIN_LETTERS = 5;
const SHOUT_UPPERCASE_RATIO = 0.8;

export function isShouting(text: string) {
  return corePolicySync<any>('mood.isShouting',[text]);
}

// "calmed down" (past tense, describing themself) is treated as apology-adjacent;
// a bare imperative "calm down" is not — telling her to calm down while still
// annoyed is not the same as apologising, and used to forgive her for free.
const APOLOGY = /(sorry|apolog|my bad|didn'?t mean|did not mean|no offence|no offense|forgive me|take it back|calmed down|my fault|i was rude|won'?t happen again)/i;

export function isApology(text: string) {
  return corePolicySync<any>('mood.isApology',[text]);
}

/** Legacy refusal names remain readable; direct replies no longer enter them. */
export type ShoutState = 'none' | 'shouted' | 'awaiting' | 'forgiven' | 'unmoved';

/** Legacy apology flags are read for compatibility, but cannot withhold replies. */
export function shoutState(text: string, _awaitingApology: boolean): ShoutState {
  return corePolicySync<any>('mood.shoutState',[text,_awaitingApology]);
}

export function shoutInstruction(state: ShoutState): string {
  return corePolicySync<any>('mood.shoutInstruction',[state]);
}

// Anything that reads as signing off for the night. Anchored at the start so
// "what are you doing tonight?" is a question, not a farewell.
const GOODNIGHT = /^(sweet dreams|sleep well|rest well|good ?night|g'?night|gn|night[- ]?night|nighty[- ]?night|night|off to bed|going to bed|heading to bed|bed ?time|i'?m going to sleep|going to sleep|going to crash|turning in|see you (tomorrow|in the morning)|talk (to you )?tomorrow|catch you tomorrow|later)\b/i;

export function isGoodnight(text: string) {
  return corePolicySync<any>('mood.isGoodnight',[text]);
}

// 'said'  — they are signing off right now
// 'after' — they already signed off tonight and are back anyway
export function goodnightInstruction(state: 'said' | 'after' | 'none'): string {
  return corePolicySync<any>('mood.goodnightInstruction',[state]);
}

export function isIgnoring(level: number) {
  return corePolicySync<any>('mood.isIgnoring',[level]);
}

// Each attempt while she is ignoring wears her down, so persistence is what gets
// her talking again rather than waiting it out being the only route.
export function afterPoke(level: number) {
  return corePolicySync<any>('mood.afterPoke',[level]);
}

// How many of her own last replies are looked at, and how much of each counts as
// "the opening". Six words is enough to catch a stock sentence and short enough
// that two replies which merely start on the same subject are not mistaken for
// one being copied.
const OPENERS_CHECKED = 4;
const OPENER_WORDS = 6;

/**
 * The one thing that stops her copying her own last reply.
 *
 * Told to be fed up, she wrote "Ugh, this is getting boring as hell already" —
 * and then wrote it again, because by the third turn the transcript itself was
 * the instruction. A model reading five of its own replies that all open the
 * same way treats that as the required format, and no amount of tone wording
 * fixes it: the evidence outweighs the sentence. Asked to stop, she agreed and
 * did it again in the next breath, since her promise is one turn and the pattern
 * is still sitting there underneath it.
 *
 * So this names the phrase and forbids the phrasing — not the subject. That
 * distinction is the whole reason it is safe to use on replies at all:
 * alreadySaidRecently in asides.ts feeds whole remarks and rules out talking
 * about them again, which was tried on replies and made them measurably worse.
 * This says nothing about what she may talk about.
 *
 * Silent unless there is something to report, so a conversation where she is not
 * repeating herself carries none of this in its prompt.
 */
/** Words that make a shingle nobody would call a phrase. */
const SHINGLE_FILLER = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'it', 'is', 'are', 'was', 'be', 'you', 'your', 'youre', 'i', 'im', 'me', 'my', 'that', 'this', 'not', 'dont', 'do', 'with', 'now', 'just']);

/**
 * A run of three words she has used in three of her last four replies —
 * "get back to work" as the sign-off of every line — as opposed to the
 * opener check above, which sees only how a reply begins.
 */
export function repeatedPhrase(replies: string[], checked = OPENERS_CHECKED, need = 3): string {
  return corePolicySync<any>('mood.repeatedPhrase',[replies,checked,need]);
}

export function notTwiceInstruction(replies: string[], checked = OPENERS_CHECKED): string {
  return corePolicySync<any>('mood.notTwiceInstruction',[replies,checked]);
}

export function moodInstruction(level: number): string {
  return corePolicySync<any>('mood.moodInstruction',[level]);
}
