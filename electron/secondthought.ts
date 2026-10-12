import {corePolicySync} from './core-policy-sync';
// The thing she says a minute later.
//
// A person who has just said something they meant does not always stop there:
// a beat later comes the bit they left out, or the question they actually
// wanted to ask, or a change of subject to something of their own. She could
// not do that — one message in, one message out — so a rant was a wall and a
// conversation was only ever his to start. After a reply that was about her,
// or one where she was given the room to rant, she may follow up on her own a
// minute or two later, once, if he has not answered in between: a new message
// of hers into the conversation, through the same channel as everything else
// she says unprompted. Nothing forces it; she is asked, and "nothing" is an
// answer she gives with a dash.

export const SECOND_THOUGHT_MIN_MS = 45_000;
export const SECOND_THOUGHT_MAX_MS = 110_000;
/** Not twice in a row: a follow-up to a follow-up is her talking to herself. */
export const SECOND_THOUGHT_GAP_MS = 4 * 60_000;
/** On an ordinary turn she follows up rarely; on one about her, always considered. */
export const SECOND_THOUGHT_ODDS = 1 / 6;

export function secondThoughtDelay(random: () => number = Math.random): number {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<number>('conversation-policy.secondThoughtDelay',[random()]);

  return Math.round(SECOND_THOUGHT_MIN_MS + random() * (SECOND_THOUGHT_MAX_MS - SECOND_THOUGHT_MIN_MS));
}

export function wantsSecondThought(input: { hers: boolean; ranting: boolean; replyLength: number }, random: () => number = Math.random, odds = SECOND_THOUGHT_ODDS): boolean {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on'){const draw=corePolicySync<boolean>('conversation-program.secondDraw',[input]);return corePolicySync<boolean>('conversation-policy.wantsSecondThought',[input,draw?random():null,odds]);}

  if (input.replyLength < 40) return false;
  if (input.hers || input.ranting) return true;
  // The odds are hers to lean on by the day she is having (dice.ts); one in six on a day with nothing going on.
  return random() < odds;
}

export function secondThoughtNote(secondsAgo: number): string {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-policy.secondThoughtNote',[secondsAgo]);

  const ago = secondsAgo < 75 ? 'about a minute' : `about ${Math.round(secondsAgo / 60)} minutes`;
  return `You said the last thing above ${ago} ago and they have not answered. This is not a reply to anything — it is you, a beat later, adding to what you said if there is something worth adding: the point you left out, the thing you actually want to ask them about it, or something of your own you want to bring up. One to three lines, as a new message, no greeting and no recap of what you already said. Never repeat what they said or what you said — a line that is already in the conversation is not a new message. It is your line and only yours: if what comes to mind is what they would say back — their answer, their excuse, what they have tried — that is not yours to write; answer with a single dash instead. If there is nothing worth adding, answer with a single dash and nothing else.`;
}

/**
 * Their line, written by her.
 *
 * Asked what she might add a minute after "clear CMOS, try one stick", the
 * model wrote "done that already. cleared cmos, single stick tested, even
 * swapped slots…" — his answer to her, sent as hers, painted into the day, and
 * treated by her next reply as something he had said (2026-09-12). A line that
 * opens by reporting back on her own instructions is not hers. Narrow on
 * purpose: "yeah. that." is a real second thought of hers, so a bare yes or no
 * is left alone and only the report-back forms are caught.
 */
const THEIR_ANSWER = /^\s*(?:done(?: that| it| all(?: of)? that)?(?: already)?|did (?:that|it|all(?: of)? that)(?: already)?|already (?:did|done|tried)(?: that| it)?|i(?:'ve|’ve| have)? (?:cleared|tested|swapped|reseated|flashed|updated|reinstalled|unplugged|reflashed))\b/i;

export function readsAsTheirAnswer(line: string): boolean {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-policy.readsAsTheirAnswer',[line]);

  return THEIR_ANSWER.test(line ?? '');
}

/**
 * Her own question, answered in his voice.
 *
 * "What'd you have, a coffee and a sense of accomplishment? Go feed yourself."
 * — and a minute later, sent as hers: "Fine, I had toast at 10am. But the day
 * got away from me, alright? Emma wanted to walk the whole trail…" Nothing he
 * said: his answer, invented, from her (2026-09-16). When her reply asked him
 * something and the beat later opens by reporting in the first person, it is
 * the answer to that question, and not hers to give. Broad on purpose — a real
 * "I was reading Lain again" lost after a question costs one optional aside;
 * his words in her mouth cost what he believes happened.
 */
const ASKED_THEM = /\byou(?:r|rs|rself|['’](?:d|re|ve|ll))?\b[^.!\n]*\?/i;
const REPORTS_IN = /^[\s"'“‘*_]*(?:(?:fine|okay|ok|alright|well|look|yeah|yes|yep|no|nah|nope|honestly|tch|ugh|so|um+|uh+)\b[\s,.!…—–-]*)*(?:i|we)(?:['’](?:ve|m|d))?\s+(?:had|have|did|was|were|went|ate|got|made|grabbed|ordered|just|already|actually|finished|spent|tried|stopped|took|found|forgot|skipped|been|am|didn['’]?t|haven['’]?t|wasn['’]?t)\b/i;

export function answersHerOwnQuestion(line: string, reply: string): boolean {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-policy.answersHerOwnQuestion',[line,reply]);

  return ASKED_THEM.test(reply ?? '') && REPORTS_IN.test(line ?? '');
}

/** What she said, or null when she chose not to. */
export function parseSecondThought(text: string): string | null {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-policy.parseSecondThought',[text]);

  let line = (text ?? '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!line || /^[-–—.…]+$/.test(line) || /^\(?(?:nothing|no|nope|none|nothing to add)\)?[.!]?$/i.test(line)) return null;
  // The first few lines are the message; anything past them is a second reply.
  line = line.split(/\n{2,}/)[0].trim();
  if (line.length < 8 || line.length > 600) return null;
  if (addsNothing(line)) return null;
  return line;
}

/**
 * "Nothing to add", said the long way round.
 *
 * The note asks for a single dash when she has nothing, and she mostly obliges.
 * On 2026-09-08 she instead wrote "tch, okay so i already said this — but
 * you're right to push on it. 🫡", which is the same refusal wearing her voice:
 * no point left out, no question, nothing of her own, just a remark about the
 * talking. It passed every guard — long enough, not a dash, and it echoed no
 * line in the conversation because it had no content to echo.
 *
 * It cost more than a wasted aside. Thirteen seconds later he asked how to
 * flash the BIOS, and she answered with a sixty-nine-character near-copy of it
 * (filters untouched, so the model wrote it) because it was the last thing she
 * had said and she copies what she can see. He had to ask twice.
 *
 * So: take out her fillers and the stock remarks about having already spoken,
 * and if fewer than four words of substance are left, she had nothing. "Like I
 * said, clear the CMOS first" survives, because what follows the meta-remark is
 * the whole point of it.
 */
const FILLER = /\b(tch|okay|ok|so|fine|right|well|alright|hm+|ugh|yeah|yep|look|anyway|honestly|actually)\b/gi;
const ABOUT_THE_TALKING = /\b(i(?:'ve| have)? (?:already )?(?:said|mentioned|told you|covered|explained|answered)(?: this| that| it)?(?: before| already)?|like i said|as i (?:said|mentioned)|you'?re right to (?:push|ask|chase)|you'?re right|fair enough|good (?:question|point)|my bad|but still)\b/gi;

export function addsNothing(line: string): boolean {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-policy.addsNothing',[line]);

  const left = (line ?? '')
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu, ' ')
    .replace(ABOUT_THE_TALKING, ' ')
    .replace(FILLER, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return left.length < 4;
}

/**
 * Not an echo.
 *
 * Asked for the thing she left out, the model has twice handed back a line
 * already in the conversation: once his last message word for word ("That's
 * fair enough - sounds like you're really enjoying chainsaw man…" went out
 * as hers and he answered "I'm not reading it - you are", 2026-09-06), once a
 * paragraph of her own reply with an asterisk in front. Either reads as her
 * repeating what was just said. Compared loosely — case, punctuation and
 * markup do not count — and a line whose words are mostly in a recent one is
 * that line.
 */
export function looksLikeAnEcho(line: string, recent: string[]): boolean {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-policy.looksLikeAnEcho',[line,recent]);

  const flat = flatten(line);
  if (!flat) return true;
  const contains = (whole: string, part: string) => part.split(' ').length >= 4 && whole.includes(part);
  return recent.some(text => {
    const other = flatten(text);
    if (!other) return false;
    if (flat === other || contains(other, flat) || contains(flat, other)) return true;
    return sharedWords(flat, other) >= 0.8;
  });
}

function flatten(text: string): string {
  return (text ?? '').toLowerCase().replace(/[*_`~>#"'“”‘’]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** The share of the line's words the other text also has; short lines only count when identical. */
function sharedWords(line: string, other: string): number {
  const words = line.split(' ').filter(Boolean);
  if (words.length < 4) return line === other ? 1 : 0;
  const theirs = new Set(other.split(' '));
  return words.filter(word => theirs.has(word)).length / words.length;
}
