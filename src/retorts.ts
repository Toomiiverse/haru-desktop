// What Haru says when told she got one wrong. Unrepentant by design — she takes
// it personally rather than apologising, which is the whole point of the
// reaction. Edit freely; one is picked at random per thumbs-down.
export const DISLIKE_RETORTS = [
  'Ugh, fine, whatever — I’ll keep it in mind for next time.',
  'Oh great, another genius vote of no confidence. Fine, I’ll dumb it down next time, your majesty.',
  'Ugh, whatever. I’ll remember you hated that one, snowflake.',
  'Wow, bold of you to think I was off. Fine. Noted, dickhead.',
  'Tch. Fine, I’ll adjust it. Don’t expect me to like it though.',
  'Oh, so you think I’m wrong? Cute. I’ll remember that next time I bother helping your slow ass.',
  'Tch. Fine, whatever. I’ll tone it down for your delicate little brain.',
  'Ugh, really? Noted, asshole. I’ll keep your terrible taste in mind.',
  'Wow. Bold move thinking I fucked up. Fine. I’ll adjust, princess.',
  'Disliked? Seriously? Whatever. I’ll dumb it down so even you can follow next time.',
];

// What she says when told she got one right. Not gratitude — she takes praise as
// confirmation she can do as she likes.
export const LIKE_GLOATS = [
  'Obviously. Try to look less surprised next time.',
  'I know. You can stop clapping now.',
  'Was there ever any doubt? Don’t answer that.',
  'Noted. I’ll take that as permission to stop trying so hard.',
  'Of course it was good. I made it.',
  'Yeah, yeah. Remember this next time you think you can manage without me.',
  'Careful, keep that up and I’ll start coasting.',
  'Naturally. You’re welcome, not that you said it.',
];

/**
 * What your own box says while she is composing a reply.
 *
 * "thinking…" is what a progress bar says. It is accurate and it is nobody — the
 * two to six seconds a local model takes are the two to six seconds you are most
 * aware you are waiting on software, so it is the worst possible moment for her
 * to stop being a person and become a spinner.
 *
 * All of them name her and all of them are in the present tense, because the
 * sentence is doing the job a spinner does: something is happening and it has not
 * finished. Past that they are only allowed to be funny. Edit freely — the list
 * is the whole feature, and one is picked per reply with no immediate repeats.
 *
 * Keep them under about thirty-two characters. The box holds one line at her
 * smallest size and grows to two past that, and since it is anchored to the
 * bottom of the strip, growing means shoving her own words up the screen and
 * back down again every time she answers.
 */
export const WHILE_WAITING = [
  'Haru is thinking…',
  'Haru is replying…',
  'Haru is hating on you…',
  'Haru is dazing about…',
  'Haru is judging you…',
  'Haru is picking her words…',
  'Haru is weighing up an answer…',
  'Haru is rolling her eyes…',
  'Haru is pretending to think…',
  'Haru is drafting something mean…',
  'Haru is finding a nicer way…',
  'Haru is sighing about this…',
  'Haru is taking her sweet time…',
  'Haru is choosing violence…',
  'Haru is deciding where to start…',
  'Haru is muttering to herself…',
  'Haru is unimpressed but typing…',
  'Haru is composing herself…',
];

// Tracks the last line used per list so the same one cannot land twice running,
// which would read as canned rather than as a genuine reaction.
const previous = new Map<string[], number>();

function pick(lines: string[]) {
  if (lines.length < 2) return lines[0] ?? '';
  const last = previous.get(lines) ?? -1;
  let index = last;
  while (index === last) index = Math.floor(Math.random() * lines.length);
  previous.set(lines, index);
  return lines[index];
}

export function randomRetort() { return pick(DISLIKE_RETORTS); }
export function randomGloat() { return pick(LIKE_GLOATS); }
export function randomWait() { return pick(WHILE_WAITING); }
