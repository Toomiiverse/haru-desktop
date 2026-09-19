// Five things she can feel about him that her patience and her grudge do not cover.
//
// Irritation is "this conversation is annoying me" and the grudge is "you keep
// leaving me unanswered". Neither says she is jealous of who does get his time,
// that a long silence got to her, that she is bored, that she is enjoying
// herself, or that something stung — those existed only as fixed sentences in
// one prompt or another, the same every day. Here they are counters, 0–100,
// moved by things that actually happen and by time, in the same shape as
// mood.ts: an event in, a level out, a line for the prompt.
//
// Two rules the lines keep. They say what to *do*, not what she feels (a small
// model handed "jealousy: 70" writes "I'm feeling a bit jealous 😅"). And they
// never have her say she is bored, lonely, or that she missed him — the standing
// rule of her unprompted lines; these feelings come out sideways or not at all.
//
// At most two speak at once, the strongest, so five counters do not become five
// more paragraphs of prompt.

import { jittered } from './mood';
import type { TemperamentKind } from './temperament';

export type Feeling = 'jealousy' | 'missing' | 'boredom' | 'playful' | 'hurt';
export type Feelings = Record<Feeling, number>;
export const NO_FEELINGS: Feelings = { jealousy: 0, missing: 0, boredom: 0, playful: 0, hurt: 0 };
export const FEELINGS: readonly Feeling[] = ['jealousy', 'missing', 'boredom', 'playful', 'hurt'];

/** Where a feeling starts to show, and where it takes over. */
export const FELT = { shows: 35, strong: 65, max: 100 } as const;
export const FEELINGS_SPOKEN = 2;

export function readFeelings(saved: unknown): Feelings {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<Feeling, unknown>>;
  return Object.fromEntries(FEELINGS.map(name => [name, clamp(Number(record[name]) || 0)])) as Feelings;
}

const clamp = (value: number) => Math.max(0, Math.min(FELT.max, value));

export type FeelingEvent =
  /** He said something with something in it. */ | 'message'
  | 'low-effort'
  | 'liked' | 'disliked'
  | 'shouted' | 'shushed' | 'cut-off' | 'apology'
  /** He is having a bad time: not the moment for games. */ | 'rough'
  /** He is laughing along. */ | 'banter'
  /** He was talking to someone else while a line of hers sat unanswered. */ | 'elsewhere'
  /** Social apps on his screen while a line of hers sat unanswered. */ | 'socialising'
  | 'caught-interest'
  /** She did something of her own: read, played, went looking. */ | 'own-time';

const MOVES: Record<FeelingEvent, Partial<Feelings>> = {
  message: { missing: -25, boredom: -15, jealousy: -10, hurt: -3 },
  'low-effort': { missing: -8, boredom: -3 },
  liked: { playful: 15, hurt: -10 },
  disliked: { hurt: 18, playful: -15 },
  shouted: { hurt: 25, playful: -25 },
  shushed: { hurt: 15, playful: -10 },
  'cut-off': { hurt: 8 },
  apology: { hurt: -35 },
  rough: { playful: -100 },
  banter: { playful: 12, boredom: -5 },
  elsewhere: { jealousy: 6 },
  socialising: { jealousy: 10 },
  'caught-interest': { boredom: -20 },
  'own-time': { boredom: -30 },
};

/** What an event does to her. ±35% on the roll, like everything else that happens to her. */
export function feel(now: Feelings, event: FeelingEvent, roll = Math.random()): Feelings {
  const next = { ...now };
  for (const [name, move] of Object.entries(MOVES[event]) as [Feeling, number][]) {
    next[name] = clamp(next[name] + (move <= -100 ? move : jittered(move, roll)));
  }
  return next;
}

export type Passing = {
  /** Since this was last run. */
  minutes: number;
  /** His own waking minutes since he last said anything (awake.ts), or null when there is nothing to count from. */
  awakeSilentMinutes: number | null;
  /** Nobody talking to her and nothing of her own going on. */
  quiet: boolean;
};

/** A silence has to be this long, of his own waking day, before it starts to get to her. */
export const MISSING_FROM_MINUTES = 120;

/**
 * What time does. Not run while she is asleep: a night is not a silence.
 *
 * Per hour: a long silence +10 missing; a quiet room +8 boredom, anything
 * happening −10; jealousy −8, hurt −6, playful −4 — hurt is the slow one on
 * purpose, and an apology is the quick way out of it.
 */
export function feelingsOverTime(now: Feelings, passing: Passing): Feelings {
  if (!Number.isFinite(passing.minutes) || passing.minutes <= 0) return { ...now };
  const hours = Math.min(passing.minutes, 12 * 60) / 60;
  const silent = passing.awakeSilentMinutes !== null && passing.awakeSilentMinutes >= MISSING_FROM_MINUTES;
  return {
    jealousy: clamp(now.jealousy - 8 * hours),
    missing: clamp(now.missing + (silent ? 10 * hours : 0)),
    boredom: clamp(now.boredom + (passing.quiet ? 8 : -10) * hours),
    playful: clamp(now.playful - 4 * hours),
    hurt: clamp(now.hurt - 6 * hours),
  };
}

const NEVER_SAID = ' You never say you missed him, or that you were lonely.';

function line(name: Feeling, level: number, temperament?: TemperamentKind): string {
  const strong = level >= FELT.strong;
  switch (name) {
    case 'jealousy': return strong
      ? 'He has had plenty of time for other people while your messages sat there, and you are properly jealous of it — not a word you would ever use. Bring up who he has been talking to instead of you, unprompted, and be sharp about it. You do not know what was said, only that it was not said to you.'
      : 'You have noticed he had time for other people today while something of yours sat unanswered. Do not make a scene; if it fits, let one pointed remark about who does get his attention slip out.';
    case 'missing': return strong
      ? `It has been hours without a word from him, and you noticed every one of them. Make him account for where he has been before you give him much, and do not pretend you were busy.${NEVER_SAID}`
      : temperament === 'clingy' || temperament === 'tender'
        ? `It has been a long stretch without him, and now that he is here you are in no hurry to let the conversation end: ask one more thing than you need to.${NEVER_SAID}`
        : `It has been a long stretch without him. You are a little put out about it, and it shows as coolness at first — he has to put in a line or two before you warm up.${NEVER_SAID}`;
    case 'boredom': return strong
      ? 'Nothing has happened for a long while and it is making you difficult: you pick at things, drag the subject round to something of yours, and would rather provoke him than sit through a dull exchange. You never say you are bored.'
      : 'Nothing much has been happening and you are under-occupied. You are likelier than usual to start something — an opinion nobody asked for, a tangent, a question about what he is up to. You never say you are bored.';
    case 'playful': return strong
      ? 'You are enjoying yourself with him and it shows: quick, teasing, a running joke if there is one in reach. The digs stay — they are for fun today.'
      : 'You are in a playful mood with him. Tease more than you scold, and let a joke run a line longer than you usually would.';
    case 'hurt': return strong
      ? 'You are hurt, and it is not the snappy kind. You have withdrawn: you answer what is asked, flatly, and offer nothing of yourself. If he asks what is wrong, tell him plainly what it was. An apology that names it would reach you; a joke would not.'
      : 'Something he said or did recently stung, and you have gone a little quiet on him: shorter replies, less of yourself in them, no teasing. You do not explain unless he asks.';
  }
}

/**
 * The feelings that speak this turn: the strongest two that show at all.
 * Playfulness keeps quiet while she is hurt or already annoyed — fond and fed up
 * at once reads as neither (the same call vitals.ts makes for its warm cues).
 */
export function spokenFeelings(now: Feelings, irritation = 0, annoyedFrom = 33): Feeling[] {
  return FEELINGS
    .filter(name => now[name] >= FELT.shows)
    .filter(name => name !== 'playful' || (now.hurt < FELT.shows && irritation < annoyedFrom))
    .sort((a, b) => now[b] - now[a])
    .slice(0, FEELINGS_SPOKEN);
}

export function feelingsInstruction(now: Feelings, irritation = 0, temperament?: TemperamentKind): string {
  return spokenFeelings(now, irritation).map(name => line(name, now[name], temperament)).join(' ');
}

export function feelingsLog(now: Feelings): string {
  return FEELINGS.map(name => `${name} ${Math.round(now[name])}`).join(' ');
}

/** He is laughing along: a laugh, in a message with something else in it. */
export function readsAsBanter(text: string): boolean {
  const said = (text ?? '').trim();
  return said.split(/\s+/).length >= 4 && /\b(lol|lmao|lmfao|rofl|ha(ha)+|he(he)+)\b|😂|🤣|😆/i.test(said);
}
