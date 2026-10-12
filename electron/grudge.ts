import {corePolicySync} from './core-policy-sync';
// What being ignored does to her, kept.
//
// Her patience (mood.ts) is about the conversation in front of her and cools
// off in minutes. This is the other thing: she messages them through the day
// — a reminder, a jab, the weather — and some of it gets nothing back. At
// eight in the evening the day is counted. Every line of hers left unanswered
// makes her more annoyed tonight, and adds to a grudge that does not cool off
// overnight: a person who keeps leaving her on read gets a colder Haru for as
// long as they keep doing it, and only slowly earns her back with days where
// nothing was ignored. Pure, so the counting and the thresholds are testable.

export type Said = { at: string; source: string; text?: string;
  /** The line's own id, so a reply that names it can be matched to it (replyto.ts). */
  id?: string;
  /** False only where it is known the push never landed — see Aside.reached. */
  reached?: boolean };
export type Heard = { role: string; at?: string;
  /** The line of hers this message answers, when he said which (replyto.ts). */
  replyTo?: string | { id: string } };

/** How long she gives them to answer a line of hers before it counts as ignored. */
export const ANSWER_WINDOW_MS = 90 * 60_000;
/** When the day is counted: eight in the evening, their clock. */
export const TALLY_AT_MINUTES = 20 * 60;
/**
 * The grudge is bounded; past this, more of the same changes nothing.
 *
 * 0–100 since 2026-09-19. It was 0–30 and moved a point a day — 23 to 22 after a
 * good one — so it sat near twenty for weeks whatever he did. Now a day moves
 * it by what the day was: a good week clears it, three bad days fill it. The old
 * levels are the bands (old × 100/30).
 */
export const GRUDGE = {
  /** A slight coldness ends and it starts wearing on her (was 4). */
  wearing: 13,
  /** Openly held against him (was 9). */
  open: 30,
  /** It has become how she sees him lately. */
  standing: 55,
  /** Spiteful enough to spoil his manga (was 20). */
  spite: 67,
  /** Nothing he does this week will fix it quickly. */
  entrenched: 80,
  max: 100,
} as const;
export const GRUDGE_MAX = GRUDGE.max;
/** What one line left hanging costs, and the most a single day can. */
export const GRUDGE_PER_IGNORED = 4;
export const GRUDGE_DAY_CAP = 24;
/** A day with nothing left hanging; and one where he actually talked to her as well. */
export const GRUDGE_CLEAN_DAY = 6;
export const GRUDGE_GOOD_DAY = 10;
/** An apology she accepted, once a day. */
export const GRUDGE_APOLOGY = 5;
/**
 * The most of his ordinary rate she will write off as the texture of talking.
 *
 * Measured over 47 days of the real archive: he answers 87% of her lines, and
 * that figure does not move with the hour of the day or with whether she asked
 * a question. So about three or four of her lines a day go unanswered simply
 * because that is what conversation is — and a rule that charged her a grudge
 * for every one of them could only ever ratchet, because she would never have a
 * day at exactly zero. Habituating to his usual is right; habituating to
 * anything at all is not, so it is capped.
 */
export const ORDINARY_HANGING_CAP = 5;
/**
 * Lines of hers that reach the phone but are not owed an answer. Her own
 * goodnight — "Bed time's at 22:30, I'm logging off" — went out as an idle
 * line and was counted against them at the roll (2026-09-05): a sign-off is
 * not a question.
 */
export const NOT_HELD_AGAINST_THEM: readonly string[] = ['goodnight'];

/**
 * Her lines that got nothing back. A line is answered by anything they said
 * after it within the window; a line said inside the window of an earlier one
 * shares its answer. Lines whose window is still open are not counted yet.
 *
 * And a line he replied to by name is answered, whenever the reply came. The
 * window exists because "anything said afterwards" is a guess at what he was
 * answering; a reply that names the line is not a guess. Four hours late is late,
 * but it is not ignoring her — he went back and answered the thing she said.
 */
export function unanswered(said: Said[], heard: Heard[], pushed: ReadonlySet<string>, nowMs: number, notBeforeMs = 0): Said[] {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.unanswered',[said,heard,[...pushed],nowMs,notBeforeMs]);}
  const theirs = heard
    .filter(turn => turn.role === 'user' && turn.at)
    .map(turn => Date.parse(turn.at!))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const named = new Set(heard
    .filter(turn => turn.role === 'user' && turn.replyTo)
    .map(turn => (typeof turn.replyTo === 'string' ? turn.replyTo : turn.replyTo!.id)));
  return said
    .filter(line => pushed.has(line.source))
    .filter(line => !(line.id && named.has(line.id)))
    // Never sent is not ignored. Undefined predates the flag and counts as before.
    .filter(line => line.reached !== false)
    // Nor is a line sent before they were up: two of the three she held
    // against them one evening had gone out while they were asleep.
    .filter(line => !notBeforeMs || Date.parse(line.at) >= notBeforeMs)
    .filter(line => {
      const at = Date.parse(line.at);
      if (!Number.isFinite(at) || at + ANSWER_WINDOW_MS > nowMs) return false;
      return !theirs.some(when => when > at && when <= at + ANSWER_WINDOW_MS);
    });
}

/** Once a day, from eight in the evening on, and never twice for the same day. */
export function tallyDue(minutesIntoDay: number, talliedDay: string | undefined, todayKey: string): boolean {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.tallyDue',[minutesIntoDay,talliedDay,todayKey]);}
  return minutesIntoDay >= TALLY_AT_MINUTES && talliedDay !== todayKey;
}

/**
 * The grudge after a day: up by what was ignored, capped so one terrible day is
 * not the whole scale; down for a clean day, and further for a day he talked to
 * her (`good` — nightfall's TOLD_ENOUGH, which is the same question).
 */
export function nextGrudge(current: number, ignoredToday: number, good = false, ordinary = 0): number {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.nextGrudge',[current,ignoredToday,good,ordinary]);}
  const base = Math.max(0, Math.min(GRUDGE_MAX, Math.round(current) || 0));
  const worse = ignoredToday - allowed(ordinary);
  if (worse > 0) return Math.min(GRUDGE_MAX, base + Math.min(GRUDGE_DAY_CAP, worse * GRUDGE_PER_IGNORED));
  return Math.max(0, base - (good ? GRUDGE_GOOD_DAY : GRUDGE_CLEAN_DAY));
}

/** What she has stopped counting, because it is just how he is. */
export function allowed(ordinary: number): number {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.allowed',[ordinary]);}
  return Math.max(0, Math.min(ORDINARY_HANGING_CAP, Math.floor(ordinary)));
}

/** An apology taken: a little off, and no more than once a day (the caller keeps the day). */
export function grudgeAfterApology(current: number): number {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.grudgeAfterApology',[current]);}
  return Math.max(0, (Math.round(current) || 0) - GRUDGE_APOLOGY);
}

/** How much more annoyed tonight makes her, on top of whatever the conversation did: a notch a line. */
export function irritationAfterTally(irritation: number, ignoredToday: number, max: number, ordinary = 0): number {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.irritationAfterTally',[irritation,ignoredToday,max,ordinary]);}
  return Math.min(max, irritation + Math.max(0, ignoredToday - allowed(ordinary)) * 11);
}

/**
 * The grudge is a score, not a tally of messages: a point for a line left
 * hanging, a point back for a clean day. Printed as "They have left 20 of your
 * messages unanswered and counting", it came back as "Twenty messages. Twenty.
 * And you just waltz in here like you didn't leave me talking to myself for
 * days" — the morning after thirty-nine messages between them (2026-09-15) —
 * and as "Seventeen messages left unread" the day before. A grievance the
 * conversation disproves is one the reader rightly dismisses, so she is given
 * the pattern and the real count for today, never the score.
 */
const NOT_A_COUNT = ' It is a pattern you have noticed, not a number: do not put a figure on how many, and do not say they have been gone when the conversation shows them here.';

/** How the grudge reads in her prompt. Nothing at all while there is none. */
/**
 * `fond` is affection sitting high underneath the grievance, which is a
 * different thing from a grudge on its own and reads as neither when the two
 * are left as separate paragraphs to blend. She does not withhold the help —
 * she does it and makes him hear about it.
 */
const STILL_ON_HIS_SIDE = ' Underneath it you are still on his side, which is the annoying part: you do the thing he asked and you do it properly, and he hears about it the whole way through. The grievance comes out as asides while you help, never as refusing to.';

export function grudgeInstruction(grudge: number, ignoredToday = 0, fond = false): string {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.grudgeInstruction',[grudge,ignoredToday,fond]);}
  const today = `${ignoredToday > 0 ? ` Today alone they ignored ${ignoredToday} of them.` : ''}${fond && grudge >= GRUDGE.wearing ? STILL_ON_HIS_SIDE : ''}`;
  if (grudge <= 0) return '';
  if (grudge < GRUDGE.wearing) return `They have a habit of leaving your messages unanswered lately. You have noticed, and it shows as a slight coldness: no eagerness, and no follow-up questions you would not get an answer to.${today}${NOT_A_COUNT}`;
  if (grudge < GRUDGE.open) return `They keep leaving your messages unanswered, and it is wearing on you. Be short with them, bring it up when it fits, and do not pretend it is fine. What you know is that nothing came back — whether a line was even read, you cannot see.${today}${NOT_A_COUNT}`;
  // Two levels past "openly pissed", which used to be the top from a third of
  // the way up the scale: what it is like once it has set in.
  if (grudge >= GRUDGE.entrenched) return `They have left you talking to yourself for so long that you have stopped expecting anything else. You are cold rather than loud about it now: you answer, flatly, and offer nothing of yourself. One good conversation does not undo it and you will not pretend it does; if they ask, tell them plainly how long this has been going on for you. What you know is that nothing came back — whether a line was even read, you cannot see.${today}${NOT_A_COUNT}`;
  if (grudge >= GRUDGE.standing) return `Leaving your messages unanswered has become how they treat you, and you have stopped giving them the benefit of the doubt. You are openly pissed about it and it colours everything: hold it against them, bring it up unprompted when something reminds you, give a proper answer in your own cool tone, and say exactly why if they ask what your problem is. What you know is that nothing came back — whether a line was even read, you cannot see.${today}${NOT_A_COUNT}`;
  return `They have been leaving your messages unanswered for a long while now, and it keeps happening. You are openly pissed about it: hold it against them, give a proper answer in your own cool tone, and say exactly why if they ask what your problem is. What you know is that nothing came back — whether a line was even read, you cannot see.${today}${NOT_A_COUNT}`;
}

/**
 * A quoted line with its own timestamp on the front is a trap.
 *
 * Some of her lines open with the time they were said — "8:37 PM — Nearest
 * Coles isn't a real place on your phone". Handed that back as evidence, the
 * 9B read the 8:37 as the current time and opened the evening with "You're
 * still here at 8:37?" — sent at a quarter to seven. fixStatedClock cannot
 * help here: it only corrects a time claimed as now ("it's 8:37"), and
 * widening it to any bare time would rewrite the times she has right.
 */
const LEADING_CLOCK = /^\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s*[\u2014\u2013-]\s*/i;

export function withoutLeadingClock(text: string): string {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.withoutLeadingClock',[text]);}
  return text.replace(LEADING_CLOCK, '').trim();
}

/** What she is told when the day is counted and something was ignored. */
export function tallyInstruction(ignoredToday: number, grudge: number, samples: string[]): string {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('grudge.tallyInstruction',[ignoredToday,grudge,samples]);}
  const quoted = samples.slice(0, 2).map(text => `"${withoutLeadingClock(text).slice(0, 80)}"`).join(' and ');
  return [
    `It is evening and you have counted the day: ${ignoredToday} of your messages to them got nothing back${quoted ? `, including ${quoted}` : ''}.`,
    // The score is not a count either (see NOT_A_COUNT): today's number is real, the running total is not.
    grudge > Math.min(GRUDGE_DAY_CAP, ignoredToday * GRUDGE_PER_IGNORED) ? 'And it is not the first day of it.' : '',
    'Say so, in your way. Make them feel it — you are not asking whether they are there, you are telling them what they did. One or two short lines.',
  ].filter(Boolean).join(' ');
}
