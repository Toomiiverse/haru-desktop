// Strips paragraphs Haru has already said. She reproduces whole lines from her
// own earlier replies verbatim — the same pattern-continuation that had her
// parroting the demo stub and her own stale denials.
//
// Fixed here rather than with a repetition penalty: Ollama's only looks back 64
// tokens by default, so a paragraph from a message or two ago is never penalised
// at all, and widening the window would start penalising the calendar and memory
// text she has to reproduce accurately. This touches nothing but exact repeats.

/**
 * Platforms and media she has no way of knowing about unless she was told.
 *
 * Deliberately named things rather than general words. "video" and "show" turn
 * up in ordinary sentences constantly; "youtube" and "twitch" do not, and when
 * one appears in a reply where nothing on screen or in the message mentioned it,
 * she made it up.
 */
const INVENTABLE = /\b(anime|manga|youtube|netflix|twitch|reddit|discord|tiktok|instagram|spotify|steam|minecraft|fortnite|roblox|gaming forums?|cat videos?|chess)\b/gi;

/**
 * Drops a closing paragraph that guesses at what they are doing.
 *
 * This is the failure the prompt could not fix. Told plainly not to speculate
 * about the screen, dolphin3 invents anyway at the same rate as with no
 * instruction at all — measured, 1 in 4 either way — because a small model given
 * a nosy character and no facts writes the most plausible-sounding closer rather
 * than declining to. So it is removed afterwards instead of forbidden in advance.
 *
 * Only the last paragraph, and only for names that appear nowhere in what she
 * was actually given: if the user said "anime", or it was on screen, or she
 * raised it earlier in the same reply, it stays. She is allowed to talk about
 * anything that was genuinely in front of her.
 */
export function dropInventedScreenTalk(reply: string, told: string): string {
  const paragraphs = reply.split(/\n{2,}/);
  if (paragraphs.length < 2) return reply;
  const last = paragraphs[paragraphs.length - 1];
  const invented = last.match(INVENTABLE);
  if (!invented) return reply;
  // Everything she legitimately had: the screen, their message, and her own
  // earlier paragraphs.
  const known = `${told} ${paragraphs.slice(0, -1).join(' ')}`.toLowerCase();
  const unfounded = invented.filter(name => !known.includes(name.toLowerCase()));
  // Every name in it has to be invented before the paragraph goes. One grounded
  // mention means she is answering something real and merely reached for an
  // extra example alongside it — throwing the whole line away to remove the
  // extra costs more than it saves.
  if (unfounded.length < invented.length) return reply;
  return paragraphs.slice(0, -1).join('\n\n').trim();
}

/**
 * Whole paragraphs that are nothing but a stage direction — "[After a brief
 * glance]", "*leans in*", "(pauses)".
 *
 * She is a character who talks, not one being narrated. A line like that is the
 * model writing prose about her instead of dialogue for her, and it is worse out
 * loud than on screen: the voice has no way to know it is not speech, so it
 * announces "after a brief glance" in her own voice and the illusion goes with
 * it. Only whole paragraphs, so a genuine aside inside a sentence survives.
 */
const STAGE_DIRECTION = /^\s*(\[[^\]]{1,80}\]|\*[^*]{1,80}\*|\([^)]{1,80}\))\s*$/;

export function dropStageDirections(reply: string): string {
  const kept = reply.split(/\n{2,}/).filter(paragraph => !STAGE_DIRECTION.test(paragraph));
  // If that was the whole reply, she said nothing else and it is better to keep
  // it than to hand back an empty bubble.
  return kept.length ? kept.join('\n\n').trim() : reply;
}

/**
 * Saying she did something to the machine when she did not.
 *
 * Asked to turn the PC off she answered "Sure thing, I'm powering down your
 * computer now" and called nothing. Asked to close Discord, "fine, I'll pretend
 * I can do that". Both are worse than a refusal: a refusal is information, and
 * this is a claim the user has no way to check until they notice the machine is
 * still on.
 *
 * The model will not be argued out of this by wording alone — measured at 2/4
 * on a short conversation and worse on a long one — so the claim is detected
 * after the fact, from the text, and the turn is retried with the tool pressed
 * on her. Detection is deliberately narrow: only the first person, only the
 * things she can actually do, and never a question or an offer.
 */
// The verb and its object can sit either way round — "turning your PC off" and
// "turn off your PC" are the same claim — so both orders are matched rather than
// assuming the particle follows the verb.
const I_WILL = /(i'?m|i am|i'?ll|i will|i'?ve|i have)\s+(just\s+|now\s+|then\s+)*/.source;
const CLAIMED_POWER = new RegExp([
  // Verbs that need their particle: "shutting it down", "turn your PC off".
  `\\b${I_WILL}(powering|shutting|turning|putting|shut|turn|put)\\b[^.!?]{0,40}?\\b(down|off|to sleep)\\b`,
  // Verbs that do not: "I will restart the machine", "I'm locking it".
  `\\b${I_WILL}(restarting|rebooting|locking|restart|reboot|lock)\\b[^.!?]{0,30}?\\b(pc|computer|machine|screen|it|everything)\\b`,
  // Bare forms that are claims on their own.
  '\\b(powering down|shutting (it|that|your|the)?\\s*down|turning (it|your pc|your computer|the computer) off)\\b',
].join('|'), 'i');
const CLAIMED_APP = /\b(i'?ve|i have|i)\s+(just\s+)?(opened|launched|started|closed|quit|shut|killed)\s+(\w+|it|that)\b/i;
/** Asking or offering is not claiming. */
const NOT_A_CLAIM = /\b(shall i|do you want|want me to|should i|would you like|can'?t|cannot|unable|do not have|don'?t have)\b|\?\s*$/i;

export type DesktopClaim = 'power' | 'app' | null;

export function claimsDesktopAction(reply: string): DesktopClaim {
  const text = (reply ?? '').trim();
  if (!text || NOT_A_CLAIM.test(text)) return null;
  if (CLAIMED_POWER.test(text)) return 'power';
  if (CLAIMED_APP.test(text)) return 'app';
  return null;
}

/**
 * The chat template leaking into what she said.
 *
 * Found in the wild: a stored message whose text began, literally, with
 * `assistant\n\n"` — the role header the template was supposed to consume,
 * followed by an opening quote that never closed. It is not cosmetic. That
 * message was position zero of the conversation, so every later turn read it
 * back, and a reply that opens mid-quotation is read as continuing something.
 *
 * Only at the very start, and only when a blank line follows: "assistant" is a
 * word she is allowed to use in a sentence.
 */
const ROLE_HEADER = /^\s*(assistant|user|system|model)\s*:?\s*\n+/i;

export function dropRoleHeader(reply: string): string {
  const withoutHeader = reply.replace(ROLE_HEADER, '');
  // An opening quote with no closing one is the other half of the same leak.
  // Left alone when the quote is balanced, since she does quote people.
  const quotes = (withoutHeader.match(/"/g) ?? []).length;
  const stripped = quotes === 1 && /^\s*"/.test(withoutHeader)
    ? withoutHeader.replace(/^\s*"/, '')
    : withoutHeader;
  return stripped.trim();
}

/** Compared on content, so punctuation or spacing changes do not hide a repeat. */
function normalise(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Short lines are excluded: "Fine." or "Noted." recurring is a verbal tic rather
// than the glitch this is for, and stripping them would mangle her voice.
/**
 * A paragraph re-announcing something on their list that she already announced.
 *
 * The near-duplicate test cannot catch this, and measurably does not: "At least
 * your parcel will arrive on time tomorrow" and "Your parcel pickup reminder is
 * set for tomorrow at 9am" share three common words out of twenty and score far
 * under the threshold. They are different sentences. They are also the same
 * announcement twice, in consecutive replies, which is what makes her feel like
 * a reminder service rather than someone you are talking to.
 *
 * So this matches on the subject rather than the wording: if a paragraph names a
 * saved item, and one of her recent replies already named that same item, the
 * paragraph goes — unless the user brought it up themselves, in which case
 * answering is the whole job.
 */
function distinctiveWords(title: string): string[] {
  const common = new Set(['the', 'a', 'an', 'my', 'your', 'and', 'for', 'get', 'to', 'of', 'up', 'off', 'out', 'on', 'in', 'at', 'do', 'go']);
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(word => word.length > 3 && !common.has(word));
}

/** True when a passage is talking about that item, by its distinctive words. */
function mentions(passage: string, words: string[]): boolean {
  if (!words.length) return false;
  const lowered = passage.toLowerCase();
  const hits = words.filter(word => lowered.includes(word)).length;
  // Every distinctive word for a one-word title; a majority for a longer one, so
  // "Pick up CPU" is not matched by any sentence containing "up".
  return hits >= Math.max(1, Math.ceil(words.length / 2));
}

export function dropRepeatedAgendaMentions(reply: string, previousReplies: string[], titles: string[], askedAbout: string): string {
  const subjects = titles.map(distinctiveWords).filter(words => words.length);
  if (!subjects.length) return reply;
  const paragraphs = reply.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  if (paragraphs.length < 2) return reply;
  const kept = paragraphs.filter(paragraph => {
    const stale = subjects.find(words =>
      mentions(paragraph, words)
      && previousReplies.some(earlier => mentions(earlier, words))
      && !mentions(askedAbout, words));
    return !stale;
  });
  // Never everything: a reply that is entirely about a thing she mentioned
  // before is still her answer, and silence is worse than a repeat.
  return kept.length ? kept.join('\n\n') : reply;
}

/**
 * Claims that somebody got in touch with her.
 *
 * She has no phone, no inbox and no way for anyone but the user to reach her, so
 * every one of these is invented — and this is the most damaging thing she
 * invents, because it is about real people and it sounds like news. Left to it
 * she reported that the user's girlfriend had texted her asking about a birthday
 * present, complete with a gift she claimed to have suggested weeks earlier.
 * None of it happened. Believed, it starts an argument with someone real.
 *
 * Matched on a third party doing the contacting: "you told me" is ordinary and
 * true, "Emma texted me" cannot be.
 */
const GOT_IN_TOUCH = /\b(?!you\b|they\b|we\b|i\b)([A-Z][a-z]+|he|she|your \w+)\s+(?:just\s+|also\s+)?(texted|messaged|emailed|called|rang|phoned|dm'?d|pinged|wrote to|got in touch with|reached out to|told|asked|reminded|warned)\s+me\b/i;
const HEARD_FROM = /\bI (?:just )?(?:heard from|got a (?:text|message|call|email) from|spoke to|was talking to|had a word with)\s+(?!you\b)[A-Z]/;
/**
 * The same lie without the "me" on the end.
 *
 * "Sudin's been asking when Emma's birthday party is" got straight through the
 * first pattern, which wanted her named as the recipient. She never is, in this
 * shape — the sentence just asserts that somebody out there is asking, which she
 * has no way of knowing either. Present and present-perfect only: "Emma asked me
 * to remind you" is already covered above, while "you said Emma wanted one" is
 * the user's own words coming back and must survive.
 */
const THIRD_PARTY_TALK = /\b(?!You\b|They\b|We\b|I\b|She\b|He\b|It\b)([A-Z][a-z]+)(?:'s|’s| has| had| have)?\s+(?:been\s+)?(asking|wondering|saying|telling everyone|on about|keeps asking|wants to know|was asking|says|reckons|mentioned)\b/;

/** Their own words coming back is not an invention, so a paragraph that credits
 *  the user as the source keeps its third-party talk. */
const CREDITED = /\byou (said|told me|mentioned|reckoned|were saying)\b/i;

export function dropInventedContact(reply: string): string {
  const paragraphs = reply.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const kept = paragraphs.filter(paragraph =>
    !GOT_IN_TOUCH.test(paragraph)
    && !HEARD_FROM.test(paragraph)
    && !(THIRD_PARTY_TALK.test(paragraph) && !CREDITED.test(paragraph)));
  if (kept.length === paragraphs.length) return reply;
  // If the whole reply was the invention there is nothing honest left to say, so
  // it collapses to nothing and the caller falls back rather than shipping it.
  return kept.join('\n\n');
}

const MIN_REPEAT_LENGTH = 40;

/**
 * How much of two paragraphs has to be the same words before the second is a
 * restatement of the first rather than a new thought.
 *
 * Needed because the worst case is not exact repetition. Left to run, she does
 * not copy a line — she writes the same line again slightly differently, a dozen
 * times: "Took you long enough" becomes "Took you forever", "make fun of your
 * voice" becomes "make fun of your accent". Every one of those is a unique
 * string and an identical sentence, so matching on equality sees nothing wrong.
 */
const NEAR_DUPLICATE = 0.6;

/**
 * A hard ceiling, and deliberately a blunt one.
 *
 * Similarity does not rescue the worst case. Measured against a real runaway —
 * twenty-two paragraphs cycling one three-beat pattern — the overlap between a
 * paragraph and its own restatement sat around 0.3, which is also roughly what
 * two unrelated sentences of hers score simply for sharing "you", "I'm" and
 * "the". There is no threshold in there that separates the two, so the length is
 * treated as the symptom it is, and the reply is broken however it got there.
 *
 * Lowered from five to three once it turned out the everyday case was the
 * problem rather than the runaway. Four paragraphs was the norm, not the
 * exception — an answer, the same answer again, something off the list nobody
 * asked about, and a send-off — so a ceiling set to catch a twenty-two paragraph
 * loop never once fired on the thing that actually spoils a conversation. Three
 * still leaves room for a real answer that needs two beats and a caveat.
 */
const MAX_PARAGRAPHS = 3;

/**
 * The closing question, asked a third time.
 *
 * Her worst repetition is not a copied line, it is one question rephrased until
 * the reply runs out — "what is it about these that gets you going?", then "you
 * need to be honest with me", then "why are these so important to you?". Three
 * sentences sharing almost no words, which is why every similarity measure walks
 * straight past them.
 *
 * What they do share is shape: a short paragraph, ending in a question mark,
 * after a paragraph that already asked one. That is narrow enough to act on and
 * costs nothing when she has genuinely asked two different things, because the
 * second only goes if it is short enough to be a restatement rather than a
 * thought of its own.
 */
const RESTATED_QUESTION_LENGTH = 140;

function dropTrailingRepeatQuestions(paragraphs: string[]): string[] {
  const kept = [...paragraphs];
  while (kept.length > 2) {
    const last = kept[kept.length - 1].trim();
    const asksAgain = last.endsWith('?') && last.length <= RESTATED_QUESTION_LENGTH;
    const alreadyAsked = kept.slice(0, -1).some(paragraph => paragraph.trim().endsWith('?'));
    if (!asksAgain || !alreadyAsked) break;
    kept.pop();
  }
  return kept;
}

function overlap(a: string, b: string) {
  const first = new Set(a.split(' '));
  const second = new Set(b.split(' '));
  if (!first.size || !second.size) return 0;
  let shared = 0;
  for (const word of first) if (second.has(word)) shared++;
  return shared / (first.size + second.size - shared);
}

export function dropRepeatedParagraphs(reply: string, previousReplies: string[]): string {
  const seen = new Set(
    previousReplies
      .flatMap(message => message.split(/\n{2,}|\n(?=[A-Z“"])/))
      .map(normalise)
      .filter(text => text.length >= MIN_REPEAT_LENGTH),
  );

  const paragraphs = reply.split(/\n{2,}/);
  // Kept as it is built, so a reply can be checked against itself. Without this
  // a loop inside one message passes untouched: every paragraph is compared to
  // what she said last time and never to what she said two lines ago.
  const already: string[] = [];
  const kept = paragraphs.filter(paragraph => {
    const key = normalise(paragraph);
    if (key.length < MIN_REPEAT_LENGTH) return true;
    if (seen.has(key)) return false;
    if (already.some(earlier => earlier === key || overlap(earlier, key) >= NEAR_DUPLICATE)) return false;
    already.push(key);
    return true;
  });
  // Never return nothing: if every paragraph was a repeat, the reply is still
  // hers to make and an empty bubble is worse than a repeated one.
  if (!kept.length) return reply;
  // Cut from the end, because a loop degrades as it runs — the opening
  // paragraphs are the ones she actually meant.
  return dropTrailingRepeatQuestions(kept.slice(0, MAX_PARAGRAPHS)).join('\n\n').trim();
}
/**
 * The paragraph after the answer.
 *
 * Corrected about the date of a rental inspection she came back with three: the
 * answer, an unrelated question about a video edit, and a remark about how late
 * it was with another question after it. Only the first was a reply to anything.
 * Her prompt has forbidden exactly this from the start — "do not sweep in a
 * topic they did not raise" — and she does it anyway, which after six other
 * wordings today is not something another sentence is going to fix.
 *
 * The ceiling above is three, and the reasoning for it still holds: a real
 * answer sometimes needs two beats and a caveat. What it cannot tell is whether
 * the third paragraph is the caveat or the padding. That distinction is not in
 * the prose, but it is in the shape and in what she did to produce the reply —
 * an answer with parts is written in parts, and an answer she went and looked up
 * is long because the world is, not because she was filling.
 *
 * So three still stands for a list or for something she searched for; anything
 * else stops at two. Asked to look up how to set up Square subscriptions she
 * replied with a lead-in and two numbered steps, and that reply was exactly what
 * was wanted — it must survive this untouched, and it does, on both counts.
 */
const ENUMERATED = /^\s*(?:[-*•]|\d+[.)])\s/;
const TACKED_ON_CEILING = 2;

export function dropTackedOnParagraphs(reply: string, lookedSomethingUp: boolean): string {
  // She went and found this out. Its length is the answer's, not hers.
  if (lookedSomethingUp) return reply;
  const paragraphs = reply.split(/\n{2,}/);
  if (paragraphs.length <= TACKED_ON_CEILING) return reply;
  // A list is a shape, not padding: the parts are the answer.
  if (paragraphs.some(paragraph => ENUMERATED.test(paragraph))) return reply;
  return paragraphs.slice(0, TACKED_ON_CEILING).join('\n\n').trim();
}
