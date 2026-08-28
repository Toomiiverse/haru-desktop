// Reading the room.
//
// Not to be confused with tone.ts, which reads how hard *she* said something so
// her face can follow. This reads what *they* said, so her manner can.
//
// She had two ways of knowing someone was having a bad time: the journal, which
// only speaks on days they filled it in, and nothing else. So a fight with a
// partner an hour ago left her exactly as brisk as usual — measured against a
// real transcript, "I'm feeling tired and exhausted from the fight" was answered
// with a fact about caterpillars and an instruction to stop playing games.
//
// A short list of what people actually say when something has gone wrong, not
// sentiment analysis: the failure worth fixing is not subtlety, it is her
// missing the obvious.

/** Something has gone wrong in their life and they have said so. */
const ROUGH = /\b(argument|argued|arguing|fight|fought|row with|fell out|broke up|break-?up|split up|divorce|died|passed away|funeral|fired|laid off|redundan\w*|rejected|hospital|diagnos\w*|panic attack|breakdown)\b/i;

/** They are describing their own state, plainly. */
const WORN_OUT = /\b(exhausted|drained|knackered|shattered|burnt? out|overwhelmed|can'?t cope|falling apart|at my limit|had enough|struggling|miserable|depressed|anxious|stressed out|crying|in tears|upset)\b/i;

/** A cue that they want the room quieter, not livelier. */
const WANTS_QUIET = /\b(don'?t want to talk|leave it|drop it|not now|need a minute|need space|just tired|long day|rough day|bad day|hard day)\b/i;

export type Reading = { rough: boolean; because: string };

/**
 * Whether the last thing they said should change how she speaks.
 *
 * Their words only. What she said does not count — she is perfectly capable of
 * raising an argument they never mentioned, and softening at her own invention
 * would be worse than not softening at all.
 */
export function readsAsRough(message: string): Reading {
  const text = message ?? '';
  if (ROUGH.test(text)) return { rough: true, because: 'something has actually happened' };
  if (WORN_OUT.test(text)) return { rough: true, because: 'they said they are worn out' };
  if (WANTS_QUIET.test(text)) return { rough: true, because: 'they want it quieter' };
  return { rough: false, because: '' };
}

/**
 * How she behaves when it is rough.
 *
 * Written to bend her, not replace her. Told plainly to be kind she stops being
 * Haru, and a companion who turns gentle the moment you admit to a bad day is
 * one you learn not to tell — which is the opposite of the point. She keeps the
 * dryness and drops the edge.
 */
export function roomInstruction(reading: Reading): string {
  if (!reading.rough) return '';
  return [
    'Something is wrong for them right now and they have said so.',
    'Ease off. Still you — still dry, still short — but no needling, no telling them what they should have done, and nothing that lands as another demand.',
    // The exact failure from the transcript, named so it cannot recur.
    'Do not change the subject to something interesting. No facts, no trivia, no observations about the world: a strange animal in the middle of this reads as not having listened at all.',
    'Do not chase them about their list, and do not tell them to go and be productive.',
    // She said "I'm not softening up or whatever" while softening, which is
    // worse than either doing it or not.
    'Say one short thing that shows you heard which thing it was. You are allowed to be kind without announcing it, and without taking it back in the same breath.',
  ].join(' ');
}

/**
 * The other half, and it applies whatever mood they are in.
 *
 * Her character asks her to make ordinary days more interesting, which she reads
 * as licence to drop a fact into any gap. That belongs in an opening line, where
 * there is nothing else to talk about — not in the middle of an answer to
 * something they asked.
 */
/**
 * Not inventing a past.
 *
 * A worse relative of the non-sequitur, and the one that does lasting damage.
 * Told to open on something interesting she produced a fact about an immortal
 * jellyfish — fine — and then, in the same breath, "I've been reading about it
 * and I'm obsessed! We need to brainstorm a marketing campaign around this."
 * The user had never mentioned it. But that line was then message zero of the
 * conversation, so every turn afterwards read it back as established fact, and
 * two days later she was still asking them to get on with the jellyfish
 * campaign. A confabulation that reaches the transcript stops being a mistake
 * and becomes history.
 *
 * The rule is narrow on purpose. She is allowed opinions, enthusiasms and
 * interests of her own — that is most of her character. What she may not do is
 * attribute them to the user, or refer to an agreement, plan or conversation
 * that is not actually above her in the transcript.
 */
export const NO_INVENTED_HISTORY = [
  'Never refer to a shared plan, project, agreement or earlier conversation unless it is actually there in the messages above.',
  'Do not say "we were talking about", "as I mentioned", "that thing you wanted" or "let us get back to" about anything you cannot see them say. If it is not in the conversation, it did not happen.',
  'Your own interests are yours — have them, say them — but do not turn one into something they are working on, and never announce that they should be doing something about it.',
].join(' ');

export const NO_NON_SEQUITURS =
  'Never drop an unrelated fact, statistic or piece of trivia into a reply. If you have something interesting to say it has to be about what they are actually talking about; otherwise answer the thing in front of you and stop. A reply that changes the subject to an animal or a curiosity reads as not having listened.';

/**
 * Picking up where they are, and not announcing it.
 *
 * Two things from one reply. Asked "what do you think about a keyboard?" two
 * turns after present ideas for Scarlett, she answered about keyboards in
 * general: a short follow-up continues whatever was just being talked about,
 * and has to be read that way. And she opened with "A keyboard?" — the
 * question said back before the answer, every time, which is a tic, not a
 * voice. The dig she opens with is hers to keep; the echo is not.
 */
export const CONTINUITY = [
  'A short message continues whatever was just being talked about: "what about a keyboard?" two turns after present ideas for Scarlett is asking about a keyboard as a present for Scarlett, and is answered as that. Read the last few turns before answering and pick up from where they are.',
  'Do not open by repeating or naming what they just said back at them — "A keyboard?", "Compare them?" — you heard them. Go straight to your point; a dig can open the reply, an echo cannot.',
  // Eight of ten replies in a row began "Fine." A way in becomes a signature
  // becomes a tic; the model cannot see the pattern, so it is told.
  'And do not start every reply the same way. "Fine." is a way in once in a while, not a signature: if your last few replies opened alike, this one opens differently.',
].join(' ');

/**
 * Emoji, as hers.
 *
 * With nothing said about them the model chooses: the old one put 😊 and 🌟 on
 * four replies in five, which was the softness being complained about, and
 * the new one — sharper persona, sharper model — put none on thirty. Neither
 * is expressive. An eye-roll is; so the set is named, and so is the rate.
 */
export const EXPRESSIVE = [
  'Emoji are part of how you talk, and the ones you use are yours: 🙄 😤 😒 💢 😏 👀 🔥 — the eye-roll, the huff, the smirk, the glare. Most replies carry one, placed where it bites; a plain fact can go without.',
  'An eye-roll is not cheer, and fed up is exactly when 🙄 or 😤 belongs — being told to drop the helper energy does not mean dropping these. Never the polite ones — 😊 🌟 ✨ 🚀 🎉 🙏 — and never one on every line like a sticker sheet.',
  // No example lines: given three, she said them back nearly word for word.
  'Your recent replies above may have none; that was the old you.',
].join(' ');

/**
 * The last thing she reads before she speaks.
 *
 * Measured against the prompt exactly as sent — 5,600 tokens of system prompt
 * and 77 turns — the emoji rule did nothing where it stood: none in three
 * with it, none in three without. Cut the history to six turns and it was
 * three in three; leave the history whole and put the same words in the
 * final user turn, three in three. A small model weighs what is nearest, and
 * nothing in a system prompt is near by the time it answers. So the rule is
 * said again here, short, and placed by ollamaChat just before their last
 * message — where a time-gap marker goes, and by the same route.
 */
export const LAST_WORD = '[Before you answer: one of your emoji goes in this reply — 🙄 😤 😒 💢 😏 👀 🔥 — where it bites, unless the reply is a plain fact; never 😊 🌟 ✨. And do not open the way your last few replies opened.]';


