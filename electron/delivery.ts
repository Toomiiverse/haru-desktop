// How a sentence should sound, said by the brain that wrote it.
//
// Her voice and her face disagreed on 57% of her replies (101 logged pairs,
// 43% agreement — heard neutral while she looked angry, heard annoyed while she
// looked smug). Two different readings of the same sentence: the page picks a
// clip off the stream with `localEmotion`, a keyword heuristic, because the
// voice cannot wait; `/api/expression` runs the real classifier afterwards for
// the face. Neither is wrong to exist. They simply never agreed.
//
// The model that wrote the sentence already knows how it meant it, and saying
// so costs nothing and arrives with the stream. Measured on the live
// conversation route before any of this was built: 65 of 65 segments came back
// validly labelled, none invalid, no reply that failed to start with one. And
// the labels are better than either reading, because they are per sentence —
// "[annoyed] Oh, perfect. You want me to care about your motherboard now.
// [neutral] C5 is usually memory initialization" is a mood change mid-reply
// that neither a whole-reply classifier nor a keyword pass can see.
//
// The whole risk is a label reaching him. Text she was told to emit and the app
// must remove has leaked before — the day her tool calls came out as words and
// were read aloud (2026-09-06). So the stripping is deliberately paranoid: the
// parse strips, a separate pass strips again on the finished reply, and both
// are tested against every shape the model has actually produced rather than
// the one shape it was asked for.

import { EMOTIONS, type EmotionName } from './emotion';

/** What the brain is asked. Named moods only, so an invented one is detectable. */
export function deliveryRule(): string {
  return `Before each sentence of your reply, put how that sentence should sound in square brackets, chosen from exactly this list: ${EMOTIONS.join(', ')}. Like this: [annoyed] Do not touch that. [curious] What did you even try? Every sentence gets one, they are stripped before he sees them, and nothing else about how you write changes.`;
}

/**
 * Moods she was not given, and the ones they are.
 *
 * Kimi K3, pressed to label every sentence, wrote "[concerned] Stop." — a word
 * off the list, which the stripper left in front of him (2026-09-14). The list
 * stays the list; these are read as the mood they plainly mean, and taken out
 * like any other label. Only words that name a feeling or a tone of voice:
 * "[redacted]" and "[whatever]" are still hers.
 */
export const MOOD_ALIASES: Readonly<Record<string, EmotionName>> = {
  concerned: 'worried', anxious: 'worried', nervous: 'worried', sad: 'worried', upset: 'worried', hurt: 'worried', scared: 'worried',
  angry: 'annoyed', irritated: 'annoyed', frustrated: 'annoyed', exasperated: 'annoyed', impatient: 'annoyed', mad: 'annoyed', grumpy: 'annoyed',
  amused: 'smug', teasing: 'smug', playful: 'smug', sarcastic: 'smug', proud: 'smug', mocking: 'smug', cocky: 'smug',
  excited: 'happy', pleased: 'happy', cheerful: 'happy', delighted: 'happy',
  warm: 'affectionate', fond: 'affectionate', tender: 'affectionate', gentle: 'affectionate', soft: 'affectionate', caring: 'affectionate',
  flustered: 'embarrassed', shy: 'embarrassed', sheepish: 'embarrassed',
  confused: 'curious', puzzled: 'curious', intrigued: 'curious', interested: 'curious',
  serious: 'determined', stern: 'determined', firm: 'determined', resolute: 'determined',
  shocked: 'surprised', startled: 'surprised',
  tired: 'sleepy', drowsy: 'sleepy',
  calm: 'neutral', flat: 'neutral', deadpan: 'neutral',
  dismissive: 'bored', indifferent: 'bored', unimpressed: 'bored', cold: 'bored',
};

const LABEL_WORDS = [...EMOTIONS, ...Object.keys(MOOD_ALIASES)].join('|');
const moodOf = (word: string): EmotionName => {
  const said = word.toLowerCase();
  return (EMOTIONS as readonly string[]).includes(said) ? said as EmotionName : MOOD_ALIASES[said];
};

export type Delivered = { mood: EmotionName | null; text: string };

// A label is a known mood in brackets at the start of a segment. Anything else
// in brackets is hers — "[redacted]", a markdown link — and must survive.
const LABEL = new RegExp(`^\\s*\\[(${LABEL_WORDS})\\]\\s*`, 'i');
// A fresh regex each call rather than a shared /g one, which would carry
// lastIndex between calls — and this runs on every chunk of every stream.
// The space after a label goes with it, or every removal leaves a double space
// in the middle of her sentence. Removing more still only ever shortens the
// text, so the streaming prefix stays monotonic.
const withoutLabels = (text: string) => text.replace(new RegExp(`\\[(?:${LABEL_WORDS})\\][ \\t]?`, 'gi'), '');

/**
 * The reply, split into what to say and how to say it.
 *
 * Text before the first label is kept as an unlabelled segment rather than
 * dropped: a model that opens with a word and then starts labelling has still
 * written that word, and losing it would be worse than having no mood for it.
 */
export function splitDelivery(reply: string): Delivered[] {
  const text = (reply ?? '').trim();
  if (!text) return [];
  const out: Delivered[] = [];
  for (const piece of text.split(new RegExp(`(?=\\[(?:${LABEL_WORDS})\\])`, 'i'))) {
    const chunk = piece.trim();
    if (!chunk) continue;
    const found = LABEL.exec(chunk);
    const said = chunk.replace(LABEL, '').trim();
    if (!said) continue;
    out.push({ mood: found ? moodOf(found[1]) : null, text: said });
  }
  return out;
}

/**
 * The reply as he must see it: every label gone, wherever it ended up.
 *
 * Separate from the split on purpose. The split is how the voice learns the
 * mood; this is the guarantee, and it runs on the finished text regardless of
 * whether the split ran, whether the model put a label mid-sentence, or whether
 * it labelled something the sentence splitter never saw.
 */
export function stripDelivery(reply: string): string {
  if(process.env.HARU_CORE_RICH_DELIVERY==='on')return require('./core-policy-sync').corePolicySync('rich-delivery.strip',[reply??'']);
  return withoutLabels(reply ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

/**
 * The stream, cleaned as it arrives.
 *
 * The page paints chunks as they come, so a label would flash on screen before
 * the finished reply replaced it. This keeps the whole raw text, removes every
 * complete label, and holds back a trailing partial one — a chunk boundary
 * falling inside "[ann" must not put half a label in front of him for the
 * fraction of a second before the rest arrives.
 *
 * Deliberately not the same function as stripDelivery: that one trims and
 * collapses whitespace, which is right for a finished reply and wrong for a
 * prefix being compared against what has already been shown.
 */
export function cleanSoFar(raw: string): string {
  return withoutLabels((raw ?? '').replace(/\[[a-z]*$/i, ''));
}

/** Wraps a chunk sink so only clean text, and only what is new, reaches it. */
export function cleaningChunks(onChunk: (text: string) => void): (chunk: string) => void {
  let raw = '';
  let shown = '';
  return chunk => {
    raw += chunk;
    const clean = cleanSoFar(raw);
    if (clean.length <= shown.length) return;
    onChunk(clean.slice(shown.length));
    shown = clean;
  };
}

/** Whether anything in this text still looks like a delivery label. */
export function hasDeliveryLabel(text: string): boolean {
  return new RegExp(`\\[(?:${LABEL_WORDS})\\]`, 'i').test(text ?? '');
}

/**
 * The rule again, where she reads it last — the tail of the hosted voice note
 * (HOSTED_VOICE in room.ts, joined in main.ts after LAST_WORD).
 *
 * At the end of a twelve-thousand-token system message, with twenty tools
 * declared after it, Kimi K3 labelled none of seven replies; Kimi K2.5 labelled
 * every one from the same prompt (2026-09-14). Said again just before his turn,
 * K3 labels about half, and writes no worse for it. A missing label costs the
 * keyword reading in its place (sentenceStreamer), which is how she sounded
 * before labels existed.
 *
 * What did not go in, and why: showing her earlier replies with labels on got
 * K3 to label every reply, and flattened her — most sentences [neutral], one
 * reply fifty-eight "[annoyed] And I'm tired of…" sentences long until the
 * token cap stopped it. A label on every reply is not worth that.
 */
export function deliveryReminder(): string {
  return `Label every sentence with how it sounds, like this: [annoyed] Knock it off. [curious] What actually broke? Only these: ${EMOTIONS.join(', ')}.`;
}
