import { justTalking, readsAsRough } from './room';
import { reminderAsk } from './remindme';
import { asksToLookUp } from './reply';
import { readMuteAsk } from './mute';

// When the room to go on is not hers to take.
//
// roomToRant (room.ts) tells her that for one reply the rule about matching the
// length of their message does not apply, and to open on her own subject. Its
// only look at what he said was nothingInIt — a bare "ok" or "morning" — so on
// his real messages (1,610 of them, measured 2026-09-21) the note was free to
// land on 96%: on "remind me to…", on a question, on "my mum's in hospital". A
// model that does as it is told then writes an essay about last night's manga
// instead of the thing he asked for (Kimi K3 through Baseten: 14 of 36 replies,
// 12 of them on messages that needed an answer or some care). One that half
// ignores the note, as Kimi K2.5 does, only hides the fault.
//
// The note also disagrees with what she is told on the very same turn:
// roomInstruction says to ease off and not change the subject, and the answering
// note says he is replying to her question. Two orders that cannot both be
// followed, and the later of them was the one about Chainsaw Man.
//
// So the instruction is withheld, not countered. Adding "but answer him first"
// to the note is one more sentence in a prompt that already has too many, and
// the finding of 2026-09-20 is that a sentence like that cannot be relied on;
// leaving the instruction out cannot be disobeyed. Pure, and takes the message
// only, like askingAboutHer — the caller owns everything that is state.
//
// Measured against his 1,548 messages that are more than a greeting: 43% held,
// and reading what it held and let through changed six patterns before it was
// right (see the tests that name a first version). The statements the note
// exists for — "work was pretty quiet today", "still thinking about lain" —
// stay open. The cost is frequency: simulated over his real message times with
// the 90-minute cooldown, about a fifth fewer rants a day (3.0 to 2.4), all of
// them ones that would have landed on a request or a question. The cooldown is
// not spent on a held message, so the next open one still gets its roll.

/**
 * Plainly saying they feel bad, in words readsAsRough does not list. "I feel
 * useless lately" got no ease-off note and, in the 2026-09-21 bench, the
 * reassurance that Kimi K3 reaches for. Kept out of `down` and `low` on purpose:
 * "I'm down for that" is agreement.
 */
export const FEELING_BAD = /\bi(?:'m| am| feel| felt| feeling)\s+(?:so |really |just |kinda |pretty |such )?(?:an? )?(?:useless|worthless|hopeless|pointless|failure|idiot|stupid|terrible|awful|empty|numb|lonely|sad|scared|afraid|sick)\b|\bi feel like (?:a failure|shit|crap|giving up)\b/i;

/**
 * Asking for something, by the shape of it. Anchored on purpose: a first version
 * matched "get it" and "check the" anywhere and held "yeah I did get it" and "I'll
 * try and get the website running tomorrow", which are statements. An imperative
 * counts at the start of the message (after "hey Haru," and the like) — "try again",
 * "be more snappy", "keep it short", "say something" are all orders at her; "can you"
 * and "please" count anywhere.
 */
const ASKS = /(?:^\s*(?:hey\s+|hi\s+|yo\s+)?(?:haru[,!]?\s+)?(?:just\s+|also\s+|and\s+|now\s+)?(?:please\s+)?(?:let'?s|remind|tell|show|give|find|check|open|set|make|send|write|add|tick|mark|cancel|book|move|save|help|stop|start|turn|walk|explain|summari[sz]e|analy[sz]e|translate|quiz|pick|choose|list|be|keep|try|say|look|run|act|call|use|speak|respond|reply|answer|read|watch|listen|wait|ignore|repeat|continue|drop|forget|imagine|pretend|describe|compare|calculate|count|ask)\b|\b(?:can|could|would|will)\s+you\b|\b(?:please|pls)\b|\b(?:i|we)\s+(?:want|need)\s+you\s+to\b)/i;

/**
 * A question with no question mark: "what time is it", "haru why are you so
 * stiff", "did I tell you about the server". Read off the first word, like the
 * imperatives, because anywhere in the message it is just a word ("that's what I
 * meant"). "will do" and "can do" are agreement, not asking.
 */
const QUESTION_START = /^\s*(?:(?:hey|hi|yo|ok|okay|so|and|but|also|wait|well)[,!]?\s+)?(?:haru[,!]?\s+)?(?!(?:will|can) do\b)(?:what|whats|what's|why|how|hows|how's|when|where|who|whose|which|is|are|do|does|did|can|could|would|will|should|shall|have you|has it|isn'?t|aren'?t|don'?t you|didn'?t you)\b/i;

/** Saying sorry is asking to be answered: taken or refused, not talked over. */
const APOLOGY = /\b(?:i'?m|i am|im)\s+(?:so |really |very |truly |just )?sorry\b|\bmy bad\b|\bapologi[sz]e\b|\bforgive me\b|\bsorry (?:about|for|if)\b/i;

/** Only her name, drawn out or not — a call, and she has been asked to come. */
const CALLED = /^\s*(?:hey\s+|yo\s+|oi\s+)?haru+[!?.\s]*$/i;

/**
 * Something has gone wrong with a thing of theirs, and they are telling her so she can help. The
 * thing has to be what stopped working: a first version held "Emma doesn't work at Happytel, I do".
 */
const PROBLEM = /\b(?:deleted|lost|broke|broken|smashed|cracked|crashed|error|failed|locked out)\b|\bwon'?t (?:turn on|start|boot|load|power on|open|connect)\b|\b(?:my|the|our)\s+[\w-]+(?:\s+[\w-]+)?\s+(?:doesn'?t|isn'?t|stopped|is not)\s+(?:work|working)\b|\b(?:it|this|that)\s+(?:doesn'?t|isn'?t|won'?t|stopped)\s+(?:work|working)\b/i;

/**
 * Going: bed, driving, out. A closing line is due, not an essay. "Have to go" only when it ends there or
 * says now/soon/bye: "first I have to go pick up a motherboard" is the day's plan.
 */
const FAREWELL = /\b(?:going to bed|off to bed|heading to bed|gonna sleep|going to sleep|good ?night|nighty night|heading off|about to drive|gonna drive|going to drive)\b|\b(?:gotta|got to|have to|need to)\s+go(?:\s+(?:now|soon|bye)\b|[.!]?\s*$)/i;

/** They said how long the answer should be. */
const BREVITY = /\b(?:two sentences|one sentence|in a sentence|briefly|short answer|tl;?dr|in a word|yes or no)\b|\bquick one\s*[:,\-–—]/i;

/**
 * Something said at her rather than about the day — "you'd miss me", "you've been
 * cold", "you're annoying", "you don't have to ask after every sentence". It wants an
 * answer; a paragraph about her reading is a way of not giving one. Kind things
 * ("you're right", "you're doing so good") and plain "you're listening" are left
 * out, and so is "you'd like it" — "you'd miss me" is the jab.
 */
const CHALLENGE = /\b(?:you'?re|you are)\s+(?!(?:right|welcome|the best|great|amazing|awesome|sweet|cute|funny|good|correct|so (?:sweet|good|nice|kind)|(?:actually |really |just |still |also |now )?(?:doing|going|looking|listening|watching|reading|playing|working|using|running|talking|saying|asking|trying|getting)|being (?:so |really )?(?:good|nice|sweet|kind|cute|funny))\b)|\byou(?:'ve| have) been\b|\byou (?:always|never|don'?t|didn'?t|forgot|should(?:n'?t)?)\b|\byou'?d (?:miss|never|always|rather|hate|cry|die|be (?:lost|nothing|bored))\b/i;

/**
 * Asking what she has been up to, where she is in it, or how she is — the opening
 * the room exists for. Not
 * "what do you think of X": that is an answer about X, and a rant about her own
 * subject in its place is the fault (asked about Cowboy Bebop, she went on about
 * Chainsaw Man).
 */
const ACTIVITY = /\bwhat (?:did you (?:do|get up to)|have you been (?:up to|doing)|were you (?:up to|doing)|are you (?:up to|doing|reading|watching|playing))\b|\bwhat'?s you get up to\b|\bwhat (?:chapter|episode|book|volume|level|part|page|game|show|anime|manga) (?:are|were) you (?:up to|on|at|reading|watching|playing)\b|\bhow was your (?:night|evening|day|morning|weekend)\b|\bhow (?:are|r) (?:you|u)\b|\bhow(?:'ve| have) you been\b/i;

export type HeldOptions = {
  /** Reminder dates resolve against this ("remind me at six"). Defaults to the moment of the call. */
  now?: Date;
  /** Her subject, when he named it himself. Hers to go on about even inside a question. */
  named?: string;
  /** This turn is him answering something she asked (the answering note is on it). */
  answering?: boolean;
};

/**
 * Why the room to go on is held back for this message — "" when it is open.
 *
 * Two tiers. The first holds it whatever else is true, because there is
 * something to do or someone to look after: he is answering her, is having a bad
 * time, wants her quiet, wants a reminder or a look-up, is leaving, has lost
 * something, wants it short, is saying sorry, or has only called her name. The second holds it for a question, a request or a
 * jab — and lets go of all three when the subject is hers to begin with: he named
 * it, asked what she got up to, or said he just wants to talk.
 *
 * A bare greeting is not decided here; nothingInIt already does that.
 */
export function heldBack(latest: string, options: HeldOptions = {}): string {
  const said = (latest ?? '').replace(/[‘’]/g, "'").trim();
  if (!said) return '';
  if (options.answering) return 'they are answering something she asked';
  if (readsAsRough(said).rough || FEELING_BAD.test(said)) return 'they are having a hard time';
  if (readMuteAsk(said)?.kind === 'mute') return 'they asked her to be quiet';
  if (reminderAsk(said, options.now ?? new Date())) return 'they asked for a reminder';
  if (asksToLookUp(said)) return 'they asked her to look something up';
  if (FAREWELL.test(said)) return 'they are leaving';
  if (PROBLEM.test(said)) return 'something has gone wrong for them';
  if (BREVITY.test(said)) return 'they asked for it short';
  if (APOLOGY.test(said)) return 'they are apologising';
  if (CALLED.test(said)) return 'they only called her name';
  if (options.named || ACTIVITY.test(said) || justTalking(said)) return '';
  if (said.includes('?') || ASKS.test(said) || QUESTION_START.test(said)) return 'they asked for something';
  if (CHALLENGE.test(said)) return 'they said something at her that wants an answer';
  return '';
}
