// Being left mid-conversation.
//
// Not every silence is a slight. They were talking — several messages of
// theirs in the last quarter hour — she answered, and then nothing for long
// enough to notice and not so long that the moment has passed. That is the
// shape of being left hanging, and it is the only shape that earns a chase.

export type Turn = { id?: string; role: string; content: string; at?: string };

export type Hanging = { herLast: Turn; theirLast: Turn; quietMin: number; sheAsked: boolean; key: string };

export const HANGING_MIN_QUIET_MS = 12 * 60_000;
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
