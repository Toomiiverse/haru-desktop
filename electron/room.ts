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
