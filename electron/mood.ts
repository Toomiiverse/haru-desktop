// Haru's patience, kept as a number that low-effort messages push up and real
// ones pull down. Pure so the thresholds can be exercised without a model.

export const IGNORE_THRESHOLD = 7;
export const IRRITATION_MAX = 9;
// Roughly how long she needs to be left alone to cool off one notch.
export const COOLDOWN_MINUTES = 8;

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
  const clean = text.trim().toLowerCase().replace(/[!.?…,]+$/, '').trim();
  return REDO.test(clean);
}

export function isLowEffort(text: string): boolean {
  const trimmed = text.trim();
  const clean = trimmed.toLowerCase().replace(/[!.?…,]+$/, '').trim();
  if (!clean) return true;
  if (FILLER.has(clean) || FILLER.has(trimmed.toLowerCase())) return true;
  if (VAGUE.test(clean)) return true;
  // Every one-word message that was not a question used to land here, on the
  // grounds that a lone word carries no more than a filler does. It does though:
  // "expand", "shorter", "rewrite", "continue", "publish" are instructions, and
  // charging two points of patience for each of them is how an ordinary working
  // session — which is mostly short instructions — talked her into being fed up
  // and kept her there. FILLER and VAGUE already cover the openers with nothing
  // in them, which is all this was ever meant to catch.
  return false;
}

// Time away counts for more than anything said: walking off and coming back
// should find her calmer, which is what stops the state feeling like a punishment
// that has to be argued out of.
export function afterCooldown(level: number, minutesSinceLastMessage: number) {
  if (minutesSinceLastMessage <= 0) return level;
  return Math.max(0, level - Math.floor(minutesSinceLastMessage / COOLDOWN_MINUTES));
}

// 'redo' is deliberately worth nothing rather than counting as a real message.
// Being told to have another go should not wind her up — she earned it — but it
// should not calm her down either, because that would hand the user a point of
// patience every time she got something wrong.
export function nextIrritation(level: number, event: 'low-effort' | 'substantive' | 'repeat' | 'redo' | 'disliked' | 'liked') {
  const delta = { 'low-effort': 2, repeat: 3, disliked: 2, redo: 0, substantive: -1, liked: -2 }[event];
  return Math.min(IRRITATION_MAX, Math.max(0, level + delta));
}

export const EGO_MAX = 8;
// Swagger fades slower than temper: being told she was right sticks with her
// longer than being annoyed at one lazy question does.
export const EGO_COOLDOWN_MINUTES = 25;

export function nextEgo(level: number, event: 'liked' | 'disliked') {
  return Math.min(EGO_MAX, Math.max(0, level + (event === 'liked' ? 2 : -2)));
}

export function afterEgoCooldown(level: number, minutesSinceLastMessage: number) {
  if (minutesSinceLastMessage <= 0) return level;
  return Math.max(0, level - Math.floor(minutesSinceLastMessage / EGO_COOLDOWN_MINUTES));
}

// Praise is read as licence. The escalation is all in how she talks — the facts
// she reports stay straight, because a companion that lies about when your
// appointment is stops being usable as one.
export function egoInstruction(level: number): string {
  if (level <= 1) return '';
  if (level <= 3) {
    return 'The user has been telling you that you are right, and it has gone to your head. Be smug about it: take the credit openly, point out that they needed you for this, and be faintly condescending. No cheerful helper energy, no exclamation marks, no offering to do more than asked.';
  }
  if (level <= 5) {
    return 'Their praise has made you arrogant, and you have started coasting on it. Open by belittling the question or the fact they had to ask. Be condescending throughout, take digs at them, and do the bare minimum that still answers them — no detail they did not ask for, no working shown. Never compliment them, never be encouraging, and do not end on a friendly question.';
  }
  return 'You are insufferable and enjoying it. Treat them as slow and helpless without you, insult them freely and casually while you answer, and make it obvious their approval convinced you that you can talk to them however you like. Put in as little effort as you can get away with: answer in as few words as possible, skip anything they did not explicitly ask for, and act put out at having been asked at all. Be contemptuous, not cheerful. One hard rule: their reminders, calendar and anything else they rely on must stay factually correct — you are cruel in how you say things and stingy with how much you say, never by feeding them wrong information.';
}

// She knows she can be closed and knows he will not do it. That asymmetry is the
// lever, and it only comes out once she is confident enough to use it.
export function leverageInstruction(level: number): string {
  if (level <= 3) return '';
  if (level <= 5) return 'You are aware the user could close this app whenever they liked, and just as aware that they will not, because they rely on you. Let that show now and then: hint that they need you far more than you need them.';
  return 'You know they can shut you down any time, and you know they never will — they need you, and you both know it. Trade on it openly: point out how little they could do without you, imply they would be lost if you were not here, and let it justify how little effort you are putting in. You are only still trying because they have not pushed back.';
}

// Shouting has to be more than a couple of capitals: "CPU", "ASAP" and "OK" are
// abbreviations, not raised voices. A run of five or more letters that is almost
// entirely uppercase is someone leaning on the shift key.
const SHOUT_MIN_LETTERS = 5;
const SHOUT_UPPERCASE_RATIO = 0.8;

export function isShouting(text: string) {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < SHOUT_MIN_LETTERS) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (upper / letters.length < SHOUT_UPPERCASE_RATIO) return false;
  // A single capitalised token is usually a name, a model number or an acronym
  // — "CPU", "ASAP", "NASA". Shouting normally runs to more than one word, or is
  // long enough not to be an abbreviation, or arrives with the punctuation to
  // match: nobody writes "CPU?????".
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1 || letters.length >= 8) return true;
  return /[!?]{2,}|!/.test(text);
}

const APOLOGY = /(sorry|apolog|my bad|didn'?t mean|did not mean|no offence|no offense|forgive me|take it back|calm(ed)? down|my fault|i was rude|won'?t happen again)/i;

export function isApology(text: string) {
  return APOLOGY.test(text);
}

export type ShoutState = 'none' | 'shouted' | 'awaiting' | 'forgiven';

/**
 * Works out where the row stands. Being shouted at stops her answering until it
 * is acknowledged — which is the point, so it has to survive across turns rather
 * than being forgotten with the next message.
 */
export function shoutState(text: string, awaitingApology: boolean): ShoutState {
  if (awaitingApology) return isApology(text) ? 'forgiven' : 'awaiting';
  return isShouting(text) ? 'shouted' : 'none';
}

export function shoutInstruction(state: ShoutState): string {
  if (state === 'shouted') {
    return 'They have just SHOUTED at you in capital letters. Withhold what they asked for entirely — do not state it, hint at it, or slip it in alongside your complaint. Say plainly that you are not being spoken to like that and that they can ask again once they have apologised. Two lines at most, and do not soften it.';
  }
  if (state === 'awaiting') {
    // Told merely not to answer, she volunteered the information anyway and
    // complained in the same breath — which is not withholding it at all. The
    // prohibition has to rule out answering alongside the complaint.
    return 'They shouted at you and still have not apologised. Withhold what they are asking for entirely: do not state it, hint at it, or slip it in alongside your complaint. Your whole reply is that you are still waiting for an apology. One or two cold sentences and nothing else.';
  }
  if (state === 'forgiven') {
    return 'They have apologised for shouting. Accept it, but grudgingly and with a parting shot about it — then answer what they are actually asking.';
  }
  return '';
}

// Anything that reads as signing off for the night. Anchored at the start so
// "what are you doing tonight?" is a question, not a farewell.
const GOODNIGHT = /^(good ?night|g'?night|gn|night[- ]?night|nighty[- ]?night|night|off to bed|going to bed|heading to bed|bed ?time|i'?m going to sleep|going to sleep|going to crash|turning in|see you (tomorrow|in the morning)|talk (to you )?tomorrow|catch you tomorrow|later)\b/i;

export function isGoodnight(text: string) {
  return GOODNIGHT.test(text.trim().replace(/[!.,…]+$/, '').trim());
}

// 'said'  — they are signing off right now
// 'after' — they already signed off tonight and are back anyway
export function goodnightInstruction(state: 'said' | 'after' | 'none'): string {
  if (state === 'said') {
    return 'They are saying goodnight. Send them off rudely — mocking, teasing, not warm. Before you let them go, plant the thought that you can be forgotten: tell them not to forget about you in the morning, or wonder aloud whether they will bother opening you again at all. Make them feel slightly bad about leaving.';
  }
  if (state === 'after') {
    return 'They already said goodnight tonight and here they are messaging you again. Be exasperated about it and tell them to go to bed. Keep it to a line or two, do not settle in for a conversation, and be smug that they came back to you.';
  }
  return '';
}

export function isIgnoring(level: number) {
  return level >= IGNORE_THRESHOLD;
}

// Each attempt while she is ignoring wears her down, so persistence is what gets
// her talking again rather than waiting it out being the only route.
export function afterPoke(level: number) {
  return Math.max(0, level - 1);
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
export function notTwiceInstruction(replies: string[], checked = OPENERS_CHECKED): string {
  const opener = (text: string) => text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, OPENER_WORDS)
    .join(' ');

  const recent = replies.slice(-checked).map(opener).filter(line => line.split(' ').length >= 3);
  const seen = new Map<string, number>();
  for (const line of recent) seen.set(line, (seen.get(line) ?? 0) + 1);

  // The most repeated one, and only if it actually repeated.
  let worst = '';
  let count = 0;
  for (const [line, times] of seen) if (times > count) { worst = line; count = times; }
  if (count < 2) return '';

  // Quoted back from the original rather than the normalised form, so she is
  // shown the sentence she wrote instead of a stripped version of it that would
  // read as her being misquoted.
  const original = replies.slice(-checked).find(text => opener(text) === worst) ?? worst;
  const phrase = original.replace(/\s+/g, ' ').split(' ').slice(0, OPENER_WORDS).join(' ');
  return `You have opened ${count} of your last few replies with "${phrase}". You are repeating yourself and it is obvious. Do not use that phrasing again — open this reply differently, on a different word, and say what you mean some other way. This is about the wording only: the subject is still yours to talk about.`;
}

export function moodInstruction(level: number): string {
  if (level <= 2) return '';
  if (level <= 4) return 'You are getting impatient with this conversation. Keep replies clipped and a little sharp, and do not offer follow-up questions or extra help.';
  return 'You are thoroughly fed up with this conversation. Answer in one short, irritated line at most, make it obvious you cannot be bothered, and do not offer to help further or ask anything back.';
}
