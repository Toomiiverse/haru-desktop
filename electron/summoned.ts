// What she says when you click her and the box opens.
//
// Canned on purpose, and that is the whole point. A generated line would take
// two to six seconds on the local model, and a door that takes two seconds to
// open does not feel like being answered — it feels like nothing happened. She
// says something the instant the box appears, and the model is only asked for
// the actual reply.
//
// Which is also why these are not jokes. They are her looking up: short,
// impatient, and the same shape every time, so they read as a greeting rather
// than as her having thought of something.

/** Her mood decides the tone, not the wording. */
export type Welcome = 'warm' | 'ordinary' | 'annoyed';

const LINES: Record<Welcome, string[]> = {
  // She is in a good mood, which for her means only mildly put upon.
  warm: [
    'Yeah? What now?',
    'What is it?',
    'Go on, then.',
    'You have my attention. Briefly.',
    'What do you want?',
    'Mm? Spit it out.',
  ],
  ordinary: [
    'What.',
    'Yeah? What now?',
    'This had better be good.',
    'What is it this time?',
    'Talk.',
    'Well?',
  ],
  // Already cross about something. Still answers — she always answers — but
  // she is not pretending to be pleased about it.
  annoyed: [
    'What NOW?',
    'Oh, what.',
    'This had better be important.',
    'You again. What.',
    'Make it quick.',
  ],
};

/**
 * How irritated she has to be before the greeting turns.
 *
 * Low, because irritation sheds slowly and the poke escalation pushes it up a
 * point at a time — waiting until she is furious would mean the annoyed lines
 * almost never appear, which is the same as not writing them.
 */
export const ANNOYED_AT = 3;
/** Below this she is in an actively good mood rather than merely not cross. */
export const WARM_BELOW = 1;

export function welcomeFor(irritation: number): Welcome {
  if (irritation >= ANNOYED_AT) return 'annoyed';
  return irritation < WARM_BELOW ? 'warm' : 'ordinary';
}

/**
 * A greeting, avoiding the one she just used.
 *
 * Repeats are what make a canned line sound canned. Six lines and a memory of
 * one is enough that clicking her twice in a row does not produce the same
 * sentence twice, which is the moment the illusion goes.
 */
export function summonedLine(irritation: number, avoid?: string): string {
  const lines = LINES[welcomeFor(irritation)];
  const fresh = lines.filter(line => line !== avoid);
  const pool = fresh.length ? fresh : lines;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Told to keep it short, because the bubble is not a chat window.
 *
 * She is being spoken to at her own window, in the corner of a screen someone
 * is working on. The desk transcript can carry a considered answer; a floating
 * caption cannot, and a companion who delivers three paragraphs to a passing
 * question is the thing that makes people close her.
 */
export const BREVITY = 'They have clicked on you and typed this at your window, not at your chat. Answer in one or two short sentences and stop. No preamble, no list, no closing question unless it is the whole answer. If it genuinely needs more than that, say the short version and tell them to open you properly.';
