// Being left mid-conversation.
//
// Not every silence is a slight. They were talking — several messages of
// theirs in the last quarter hour — she answered, and then nothing for long
// enough to notice and not so long that the moment has passed. That is the
// shape of being left hanging, and it is the only shape that earns a chase.

export type Turn = { id?: string; role: string; content: string; at?: string };

export type Hanging = { herLast: Turn; theirLast: Turn; quietMin: number; sheAsked: boolean; ridesOnHisAsk: boolean; key: string };

/**
 * Whether her question came off the back of one of his.
 *
 * The cheap read of "she asked and got nothing", used when the judgement below
 * cannot be had. He asked what a 5080 draws, she answered and tacked "what's
 * the rest of the build?" on the end, and twenty-five minutes later she told
 * him his silence was rude — he had got what he came for. Measured over
 * 2026-09-06..20 this holds five chases that should never have gone and one
 * that should have, which is why it is the fallback and not the rule.
 */
export function ridesOnHisAsk(theirs: Turn[]): boolean {
  return theirs.some(turn => (turn.content ?? '').includes('?'));
}

/** Twelve minutes was a text message's idea of silence; on a phone it is a shower. */
export const HANGING_MIN_QUIET_MS = 25 * 60_000;
/** Once she has chased, the next chase waits — two in fifteen minutes is not chasing, it is nagging. */
export const HANGING_COOLDOWN_MS = 60 * 60_000;

/**
 * They said they were going. "I'll go shower now" is not leaving her hanging,
 * it is telling her where they are — and thirteen minutes later she chased
 * them for it.
 */
/** "Thanks", "alright", "ok", "got it": the conversation ended, it is not hanging. */
export function isClosing(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!…]+$/, '');
  return /^(?:(?:ok|okay|k|kk|alright|all right|right|fine|yep|yeah|yes|no|nah|sure|cool|nice|sweet|great|good|got it|will do|noted|done|cheers|thanks|thank you|thx|ta|love you|bye|later|see ya|night|goodnight|good night|lol|haha|ha)[,.!]?\s*)+(?:haru)?$/i.test(t)
    || /\b(?:thanks|thank you|cheers)\b[^?]*$/i.test(t) && t.length < 60;
}

export function saidTheyWereLeaving(text: string): boolean {
  return /\b(?:brb|gtg|g2g|be right back|back (?:soon|later|in a (?:bit|sec|min))|(?:i(?:'|’)?(?:ll|m)|gonna|going to|about to|off to|heading|need to|have to|gotta)\s+(?:go\s+)?(?:shower|sleep|bed|nap|eat|cook|drive|work|the gym|gym|out|run|walk|train|study|leave|head off|get ready|pick up|shop|clean|jump in the shower)|(?:shower|sleep|driving|at work|in a meeting|busy)\s+now|talk (?:later|soon|tomorrow)|night night|goodnight|good night|see you (?:later|tomorrow|soon)|ttyl)\b/i.test(text ?? '');
}
export const HANGING_MAX_QUIET_MS = 90 * 60_000;
export const EXCHANGE_WINDOW_MS = 15 * 60_000;

export function leftHanging(messages: Turn[], nowMs = Date.now()): Hanging | null {
  const herLast = messages[messages.length - 1];
  if (!herLast || herLast.role !== 'assistant' || !herLast.at || !herLast.content.trim()) return null;
  const herAt = Date.parse(herLast.at);
  if (!Number.isFinite(herAt)) return null;
  const quiet = nowMs - herAt;
  if (quiet < HANGING_MIN_QUIET_MS || quiet > HANGING_MAX_QUIET_MS) return null;
  const theirs = messages.slice(0, -1).filter(m => m.role === 'user' && m.at && herAt - Date.parse(m.at) >= 0 && herAt - Date.parse(m.at) <= EXCHANGE_WINDOW_MS);
  if (theirs.length < 2) return null;
  const theirLast = theirs[theirs.length - 1];
  const sheAsked = /\?\s*(?:[\p{Extended_Pictographic}\s]*)$/u.test(herLast.content.trim()) || /\?\s+\S/.test(herLast.content);
  return { herLast, theirLast, quietMin: Math.round(quiet / 60_000), sheAsked, ridesOnHisAsk: ridesOnHisAsk(theirs), key: herLast.id ?? herLast.at };
}

// Whether he actually owes her an answer.
//
// `sheAsked` is a question mark, and a question mark is not a debt. Her replies
// end on a question roughly half the time — measured on 2026-09-20, nine of
// sixteen — because that is how she talks, not because she is waiting on
// anything. Chasing every one of them is how he came to be scolded at work for
// going quiet after "thanks": he had asked what a 5080 draws, she had told him,
// and the question on the end was hers to drop.
//
// Two of her questions in that fortnight genuinely blocked something he had
// asked her to do — "you got the Jellyfin app running or just the browser tab?"
// is the difference between playing his episode and not. No pattern separates
// those from the riders; the words are the same shape. So the cheap brain that
// already writes her nudges is asked, once, before she chases.

export type Verdict = 'blocking' | 'rider';

/** What the judge is deciding, worded as the test it applies. */
export function judgePrompt(): string {
  return [
    'Haru is an assistant who lives with one user. She replied to him and her reply ended with a question. He has not answered.',
    'Decide whether he owes her an answer. Exactly one of:',
    '',
    'BLOCKING — she cannot finish something he actually asked her to do until he answers. His request is still open and her question is what is holding it up: which of two things he meant, which device to use, which file, whether to go ahead.',
    'RIDER — she has already given him the answer or said her piece in full. The question on the end is conversation, curiosity, a dig or a rhetorical jab. Nothing of his is waiting on it.',
    '',
    'Judge what the question does, not how it is worded:',
    '"I can only put it on whatever player you have open. You got the Jellyfin app running or just the browser tab?" — BLOCKING: he asked her to play something and she cannot until he says which.',
    '"Around 360W, with NVIDIA recommending an 850W PSU. What\'s the rest of the build?" — RIDER: he asked what it draws and she told him.',
    '"That\'s not \'beyond lunch\', that\'s \'you forgot to eat entirely\'. What\'d you have, a coffee and a sense of accomplishment?" — RIDER: a jab, not a question.',
    '"I remember your Sundays. Why, what were you hoping I\'d seen?" — RIDER: curiosity after a complete answer.',
    '',
    'Answer with one word, BLOCKING or RIDER, and nothing else.',
  ].join('\n');
}

/** The exchange, as the judge reads it. */
export function judgeInput(hanging: Pick<Hanging, 'herLast' | 'theirLast'>): string {
  const tidy = (text: string) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return `He said: ${tidy(hanging.theirLast.content)}\n\nShe replied: ${tidy(hanging.herLast.content)}\n\nBLOCKING or RIDER?`;
}

/**
 * The answer, read strictly. Anything that is not one of the two words is no
 * answer at all — the caller falls back to ridesOnHisAsk rather than guessing,
 * because a judge that shrugs should not decide whether she gets to chase.
 */
export function readJudgement(answer: string): Verdict | null {
  const said = String(answer ?? '').toUpperCase();
  const blocking = said.lastIndexOf('BLOCKING'), rider = said.lastIndexOf('RIDER');
  if (blocking < 0 && rider < 0) return null;
  return blocking > rider ? 'blocking' : 'rider';
}
