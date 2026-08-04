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

// Tracks the last line used so the same one cannot land twice running, which
// would read as canned rather than as her being genuinely irritated.
let previous = -1;

export function randomRetort() {
  if (DISLIKE_RETORTS.length < 2) return DISLIKE_RETORTS[0] ?? '';
  let index = previous;
  while (index === previous) index = Math.floor(Math.random() * DISLIKE_RETORTS.length);
  previous = index;
  return DISLIKE_RETORTS[index];
}
