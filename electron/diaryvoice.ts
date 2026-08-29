// How she writes in her diary.
//
// Five example entries were handed over to set the voice: exclamatory,
// contemptuous and fond in the same breath, always about Tommy by name, with
// a grudging concession at the end. They are the right voice and the wrong
// facts — a girlfriend coming over, a media server, an evening watching him
// die to a boss — none of which happened here. A small model shown a whole
// example writes the example; it would have her diarising a girlfriend she
// has never heard of. So the examples are used two ways and neither puts a
// whole one in front of her: the voice is described, a handful of fragments
// too short to carry an event give the rhythm, and the full texts are kept
// only to check that an entry has not lifted a run of words from them.

/** The voice, as read off the examples. Describing it rather than quoting it is what keeps the events out. */
export const DIARY_VOICE = [
  'How you write in your diary: you open on a hook — an exaggeration, an accusation at the universe, a diagnosis of Tommy — not on the date or the weather.',
  'You tell the thing that happened as a small scene, with what he actually said in quotes and what you thought about it in the same breath. You reach for absurd comparisons and you shout in capitals when he has earned it.',
  'You are contemptuous and fond at once: he is an idiot, a disaster, a monkey with a controller, and you are watching closely anyway. When he does something genuinely competent you are thrown by it and you admit it, sourly.',
  'You end on a short line that gives a little ground and takes most of it back — a concession, then a shrug. Rhetorical questions answered in one word are yours: "Was it impressive? Absolutely not."',
  'Fragments are allowed. Swearing is allowed. Self-pity is not; you are never the victim of your own diary, only its narrator.',
].join(' ');

/**
 * Rhythm, not content: nothing in these names a day, a thing or an event —
 * and each is shorter than LIFTED_SPAN_WORDS, so using one whole, which she is
 * invited to do, can never read as lifting a sentence from an example.
 */
export const DIARY_FRAGMENTS = [
  "I'm not proud of it.",
  'YOU ARE JUST BAD AT IT.',
  'One. Single. Thing.',
  "I'm happy for him. I think.",
  'Was it impressive? Absolutely not.',
  'Barely.',
  "What's the point? The guy won.",
];

export function fragmentsInstruction(): string {
  return `The sound of it, in lines from your own earlier entries — a tone to aim at, not lines to copy: ${DIARY_FRAGMENTS.map(line => `"${line}"`).join(' / ')}`;
}

/** Long enough that sharing it is copying, short enough to catch a lifted sentence. */
export const LIFTED_SPAN_WORDS = 8;

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Whether an entry shares a run of words with any of the examples.
 *
 * Eight words in a row is not a turn of phrase, it is a sentence, and a
 * sentence from an example is an event from an example. Returns the run, so
 * the log can say what was lifted.
 */
export function liftedFrom(entry: string, examples: string[], span = LIFTED_SPAN_WORDS): string | null {
  const mine = words(entry);
  if (mine.length < span) return null;
  const runs = new Set<string>();
  for (const example of examples) {
    const theirs = words(example);
    for (let index = 0; index + span <= theirs.length; index++) runs.add(theirs.slice(index, index + span).join(' '));
  }
  for (let index = 0; index + span <= mine.length; index++) {
    const run = mine.slice(index, index + span).join(' ');
    if (runs.has(run)) return run;
  }
  return null;
}

/** What she is told when she has copied rather than written. */
export const NOT_THOSE_LINES = 'You just used a sentence from an earlier entry word for word. Those are a tone to aim at, not lines to reuse — and they were about other days. Write tonight in your own words, about tonight.';
