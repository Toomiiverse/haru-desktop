// Strips paragraphs Haru has already said. She reproduces whole lines from her
// own earlier replies verbatim — the same pattern-continuation that had her
// parroting the demo stub and her own stale denials.
//
// Fixed here rather than with a repetition penalty: Ollama's only looks back 64
// tokens by default, so a paragraph from a message or two ago is never penalised
// at all, and widening the window would start penalising the calendar and memory
// text she has to reproduce accurately. This touches nothing but exact repeats.

/** Compared on content, so punctuation or spacing changes do not hide a repeat. */
function normalise(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Short lines are excluded: "Fine." or "Noted." recurring is a verbal tic rather
// than the glitch this is for, and stripping them would mangle her voice.
const MIN_REPEAT_LENGTH = 40;

export function dropRepeatedParagraphs(reply: string, previousReplies: string[]): string {
  const seen = new Set(
    previousReplies
      .flatMap(message => message.split(/\n{2,}|\n(?=[A-Z“"])/))
      .map(normalise)
      .filter(text => text.length >= MIN_REPEAT_LENGTH),
  );
  if (!seen.size) return reply;

  const paragraphs = reply.split(/\n{2,}/);
  const kept = paragraphs.filter(paragraph => {
    const key = normalise(paragraph);
    return key.length < MIN_REPEAT_LENGTH || !seen.has(key);
  });
  // Never return nothing: if every paragraph was a repeat, the reply is still
  // hers to make and an empty bubble is worse than a repeated one.
  if (!kept.length) return reply;
  return kept.join('\n\n').trim();
}
