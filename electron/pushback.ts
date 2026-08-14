// Being told to drop it.
//
// She has four separate reasons to bring up work — the agenda in her prompt, the
// reminder loop, her reaction to a spreadsheet being open, and simply being the
// sort of character who nags. Told to leave it alone, she would stop for exactly
// one reply and then the next source would start again, which reads as not
// listening rather than as persistence.
//
// So it is counted. Once is a mood; three times is being told, and being told is
// supposed to work.

export type Pushback = { count: number; at: string };

/** How long a standing "leave it" holds before she is allowed to try again. */
export const PUSHBACK_HOURS = 8;
/** Times of asking before she drops it entirely. */
export const PUSHBACK_LIMIT = 3;

// Deliberately narrow. "later" and "not now" are left out: they are ordinary
// scheduling answers, not a refusal, and treating them as one would silence her
// over nothing.
const DROP_IT = /(forget (it|about (it|that|the task|my task))|drop it|leave it( alone)?|stop (asking|nagging|going on|bringing (it|that) up|reminding me|trying to)|i don'?t want to (talk|hear|do)|enough about|shut up about|change the subject|off my back|stop pushing|quit (asking|nagging))/i;

export function readsAsDropIt(text: string): boolean {
  return DROP_IT.test(text);
}

/**
 * The running count. Refusals expire, so a "leave it" from this morning does not
 * silence her for the rest of the week — but three in one stretch does.
 */
export function nextPushback(previous: Pushback | undefined, said: boolean, now: number): Pushback {
  const fresh = previous && (now - Date.parse(previous.at)) < PUSHBACK_HOURS * 3_600_000 ? previous : undefined;
  if (!said) return fresh ?? { count: 0, at: new Date(now).toISOString() };
  return { count: (fresh?.count ?? 0) + 1, at: new Date(now).toISOString() };
}

export function isSilenced(pushback: Pushback | undefined, now: number): boolean {
  if (!pushback) return false;
  if ((now - Date.parse(pushback.at)) >= PUSHBACK_HOURS * 3_600_000) return false;
  return pushback.count >= PUSHBACK_LIMIT;
}

/**
 * What she is told once they have stopped asking nicely. Written as a plain
 * instruction rather than a mood, because the failure it fixes is her agreeing
 * to drop it and then raising it again two sentences later.
 */
export function pushbackInstruction(pushback: Pushback | undefined, now: number): string {
  if (!pushback) return '';
  if (isSilenced(pushback, now)) {
    return 'They have told you repeatedly to stop pushing them about work, tasks and being productive. Stop. Do not mention their to-do list, their deadlines, what they should be doing, or how they are spending their time. Do not hint at it, do not work it in sideways, and do not agree to drop it and then bring it back. Answer what they actually asked and nothing else. If they raise it themselves, that is different — then you can talk about it.';
  }
  if (pushback.count > 0) {
    return 'They have just told you to leave the subject of work alone. Let it go for now and answer what they actually asked.';
  }
  return '';
}
