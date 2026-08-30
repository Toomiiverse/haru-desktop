// Being left mid-conversation.
//
// Not every silence is a slight. They were talking — several messages of
// theirs in the last quarter hour — she answered, and then nothing for long
// enough to notice and not so long that the moment has passed. That is the
// shape of being left hanging, and it is the only shape that earns a chase.

export type Turn = { id?: string; role: string; content: string; at?: string };

export type Hanging = { herLast: Turn; theirLast: Turn; quietMin: number; sheAsked: boolean; key: string };

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
  return { herLast, theirLast, quietMin: Math.round(quiet / 60_000), sheAsked, key: herLast.id ?? herLast.at };
}
