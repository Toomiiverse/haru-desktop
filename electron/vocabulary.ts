import {corePolicySync} from './core-policy-sync';
// The words the ear should expect.
//
// Whisper gets the sentence right and the names in it wrong. "Where are you up
// to in Chainsaw Man" came back as "Chainsaw Mac", "iGaming" as "a gaming",
// "for a customer" as "for a custom": a name it has never seen is spelled as the
// nearest English, and it has never seen this shop, this show or this card.
// Hotwords are the decoder told in advance which spellings are in play — a list
// it leans toward, not a sentence it continues — and they are built here from
// what she already knows rather than typed in: who is talking, the places she
// has been told about, what is on the list, and the names that have come up in
// the conversation she can see. Anything she has been taught she mishears
// (hearing.ts) goes in as well, so a correction is a bias before the mistake and
// a rewrite after it.
//
// This is the priming listen.ts refused, and the reason it refused still holds:
// given near-silence, Whisper writes its prompt back out as though somebody
// said it. Two things make it safe now. The server will not decode a take with
// less than a word of speech in it after the VAD, and listen.ts treats a
// transcript that is nothing but a run of these words as nothing said.

/**
 * Capitalised because they open a sentence or because she writes them that way,
 * and nobody's name. Kept short: the better test is below — a real name is
 * never seen lowercase, and most of what this list holds is.
 */
const NOT_A_TERM = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'if', 'then', 'than', 'because', 'before', 'after', 'about', 'again',
  'when', 'where', 'what', 'who', 'why', 'how', 'which', 'that', 'this', 'these', 'those', 'there', 'here',
  'it', 'its', 'i', 'im', 'ive', 'ill', 'id', 'you', 'your', 'youre', 'he', 'she', 'they', 'we', 'me', 'my', 'us', 'our', 'him', 'her', 'his', 'them', 'their',
  'yes', 'no', 'not', 'ok', 'okay', 'oh', 'ah', 'hm', 'hmm', 'tch', 'pfft', 'hmph', 'hah', 'ha', 'heh', 'meh', 'eh', 'huh', 'um', 'uh', 'er', 'ugh',
  'fine', 'good', 'great', 'well', 'just', 'still', 'now', 'also', 'only', 'even', 'yeah', 'yep', 'nope', 'sure', 'right', 'wrong', 'whatever',
  'stop', 'go', 'get', 'got', 'come', 'check', 'look', 'take', 'make', 'do', 'dont', 'don', 'does', 'did', 'wont', 'cant', 'cannot', 'can', 'will', 'would', 'should', 'could',
  'wait', 'hang', 'hold', 'listen', 'hey', 'hi', 'hello', 'bye', 'thanks', 'thank', 'please', 'sorry',
  'nothing', 'everything', 'something', 'anything', 'someone', 'nobody', 'everyone', 'anyone',
  'morning', 'afternoon', 'evening', 'night', 'tonight', 'today', 'tomorrow', 'yesterday', 'later', 'soon',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'part', 'read', 'move', 'leaving', 'bored', 'rain', 'maybe', 'anyway', 'anyways', 'alright', 'first', 'last', 'next',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twenty', 'thirty', 'hundred', 'thousand',
  // Adverbs, which open her sentences constantly. Not caught by their ending:
  // Family, Emily, Italy and Kelly end the same way and are names.
  'obviously', 'honestly', 'frankly', 'seriously', 'probably', 'really', 'actually', 'literally', 'basically', 'clearly', 'apparently',
  'exactly', 'finally', 'usually', 'definitely', 'absolutely', 'certainly', 'hardly', 'barely', 'nearly', 'mostly', 'surely', 'simply',
  'suddenly', 'unfortunately', 'fortunately', 'especially', 'totally', 'completely', 'entirely', 'generally', 'normally', 'currently',
  'recently', 'lately', 'early', 'likely', 'sadly', 'luckily', 'hopefully', 'personally', 'technically', 'officially', 'originally', 'roughly',
]);

const CAPITALISED = /^[A-Z][a-z]+$/;
/** AMD, XT, PCs, GPUs — two or more capitals, an optional plural. */
const ACRONYM = /^[A-Z]{2,}s?$/;
/** iGaming, PowerShell, YouTube — a capital somewhere after the first letter. */
const MIXED_CASE = /^[a-z]+[A-Z][A-Za-z]*$|^[A-Z][a-z]+[A-Z][A-Za-z]*$/;
/** 9060, 9060XT, 3060Ti — a model number, only ever kept beside a word. */
const MODEL_NUMBER = /^\d{3,5}[A-Za-z]{0,3}$/;

/** Enough for one person's names; well inside the half-window Whisper gives hotwords. */
const LIMIT = 30;
const MAX_CHARS = 220;

const bare = (word: string) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').replace(/['’](?:s|t|ll|re|ve|d|m)$/i, '');

/**
 * The names in a run of text: a capitalised word that is not merely opening a
 * sentence, an acronym, a mixed-case brand, a model number, and any run of
 * those in a row taken as one term ("Chainsaw Man", "Family Sharing",
 * "RX 9060 XT").
 *
 * The first word of a sentence is the whole difficulty. "Himeno's death." and
 * "Eat." are the same shape, and she writes one-word orders all day. So a plain
 * capitalised word at the front of a sentence is taken only when something else
 * vouches for it: it was possessive ("Himeno's"), or it has been seen
 * capitalised in the middle of a sentence somewhere, where capitals are not
 * free. That holds even at the front of a run: "Ask Denji" and "Family Sharing"
 * are the same shape, and an order with a name after it is what she writes.
 * Acronyms and brands need no witness; neither does anything after the first
 * word, since by then it is mid-sentence.
 */
export function namesInText(texts: string[]): string[] {
 if(process.env.HARU_CORE_SPEECH_CONTEXT==='on')return corePolicySync('speech-context.names',[texts]);
  // A word seen in lowercase anywhere is a word, not a name: "Fine." at the top
  // of one reply and "fine" in the middle of the next settles it.
  const lowercase = new Set<string>();
  const vouched = new Set<string>();
  const sentences: string[][] = [];
  for (const text of texts) for (const sentence of text.split(/[.!?…\n]+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length) sentences.push(words);
    words.forEach((word, index) => {
      const clean = bare(word);
      if (/^[a-z]+$/.test(clean)) lowercase.add(clean);
      else if (CAPITALISED.test(clean)) {
        if (index > 0) vouched.add(clean.toLowerCase());
        if (/[\'’]s[^A-Za-z]*$/i.test(word)) vouched.add(clean.toLowerCase());
      }
    });
  }
  const isName = (clean: string) => {
    if (clean.length < 2) return false;
    if (MIXED_CASE.test(clean)) return true;
    if (ACRONYM.test(clean)) return !NOT_A_TERM.has(clean.toLowerCase());
    if (MODEL_NUMBER.test(clean)) return /[A-Za-z]/.test(clean);
    if (!CAPITALISED.test(clean)) return false;
    const lower = clean.toLowerCase();
    return !NOT_A_TERM.has(lower) && !lowercase.has(lower);
  };
  const found: string[] = [];
  for (const words of sentences) {
    let run: string[] = [];
    let opensSentence = false;
    const close = () => {
      if (opensSentence && run.length && CAPITALISED.test(run[0]) && !vouched.has(run[0].toLowerCase())) run.shift();
      if (run.length && !/^\d+$/.test(run.join(''))) found.push(run.join(' '));
      run = [];
    };
    words.forEach((word, index) => {
      const clean = bare(word);
      if (isName(clean)) { if (!run.length) opensSentence = index === 0; run.push(clean); }
      else if (run.length && MODEL_NUMBER.test(clean)) run.push(clean);
      else close();
      // A comma ends a run: "Denji, Himeno" is two names, not one.
      if (/[,;:]$/.test(word)) close();
    });
    close();
  }
  return found;
}

export type VocabularySources = {
  /** The conversation she can see, oldest first. */
  chat?: string[];
  /** Who is talking, and who she is. */
  names?: string[];
  /** What she has been taught she mishears — the corrected side. */
  taught?: string[];
  /** The places she has been told about. */
  places?: string[];
  /** What is on the list. */
  kept?: string[];
  /** What they wrote about themselves: the towns, streets and people in it. */
  about?: string[];
};

/**
 * What to tell the decoder, most certain first: the names typed in outrank the
 * names inferred from text, and the latest conversation outranks the earliest.
 * Deduplicated without regard to case, capped by count and by length, since
 * Whisper truncates the list itself and the important ones should be at the
 * front when it does.
 */
export function spokenVocabulary(sources: VocabularySources, limit = LIMIT): string[] {
 if(process.env.HARU_CORE_SPEECH_CONTEXT==='on')return corePolicySync('speech-context.vocabulary',[sources,limit]);
  const chat = (sources.chat ?? []).slice().reverse();
  const candidates = [
    ...(sources.names ?? []),
    ...(sources.taught ?? []),
    ...(sources.places ?? []),
    ...namesInText(sources.kept ?? []),
    ...namesInText(sources.about ?? []),
    ...namesInText(chat),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of candidates) {
    const term = (raw ?? '').trim().replace(/\s+/g, ' ');
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > 40 || seen.has(key)) continue;
    if (out.length >= limit || chars + term.length + 2 > MAX_CHARS) break;
    seen.add(key);
    out.push(term);
    chars += term.length + 2;
  }
  return out;
}
