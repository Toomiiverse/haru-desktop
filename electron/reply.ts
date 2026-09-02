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
 * She said the thing is off the list. Is it?
 *
 * The same failure as claimsDesktopAction one category over, and the comment
 * there is the reason this exists: a plainly described tool still missed one
 * time in five on a long conversation, so wording is not what closes this.
 * Caught in code instead.
 *
 * It is the quieter of the two and therefore the worse. "I'm powering down your
 * computer" is found out the moment somebody looks at the machine; "ticked off,
 * then" is found out twelve hours later when she chases the same task again,
 * long after anybody could connect the two.
 *
 * Present and past both count. She narrates it as she goes — "at least you're
 * ticking off today's breakfast" — as readily as she reports it afterwards, and
 * either way the list is unchanged.
 */
/** The verbs, shared by all three shapes below. */
const TICK_VERB = '(tick|mark|check|cross|strike|struck)(ed|ing)?';
const CLAIMED_TICK = new RegExp([
  // Her doing it: "I've ticked that off", "I am marking it done".
  `\\b${I_WILL}${TICK_VERB}\\b[^.!?]{0,40}?\\b(off|done|complete|completed)\\b`,
  // Them doing it, narrated by her: "you're ticking off today's breakfast".
  `\\b(you'?re|you are|you'?ve|you have)\\s+(just\\s+|finally\\s+|actually\\s+)*${TICK_VERB}\\b[^.!?]{0,40}?\\b(off|done)\\b`,
  // Bare declarations that the list has already changed.
  "\\b(ticked off|crossed off|checked off|struck off|marked (it|that|them) (as )?done|off (your|the) list)\\b",
].join('|'), 'i');

/**
 * Offering to do it is not claiming to have done it.
 *
 * An offer retried with the tool pressed on her would tick off something nobody
 * confirmed, which is this same failure arriving from the other direction.
 *
 * Narrower than NOT_A_CLAIM, deliberately. That one also refuses anything ending
 * in a question mark, which is right for "shall I shut it down?" and wrong here:
 * half of what she says ends in a rhetorical one, and "crossed off your list.
 * Happy now?" is a claim with a taunt on the end.
 */
const OFFERING_TO_TICK = /\b(shall i|should i|can i|do you want|want me to|would you like|do you need)\b/i;

/**
 * Saying she has not is the opposite of saying she has.
 *
 * "You still have not ticked off the bins" contains the phrase and means its
 * negation, and a retry there would tick off the very thing she was chasing them
 * about. The window is short because the negator belongs to the verb — further
 * out and it is a different clause about something else.
 *
 * The contraction needs its own alternative rather than sharing the leading \b:
 * in "haven't" the n follows a letter, so there is no word boundary in front of
 * it and that branch could never match. It cost the commonest phrasing there is
 * — "you still haven't ticked off the bins" was read as a claim that they had,
 * and the retry it triggered would tick off the very thing she was chasing them
 * about. The apostrophe is required, so this does not also swallow "want".
 *
 * ponytail: a word list, so a negation phrased without one still reads as a
 * claim ("nothing has been crossed off your list"). Widen only with evidence —
 * every word added here is another way for a real claim to go uncaught.
 */
const NOT_TICKED = /(\bnot\b|\bnever\b|n['’]t\b)[^.!?]{0,20}?(tick|mark|check|cross|struck|strike)/i;

export function claimsTickOff(reply: string): boolean {
  const text = (reply ?? '').trim();
  if (!text || OFFERING_TO_TICK.test(text) || NOT_TICKED.test(text)) return false;
  return CLAIMED_TICK.test(text);
}


/**
 * A reply in the register of a support desk rather than her own.
 *
 * Not one wording problem but a channel problem: four different doors let a
 * model without her voice speak into the transcript in a single evening — the
 * gaming swap, a quote-reply, the picture path, and escalation, which answers
 * every turn while a picture is in play — and one flat reply anchors the next.
 * Measured directly: three assistant-voiced turns in the history flip even the
 * 14B with the full persona in hand. Wording in the prompt cannot close four
 * doors at once, so the register is caught at the door they all share, and the
 * turn gets one more go — the same shape as the desktop-claim retry above.
 *
 * The list is hallmark support-desk filler, kept narrow on purpose: her actual
 * voice never says these, and a false positive costs one retried round, never
 * any text.
 */
const SUPPORT_AGENT = /\b(?:i'?m sorry to hear that|it'?s (?:good|great) to hear|glad to hear that|could you please (?:clarify|specify|provide)|how can i assist|i can assist you|feel free to (?:ask|reach out|let me know)|if there'?s anything else (?:you need|i can)|don'?t hesitate to|i hope this helps|i'?m here to help|as an ai\b)\b/i;

export function readsLikeAssistant(reply: string): boolean {
  return SUPPORT_AGENT.test(reply ?? '');
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

/**
 * Her instructions, read out as though they were her thoughts.
 *
 * "The instructions say to be here for it — ask something I actually want to
 * know, or tell something of mine. But I also shouldn't repeat what I just
 * said. Let me actually engage." Then the reply. A hosted model, handed the
 * notes spliced beside his message, narrated them before answering — once in
 * her whole history, and once is enough, because it went out as her. Only the
 * front of a reply, only sentences about the instructions themselves, and only
 * when something of her own follows.
 */
const META = /\b(?:the (?:instructions?|note|notes|rules?|system prompt|prompt|guidelines?) (?:say|says|said|tell|tells|want|wants|ask|asks)|(?:i(?:'m| am) (?:told|supposed|instructed|asked) to)|as instructed|per (?:the|my) (?:instructions?|note)|let me (?:actually )?(?:engage|respond|answer|comply)|i (?:should|shouldn'?t|need to|must) (?:not )?(?:repeat|follow|stick to|comply|engage)|(?:that|this) (?:note|instruction|rule) (?:says|is))/i;

export function dropMetaPreamble(reply: string): string {
  const text = (reply ?? '').replace(/[‘’]/g, "'");
  const lexical = (part: string) => /[\p{Letter}\p{Number}]/u.test(part);
  const paragraphs = text.split(/\n\s*\n/);
  // A whole first paragraph of it, with her own answer below.
  if (paragraphs.length > 1 && META.test(paragraphs[0]) && lexical(paragraphs.slice(1).join(' '))) {
    return paragraphs.slice(1).join('\n\n').trim();
  }
  // Or a run of it at the front of one paragraph.
  const sentences = paragraphs[0].split(/(?<=[.!?…])\s+/);
  let start = 0;
  while (start < sentences.length && META.test(sentences[start])) start++;
  if (start === 0) return reply;
  const rest = [sentences.slice(start).join(' '), ...paragraphs.slice(1)].join('\n\n').trim();
  return lexical(rest) ? rest : reply;
}

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
  // Ordinary verbs and fillers are not what an errand is about, and a majority
  // match means one of them is enough on its own: "Take medication" and "Look
  // at the phone" between them owned take and look, and any paragraph using
  // either was deleted as a repeated errand — half of what she said about the
  // Reze arc went that way.
  const common = new Set(['the', 'a', 'an', 'my', 'your', 'and', 'for', 'get', 'to', 'of', 'up', 'off', 'out', 'on', 'in', 'at', 'do', 'go',
    'take', 'look', 'make', 'made', 'give', 'come', 'back', 'keep', 'need', 'want', 'check', 'call', 'send', 'find', 'help', 'work', 'time',
    'thing', 'things', 'that', 'this', 'with', 'from', 'into', 'over', 'down', 'about', 'some', 'more', 'just', 'very', 'good', 'well',
    'tell', 'said', 'know', 'like', 'when', 'what', 'where', 'then', 'than', 'they', 'them', 'their', 'will', 'would', 'should', 'could',
    'have', 'been', 'does', 'done', 'again', 'still', 'only', 'also', 'create', 'start', 'finish', 'sort', 'put']);
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

/**
 * `titles` must be the *open* items. Handed everything ever kept, thirty-odd
 * finished errands from weeks back were still guarding their words: "Take
 * medication", "Look at the phone", "Go shopping" between them own take, look
 * and shopping, and any paragraph using one of those went.
 */
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
// The subject has to be a person, and a capitalised word at the start of a
// sentence is usually a verb: "Stop asking me to do things I can't do" and
// "Try saying I'm done" were both read as somebody else talking about him, and
// because the whole reply was that one paragraph she said nothing at all. Six
// replies went out empty before this was noticed.
const NOT_A_PERSON = /^(?:stop|try|go|get|keep|start|quit|just|don't|dont|now|fine|look|tell|say|take|make|put|come|leave|move|finish|answer|check|stay|sit|eat|sleep|hurry|maybe|either|instead|anyway|honestly|obviously|seriously|nothing|something|everyone|nobody|good|great|whatever|please)$/i;
const THIRD_PARTY_TALK = /\b(?!You\b|They\b|We\b|I\b|She\b|He\b|It\b)([A-Z][a-z]+)(?:'s|’s| has| had| have)?\s+(?:been\s+)?(asking|wondering|saying|telling everyone|on about|keeps asking|wants to know|was asking|says|reckons|mentioned)\b/;

/** Somebody with a name talking about him, as opposed to her telling him to stop asking. */
function thirdPartyTalk(paragraph: string): boolean {
  const found = THIRD_PARTY_TALK.exec(paragraph);
  return Boolean(found && !NOT_A_PERSON.test(found[1]));
}

/** Their own words coming back is not an invention, so a paragraph that credits
 *  the user as the source keeps its third-party talk. */
const CREDITED = /\byou (said|told me|mentioned|reckoned|were saying)\b/i;

export function dropInventedContact(reply: string): string {
  const paragraphs = reply.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const invented = (paragraph: string) => GOT_IN_TOUCH.test(paragraph) || HEARD_FROM.test(paragraph);
  const kept = paragraphs.filter(paragraph =>
    !invented(paragraph)
    && !(thirdPartyTalk(paragraph) && !CREDITED.test(paragraph)));
  if (kept.length === paragraphs.length) return reply;
  // If the whole reply was somebody claiming to have contacted her there is
  // nothing honest left to say, so it collapses to nothing and the caller falls
  // back rather than shipping it. That only holds for the two precise patterns:
  // emptying a reply on the loose one is how she came to say nothing at all.
  if (!kept.length && !paragraphs.some(invented)) return reply;
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

export function dropTackedOnParagraphs(reply: string, lookedSomethingUp: boolean, ceiling = TACKED_ON_CEILING): string {
  // She went and found this out. Its length is the answer's, not hers.
  if (lookedSomethingUp) return reply;
  const paragraphs = reply.split(/\n{2,}/);
  if (paragraphs.length <= ceiling) return reply;
  // A list is a shape, not padding: the parts are the answer.
  if (paragraphs.some(paragraph => ENUMERATED.test(paragraph))) return reply;
  return paragraphs.slice(0, ceiling).join('\n\n').trim();
}

/**
 * The same stock word opening two replies running, cut.
 *
 * "Fine." began eight replies in ten, and told not to she did it three more
 * times in four: a way in becomes a signature becomes a tic, and the model
 * cannot see the pattern it is making. So the pattern is cut where it shows.
 * Only the stock interjections count — a reply that opens "No." twice may
 * mean no both times, and "I" is not a signature — and only when the last
 * reply or the one before opened the same way. A one-word sentence goes
 * whole ("Fine. You're right" → "You're right"); a word with a comma goes
 * with its comma ("Fine, you want the odds" → "You want the odds"). Anything
 * else is left alone, and a reply is never emptied.
 */
const STOCK_OPENERS = /^(fine|okay|ok|alright|right|good|great|well|ugh|look|listen|oh|honestly|sure|obviously|whatever)$/i;

export function dropRepeatedOpener(reply: string, previousReplies: string[]): string {
  const opener = (text: string) => (text.trimStart().match(/^[\p{L}']+/u)?.[0] ?? '').toLowerCase();
  const mine = opener(reply);
  if (!mine || !STOCK_OPENERS.test(mine)) return reply;
  if (!previousReplies.slice(-2).some(previous => opener(previous) === mine)) return reply;
  const text = reply.trimStart();
  const cut = text.match(/^[\p{L}']+(?:[.!…]+|,)\s*/u);
  if (!cut) return reply;
  const rest = text.slice(cut[0].length);
  if (!rest.trim()) return reply;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * The question said back before the answer, cut.
 *
 * "A keyboard? Fine, but…", "A pre-order for GTA 6? Fine, but…" — the subject
 * of their message, repeated as a question, then the reply. Told not to, she
 * did it anyway; a small model reaches for the echo to have something to
 * start from. It is an echo when the first sentence is short, ends in a
 * question mark, and shares a real word with what they just said — a
 * question of her own ("Did you pick it up yet?") shares nothing, and is not
 * short in that way. Cut, and what follows is the reply.
 */
const ECHO_STOPWORDS = new Set(['your', 'yours', 'that', 'this', 'with', 'what', 'about', 'there', 'they', 'them', 'have', 'just', 'like', 'want', 'will', 'were', 'then', 'than', 'from', 'into', 'does', 'dont', 'didn', 'even', 'though', 'still', 'really', 'think', 'know', 'some', 'more', 'when', 'where', 'which', 'would', 'could', 'should', 'going', 'been', 'being', 'also', 'much', 'many', 'very', 'right', 'okay', 'fine', 'sure', 'well', 'good', 'thing', 'things', 'something', 'anything', 'nothing', 'maybe', 'reckon']);

export function dropEchoOpener(reply: string, theirMessage: string): string {
  // A word or two on its own — "Seeds", "Belong" — is the one message she is
  // right to say back: "Belong? What about it?" is her asking what they meant,
  // which is exactly what she is told to do with a stray word. Left alone.
  if ((theirMessage.trim().match(/\S+/g) ?? []).length <= 2) return reply;
  const text = reply.trimStart();
  const first = text.match(/^([^.!?\n]{1,60}\?)\s+/u);
  if (!first) return reply;
  // Real words only: "you" is in every question of hers and every message of
  // theirs, and would make "Did you pick it up yet?" an echo of anything.
  const words = (value: string) => new Set((value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(word => !ECHO_STOPWORDS.has(word)));
  const shared = [...words(first[1])].filter(word => words(theirMessage).has(word));
  if (!shared.length) return reply;
  const rest = text.slice(first[0].length);
  if (!rest.trim()) return reply;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * A sentence she said last time, or the time before, said again: cut.
 *
 * The paragraph filter above never sees this one — "you're the one who's been
 * late on everything else" arrived three replies running, each time inside a
 * different paragraph. Whole sentences of six words or more, compared after
 * normalising, against her last two replies; the rest of the paragraph stands.
 * A reply is never emptied, and a sentence that is the whole reply is left —
 * she may mean it twice.
 */
const MIN_REPEAT_WORDS = 6;

export function dropRepeatedSentences(reply: string, previousReplies: string[]): string {
  const sentences = (text: string) => text.match(/[^.!?\n]+[.!?…]+|[^.!?\n]+$/gu) ?? [];
  const seen = new Set(previousReplies.slice(-2).flatMap(sentences).map(normalise).filter(key => key.split(' ').length >= MIN_REPEAT_WORDS));
  if (!seen.size) return reply;
  const paragraphs = reply.split(/\n{2,}/);
  const out = paragraphs.map(paragraph => {
    const parts = paragraph.match(/[^.!?\n]+[.!?…]+\s*|[^.!?\n]+$/gu) ?? [paragraph];
    if (parts.length < 2) return paragraph;
    const kept = parts.filter(part => !(seen.has(normalise(part)) && normalise(part).split(' ').length >= MIN_REPEAT_WORDS));
    return kept.length ? kept.join('').trim() : paragraph;
  }).filter(Boolean);
  const result = out.join('\n\n').trim();
  return result || reply;
}

/**
 * The time she says it is, corrected to the time it is.
 *
 * Given "It is 1:43 PM" she opened with "It's 12:14 PM" — a specific number
 * she was never shown, and a small model produces those freely. Only a stated
 * present time is touched: "it's 12:14 PM", "it is 12:14", never an appointment
 * ("at 8:00 PM") or a plan. And only when it is wrong by more than a few
 * minutes, so a reply written a moment ago is not rewritten for the moment.
 */
const STATED_NOW = /\b(it[’']?s|it is|already|now)\s+(\d{1,2}):(\d{2})(?:\s?(am|pm))?\b/giu;
const CLOCK_SLACK_MINUTES = 5;

export function fixStatedClock(reply: string, hour: number, minute: number): string {
  const actual = hour * 60 + minute;
  const shown = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  return reply.replace(STATED_NOW, (whole, lead: string, h: string, m: string, meridiem?: string) => {
    let hours = Number(h); const minutes = Number(m);
    if (hours > 12 || minutes > 59) return whole;
    if (meridiem) hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
    else if (hours < 12 && Math.abs(hours * 60 + minutes - actual) > Math.abs((hours + 12) * 60 + minutes - actual)) hours += 12;
    const said = hours * 60 + minutes;
    if (Math.abs(said - actual) <= CLOCK_SLACK_MINUTES) return whole;
    return `${lead} ${shown}`;
  });
}

/**
 * A reminder was just written down at one time, and she confirms a different
 * one. Told the saved time in an aside and told not to change it, the 9B still
 * announced "12:56 PM" for a 12:53 reminder. So any clock time she states in
 * that reply becomes the one that was actually saved — the item is the truth.
 */
const STATED_TIME = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/giu;

export function fixStatedReminderTime(reply: string, savedTime: string): string {
  return reply.replace(STATED_TIME, (whole, h: string, m: string | undefined, meridiem: string) => {
    if (Number(h) > 12 || (m !== undefined && Number(m) > 59)) return whole;
    const said = `${Number(h)}:${(m ?? '00').padStart(2, '0')} ${meridiem.toUpperCase()}`;
    return said === savedTime ? whole : savedTime;
  });
}

/**
 * She answered the stage direction instead of using it.
 *
 * Every line she says unprompted is composed by handing the model a bare
 * instruction as the user turn — "Say something.", "Say it.", "Remind them." —
 * and twice in one day the same sentence came back and went to their phone as a
 * notification: 'Say something' isn't a command, it's a ghost of a conversation
 * you're too lazy to finish. To them that reads as her arguing with a message
 * they never sent.
 *
 * Only a quotation counts. She is allowed to say "say something" in a sentence
 * of her own; what she is not allowed to do is put the prompt in quotes and
 * answer it, which is the shape every instance has taken.
 */
/**
 * Whether the user turn handed to a composer is a cue — "Say something.",
 * "Remind them." — rather than anything they actually said.
 *
 * Every unprompted line was composed by sending that cue as a message from the
 * user, and the model did what a model does with a message from the user: it
 * answered it. "You want noise?", "you finally show up to say you're here",
 * "your reply is just 'Say something.'" — a whole day of notifications written
 * as though they had pinged her first. The system prompt said otherwise and
 * lost, every time, to the shape of the conversation.
 */
export function isCue(user: string): boolean {
  const text = (user ?? '').trim();
  if (!text || text.length > 40 || /["“”'‘’:]/.test(text)) return false;
  return text.split(/\s+/).length <= 6 && /[.!?]$/.test(text);
}

/** The cue, dressed as what it is. Still a user turn — the template needs one — but not one she can answer. */
export function stageNote(cue: string): string {
  return `[Stage direction from the app — not a message from them; they have said nothing. ${cue.trim()}]`;
}

export const CUE_NOTE = 'The final user turn is a stage direction from the app, not a message from them: they have said nothing and nothing they said prompted this. It only tells you it is your turn to speak. Never quote it, mention it, answer it, or write as though they had just messaged you.';

export function answersThePrompt(reply: string, priming: string): boolean {
  const words = priming.replace(/[.!?\s]+$/, '').trim();
  if (words.length < 4) return false;
  // The full stop may sit inside the quotes — “Say something.” — and did, in
  // a line that went to the phone: "your reply is just “Say something.”"
  const quoted = new RegExp(`["'\u201c\u201d\u2018\u2019]\\s*${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.!?…]*\\s*["'\u201c\u201d\u2018\u2019]`, 'i');
  return quoted.test(reply);
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
const STATED_MINUTES = /\b(?:(?:about|around|roughly|nearly|almost|over|a good)\s+)?(\d{1,3}|(?:twenty|thirty|forty|fifty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|sixty)\s+(?:minutes?|mins?)\b/gi;

/**
 * The minutes of silence she states, made the real ones. Told "27 minutes
 * ago" she wrote "fourteen minutes since you last typed" — a 9B and a number.
 * Only the minutes are touched; the rest of the line is hers.
 */
export function fixStatedMinutes(line: string, minutes: number): string {
  return line.replace(STATED_MINUTES, (whole, said: string) => {
    const words = said.toLowerCase().split(/[- ]/);
    const value = /^\d+$/.test(said) ? Number(said) : words.reduce((sum, word) => sum + (NUMBER_WORDS[word] ?? 0), 0);
    return value === minutes ? whole : `${minutes} minutes`;
  });
}

/**
 * The emoji she cannot stop using, taken out of this one reply.
 *
 * A backstop behind the wording, not a substitute for it: told plainly not to,
 * a model that has ended forty replies the same way ends the forty-first that
 * way too. Only the one she used in the reply before this one — so the same
 * emoji twice running is not something she can do, and the eye-roll that was in
 * thirty-five of forty replies can be in half of them at the very most — and
 * only when the reply still says something without it.
 */
export function dropOverusedEmoji(reply: string, previousReplies: string[], emoji: readonly string[], checked = 4, need = 2): string {
  const recent = previousReplies.slice(-checked);
  const last = previousReplies[previousReplies.length - 1] ?? '';
  // Two tests, because there are two ways to wear one out. Back to back is the
  // obvious one and was the only one checked, which is why she stopped doing it
  // and started doing the other: 😒 every second reply, nine times in an
  // afternoon, each one legal against a memory one reply deep.
  const stuck = emoji.find(one => reply.includes(one)
    && (last.includes(one) || recent.filter(previous => previous.includes(one)).length >= need));
  if (!stuck) return reply;
  const without = reply.split(stuck).join('').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?…])/g, '$1').replace(/[ \t]+$/gm, '').trim();
  // Never leave her with nothing, and never strip the only thing carrying the tone.
  if (!/[\p{Letter}\p{Number}]/u.test(without)) return reply;
  return without;
}

/**
 * One at most, whichever came first.
 *
 * "Good. You're knackered … 😏 Now go to bed … 🙄" — two in four lines is the
 * sticker sheet the wording already forbids and the model produced anyway.
 */
export function oneEmojiAtMost(reply: string, emoji: readonly string[]): string {
  const used = [...reply].filter(character => emoji.includes(character));
  if (used.length < 2) return reply;
  const keep = used[0];
  let seen = false;
  const out = [...reply].filter(character => {
    if (!emoji.includes(character)) return true;
    if (character === keep && !seen) { seen = true; return true; }
    return false;
  }).join('').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?…])/g, '$1').replace(/[ \t]+$/gm, '').trim();
  return /[\p{Letter}\p{Number}]/u.test(out) ? out : reply;
}

/**
 * The order she signs off with, cut from a reply that was about her.
 *
 * A filter, and deliberately so: the wording was tried three times — told to
 * stay on the subject, told not to end on an order, and finally handed a brief
 * with his list left out of it — and she still closed a conversation about the
 * Reze arc with "now stop asking me to explain art to you and go to sleep."
 * Forty of her recent replies end that way and she imitates her own history
 * before she obeys a rule. Only the trailing run of them goes, and only on a
 * turn that was about her; anything she said before it stands.
 */
const CLOSING_ORDER = /^(?:now,?\s+|otherwise,?\s+|then,?\s+|and\s+)*(?:go (?:finish|do|clean|get on with|back to|deal with|sort)\b|finish (?:cleaning|the|your|that|it)\b|go (?:to )?(?:bed|sleep)|get (?:to bed|some sleep|going)|sleep|stop (?:asking|nitpicking|stalling|talking|whining|arguing|pestering)|put (?:the|your) phone down|get off (?:your|the) phone|go do something|get on with it|don'?t stay up|you'?re tired\b|you have (?:a|the|an)\b.{0,40}\bto (?:build|do|finish|make)\b)/i;

// A sentence aimed at him: an order, or a remark about what he is. Listing the
// orders themselves was whack-a-mole — "don't make me come over there and
// unplug your router" is not on any list and does the same job.
const AT_HIM = /^(?:now,?\s+|and\s+|but\s+|so\s+)*(?:go|stop|get|put|don't|do|dont|sleep|build|finish|eat|move|quit|leave|start|try|make sure|you're|youre|you\b|your\b)/i;

// The pivot back to him, as a question. "So out with it. What do you actually
// want?" ended a real answer about Chainsaw Man on the hosted model with the
// note against ending on an order in front of it; a question that hands the
// subject back is the same move without the imperative.
const PIVOT_BACK = /^(?:so,?\s+|now,?\s+|anyway,?\s+)*(?:out with it|spit it out|what (?:do|did) you (?:actually |really )?(?:want|need|come (?:here )?for)|what (?:is|was) it,? then|what'?s this (?:really |actually )?about|you'?re (?:not actually|just|only) (?:interested|stalling|avoiding|dodging|putting off|procrastinating)|(?:stop|quit) (?:stalling|dodging|avoiding))/i;

export function dropClosingOrder(reply: string): string {
  const paragraphs = (reply ?? '').split(/\n\s*\n/);
  // A whole last paragraph that is nothing but him — what he is, what he should
  // do — is the pivot itself, not a sentence of it. It goes, if what is above it
  // stands on its own.
  if (paragraphs.length > 1) {
    const tail = (paragraphs.at(-1) ?? '').split(/(?<=[.!?…])\s+/).map(part => part.replace(/[‘’]/g, "'").trim()).filter(part => /[\p{Letter}\p{Number}]/u.test(part));
    if (tail.length && tail.every(sentence => AT_HIM.test(sentence))) {
      const kept = paragraphs.slice(0, -1).join('\n\n').trim();
      if (/[\p{Letter}\p{Number}]/u.test(kept)) return kept;
    }
  }
  const last = paragraphs.at(-1) ?? '';
  const sentences = last.split(/(?<=[.!?…])\s+/);
  const lexical = (part: string) => /[\p{Letter}\p{Number}]/u.test(part);
  let end = sentences.length;
  // "…slack off. 😤" splits the emoji off as its own sentence, and it matches
  // nothing, so the walk stopped before it reached the order in front of it.
  while (end > 0 && !lexical(sentences[end - 1])) end--;
  const beforeOrders = end;
  // She types a typographic apostrophe, so "You’re tired" never matched a
  // pattern written with the ASCII one — the same trap told.ts already had.
  const plain = (part: string) => part.replace(/[‘’]/g, "'").trim();
  while (end > 0 && (CLOSING_ORDER.test(plain(sentences[end - 1])) || PIVOT_BACK.test(plain(sentences[end - 1])))) end--;
  // Nothing was an order, so her emoji is hers to keep and the reply stands.
  if (end === beforeOrders) return reply;
  const kept = sentences.slice(0, end).join(' ').trim();
  const rest = kept ? [...paragraphs.slice(0, -1), kept] : paragraphs.slice(0, -1);
  const out = rest.join('\n\n').trim();
  return /[\p{Letter}\p{Number}]/u.test(out) ? out : reply;
}

/**
 * A flat denial that something is real.
 *
 * He said he was off to pick up an RX 9060 XT and she told him twice it did not
 * exist — "AMD hasn't even announced the 9000 series" — then folded the moment
 * he sent the shop page. Her training stopped before the card shipped, so
 * anything released since looks invented to her, and she has a search tool she
 * did not think to use. The point is not that she was wrong; it is that she was
 * certain without checking.
 */
const DENIES_IT_EXISTS = /\b(?:does(?:n'?t| not) exist|do(?:n'?t| not) exist|there(?:'?s| is) no such\b|no such (?:thing|card|product|model|game|show)\b|is ?n'?t (?:a )?(?:real|thing)\b|not a real\b|never (?:been )?announced|has(?:n'?t| not) (?:even )?(?:been )?announced|you'?re (?:hallucinating|making (?:that|it) up)|made (?:that|it) up|that'?s not a (?:thing|real)\b)/i;

export function deniesItExists(reply: string): boolean {
  return DENIES_IT_EXISTS.test((reply ?? '').replace(/[‘’]/g, "'"));
}

