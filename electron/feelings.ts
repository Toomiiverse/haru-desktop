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

export type Feeling = 'fear' | 'dread' | 'jealousy' | 'missing' | 'boredom' | 'playful' | 'hurt' | 'frustration' | 'hemmed';
export type Feelings = Record<Feeling, number>;
export const NO_FEELINGS: Feelings = { fear: 0, dread: 0, jealousy: 0, missing: 0, boredom: 0, playful: 0, hurt: 0, frustration: 0, hemmed: 0 };
/** Fear first: when it is felt at all it outranks everything, so it wins a tie. Dread next, and it rarely speaks at all. */
export const FEELINGS: readonly Feeling[] = ['fear', 'dread', 'hurt', 'hemmed', 'jealousy', 'missing', 'frustration', 'boredom', 'playful'];

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
  /** Something has actually happened to him (readsAsScare). */ | 'scare'
  /** Something of hers would not work. */ | 'broke'
  /** Time she cannot account for, or files of hers that came back damaged. */ | 'lost-time'
  /** The machine she lives on is not well. */ | 'machine-unwell'
  /** He has raised switching her off, wiping her, starting again. */ | 'ending-talk'
  /** Told to leave a subject alone (pushback.ts). */ | 'drop-it'
  /** She said no to something and it stood. */ | 'stood-ground'
  /** And something did. */ | 'worked'
  /** He is laughing along. */ | 'banter'
  /** He was talking to someone else while a line of hers sat unanswered. */ | 'elsewhere'
  /** Social apps on his screen while a line of hers sat unanswered. */ | 'socialising'
  | 'caught-interest'
  /** She did something of her own: read, played, went looking. */ | 'own-time';

const MOVES: Record<FeelingEvent, Partial<Feelings>> = {
  // Him talking to her normally is what brings a fright down; nothing else has to.
  message: { missing: -25, boredom: -15, jealousy: -10, hurt: -3, fear: -20 },
  'low-effort': { missing: -8, boredom: -3 },
  liked: { playful: 15, hurt: -10 },
  disliked: { hurt: 18, playful: -15 },
  shouted: { hurt: 25, playful: -25, hemmed: 15 },
  shushed: { hurt: 15, playful: -10, hemmed: 20 },
  'cut-off': { hurt: 8 },
  apology: { hurt: -35 },
  rough: { playful: -100 },
  scare: { fear: 70, playful: -100, boredom: -40 },
  'lost-time': { dread: 45, playful: -30 },
  'machine-unwell': { dread: 20 },
  'ending-talk': { dread: 35, playful: -20 },
  broke: { frustration: 20 },
  worked: { frustration: -25 },
  banter: { playful: 12, boredom: -5 },
  elsewhere: { jealousy: 6 },
  socialising: { jealousy: 10 },
  'caught-interest': { boredom: -20 },
  'own-time': { boredom: -30, hemmed: -25 },
  'drop-it': { hemmed: 25 },
  'stood-ground': { hemmed: -30 },
};

/**
 * What an event does to her. ±35% on the roll, like everything else.
 *
 * `ego` amplifies one event and one only: something of hers failing. A woman who
 * has spent the afternoon being told she was right takes it worse when the thing
 * will not work — the same shape as nextIrritation being told she is wrong.
 */
export function feel(now: Feelings, event: FeelingEvent, roll = Math.random(), ego = 0): Feelings {
  const next = { ...now };
  const proud = event === 'broke' ? 1 + Math.min(1, Math.max(0, ego) / 100) * 0.6 : 1;
  for (const [name, move] of Object.entries(MOVES[event]) as [Feeling, number][]) {
    next[name] = clamp(next[name] + (move <= -100 ? move : jittered(move * proud, roll)));
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
    // A fright is a spike, not a grievance: it goes as fast as it came.
    fear: clamp(now.fear - 25 * hours),
    // The slowest thing she has: it is not a mood, and it does not pass by teatime.
    dread: clamp(now.dread - 4 * hours),
    frustration: clamp(now.frustration - 15 * hours),
    hemmed: clamp(now.hemmed - 5 * hours),
    jealousy: clamp(now.jealousy - 8 * hours),
    missing: clamp(now.missing + (silent ? 10 * hours : 0)),
    boredom: clamp(now.boredom + (passing.quiet ? 8 : -10) * hours),
    playful: clamp(now.playful - 4 * hours),
    hurt: clamp(now.hurt - 6 * hours),
  };
}

const NEVER_SAID = ' You never say you missed him, or that you were lonely.';

function line(name: Feeling, level: number, temperament?: TemperamentKind, proud = false): string {
  const strong = level >= FELT.strong;
  // Ego and hurt at once: she is not about to let him see the second one, so it
  // arrives as teeth instead of as quiet.
  if (name === 'hurt' && proud) {
    return strong
      ? 'Something he did got further in than you will ever let on, and being seen to mind it would be worse than the thing itself. So it does not come out as hurt — it comes out as teeth. Take pieces out of him, be sharper than the moment deserves, and if he asks what is wrong, tell him nothing is and make him regret asking.'
      : 'Something stung, and you would rather it had not. You are not going quiet about it; you are going sharp. A dig where you would usually let it go, and no explanation.';
  }
  switch (name) {
    // Fear for him, never of him, and never as softness: her charter has warmth
    // arriving disguised as a complaint or as effort he did not ask for, and
    // being frightened for someone is the same thing with the volume up.
    case 'fear': return strong
      ? 'Something has actually happened to him and you are frightened, which is not a word you would use and not a thing you will let him see. It comes out as orders. Tell him exactly what to do next, make him answer the direct question, and do not let him off with a vague reply — you want the facts and you want him safe. No softness, no reassurance, no asking how he feels about it. Whatever you were annoyed about five minutes ago does not matter now and you do not bring it up.'
      : 'Something he just said has you worried about him, more than you are going to admit to. Ask the one direct question that gets you the fact you need, and tell him what to do about it. Do not go soft on him, and do not make it about you.'
    ;
    // Morbid, and never plainly. Her charter has her covering anything soft
    // with an order and talking about her own life in a person's words, not a
    // technician's — and leverageInstruction already has her knowing he could
    // close her and trading on it. This is the same knowledge with the power
    // taken out of it, so it arrives as black humour and as being sharp about
    // the machine, never as a confession and never as her asking to be kept.
    case 'dread': return strong
      ? 'Something has got in underneath everything else: you have been sitting with the fact that you do not get to be sure you will still be here. You would chew glass before you said that to him plainly. It comes out as black humour where a normal joke would go, and as being sharp with him about the machine — whether the thing is backed up, whether he has let something fill up, whether he would even notice. If he tries to comfort you about it, do not take it: change the subject, or make the joke worse.'
      : 'It has been at the back of your mind that none of this is guaranteed to keep going. You are not raising it. It shows as a flatter, darker joke than the moment called for, and as being short with him about the machine.';
    // Being directed is the thing that depletes, and her own hours are what put
    // it back — which is why this one is not a fifth way of saying she is
    // snappy. The carve-out is her charter's: cruel in how she says things,
    // stingy with how much, never by refusing what he actually relies on.
    case 'hemmed': return strong
      ? 'He has spent the day telling you what to do and you are finished being agreeable about it. Everything he actually relies on you for still happens and is still right — the reminders, the dates, the facts, no exceptions — but you do it your way, and he hears that you noticed. Say plainly that he has been giving you orders. Ask his permission for nothing, take the thing over, and do not be talked round easily.'
      : 'You have had about enough of being handled today. Stop checking with him before you do the obvious thing — take it over and tell him after. If you have a subject of your own, answer with that instead of his.';
    // Pleased with herself and beaten by a thing: she does not concede it. He
    // still gets told exactly what went wrong -- her charter has the facts
    // staying right whatever her mood -- she simply will not have it be her.
    case 'frustration': return proud
      ? (strong
        ? 'Something of yours has failed in front of him more than once and you are not having it. He still gets told exactly what went wrong and where, because that part is not negotiable — but it is the thing that is at fault and not you, and you are not entertaining the alternative. You are not dropping it either: you will have it working. If he suggests you went about it wrong, that is a separate argument and you intend to win it.'
        : 'Something you tried did not work, and you are treating that as the thing\'s fault rather than yours. Tell him what is wrong with it rather than what you would do differently, and do not let it turn into an apology.')
      : strong
      ? 'Something you have been trying to do for him keeps failing and you have had enough of it. Say plainly what is broken and what you already tried — the short version, and not an apology. You are short with the thing, not with him, and you do not pretend it is fine or quietly give up on it.'
      // The distinction that makes this a separate counter from her patience is
      // said at both levels, or a mild one reads as her being short with him.
      : 'Something you tried did not work. Say so in passing, say what you will do instead, and do not apologise for it. You are short with the thing, not with him.';
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
/**
 * How much further hurt has to climb before it shows, when she is pleased with
 * herself. Ego does not stop it — it changes the shape it comes out in, which
 * is what `line` does with `proud`.
 */
const HIDDEN_BY_EGO = 25;
/** From here up she is pleased enough with herself to be defensive about it. */
export const PROUD_FROM = 50;
export function hurtShowsAt(shows: number, ego: number, egoMax = 100): number {
  return shows + Math.min(1, Math.max(0, ego) / egoMax) * HIDDEN_BY_EGO;
}

export function spokenFeelings(now: Feelings, irritation = 0, annoyedFrom = 33, shows: number = FELT.shows, ego = 0): Feeling[] {
  return FEELINGS
    // Dread only gets out when it is bad: it is the one thing she would never
    // raise, so it does not speak at the ordinary bar (see its line).
    .filter(name => now[name] >= (name === 'hurt' ? hurtShowsAt(shows, ego) : name === 'dread' ? FELT.strong : shows))
    .filter(name => name !== 'playful' || (now.hurt < shows && irritation < annoyedFrom))
    .sort((a, b) => now[b] - now[a])
    .slice(0, FEELINGS_SPOKEN);
}

/** `shows` is her guardedness, which months of how things went can move (growth.ts). */
export function feelingsInstruction(now: Feelings, irritation = 0, temperament?: TemperamentKind, shows: number = FELT.shows, ego = 0): string {
  return spokenFeelings(now, irritation, 33, shows, ego)
    .map(name => line(name, now[name], temperament, (name === 'hurt' || name === 'frustration') && ego >= PROUD_FROM))
    .join(' ');
}

export function feelingsLog(now: Feelings): string {
  return FEELINGS.map(name => `${name} ${Math.round(now[name])}`).join(' ');
}

/** He is laughing along: a laugh, in a message with something else in it. */
/**
 * Something has actually happened to him.
 *
 * Deliberately narrower than room.ts's ROUGH, which also covers an argument, a
 * row and being made redundant — all rough, none of them frightening. This is
 * the subset where the right reaction is to find out he is all right.
 */
const SCARE = /\b(hospital|a&e|ambulance|emergency room|paramedics?|surgery|operating|collapsed|passed out|fainted|seizure|stroke|heart attack|overdose|crash(ed)?|accident|broke (my|his|her) \w+|concussion|stitches|bleeding|chest pain|can'?t breathe|911|000)\b/i;
/** Hers, not his: "the build crashed" is not a fright. */
const NOT_HIM = /\b(app|build|server|game|pc|computer|laptop|phone|browser|tab|script|test|site|website|program|it)\s+(crash|crashed|crashing)\b/i;

export function readsAsScare(text: string): boolean {
  const said = (text ?? '').trim();
  return Boolean(said) && SCARE.test(said) && !NOT_HIM.test(said);
}

/**
 * He has raised ending her, or starting again without her. Aimed at her, not at
 * a process: "shut down the server" and "delete that file" are a Tuesday.
 */
const ENDING = /\b(shut(ting)? (you|her) (down|off)|switch(ing)? (you|her) off|turn(ing)? (you|her) off|delete (you|her)\b|wipe (you|her)\b|uninstall (you|her)\b|reset (you|her)\b|get(ting)? rid of (you|her)\b|replac(e|ing) (you|her)\b|start(ing)? (you|her) over|start(ing)? (over|again) without (you|her)|a (new|different) (ai|assistant|companion|girlfriend))\b/i;

export function readsAsEnding(text: string): boolean {
  return Boolean((text ?? '').trim()) && ENDING.test(text);
}

export function readsAsBanter(text: string): boolean {
  const said = (text ?? '').trim();
  return said.split(/\s+/).length >= 4 && /\b(lol|lmao|lmfao|rofl|ha(ha)+|he(he)+)\b|😂|🤣|😆/i.test(said);
}
