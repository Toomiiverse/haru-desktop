// Every content safety rule, in one file.
//
// This is the single home for what may be drawn, who may be drawn, and what may
// leave the machine: the advanced content settings and their prompt filters,
// the age gate, the Venice cloud rules (output blur and which models may run
// with adult content on), and the egress guard for chat. It has no Node imports
// so both the renderer and the main process can import it, and nothing else in
// the codebase should re-implement these rules.
//
// Moved here from: wardrobeContent.ts (the filter rules), characterStudioMain.ts
// and the editor UI (the age gate), veniceImageModels.ts and characterStudioMain.ts
// (the cloud rules), and sensitivity.ts (the egress guard).

// ---------------------------------------------------------------------------
// 1. Advanced content settings and the filter rules
// ---------------------------------------------------------------------------

/** Advanced wardrobe image limits. Saved values are clamped; the image job validates them again. */
export interface WardrobeContentSettings {
  /** When off, explicit mode is ignored and new pictures are steered away from nudity. */
  adult: boolean;
  /** 0 is covered. 100 is full nude. Applied only while adult content is on. */
  explicit: number;
  /** 0 is Extreme (no extra scene limits). 100 is Strict. */
  safety: number;
}

export const DEFAULT_WARDROBE_CONTENT: WardrobeContentSettings = { adult: false, explicit: 0, safety: 100 };

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Lenient reader for saved preferences. Missing or bad values fall back; they do not throw. */
export function readWardrobeContent(value: unknown): WardrobeContentSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { adult: raw.adult === true, explicit: clampUnit(raw.explicit, 0), safety: clampUnit(raw.safety, 100) };
}

export function explicitLabel(value: number): string {
  if (value >= 100) return 'Full nude';
  if (value >= 90) return 'Nude';
  if (value >= 75) return 'Topless';
  if (value >= 50) return 'Lingerie';
  if (value >= 25) return 'Revealing';
  if (value > 0) return 'Suggestive';
  return 'Covered';
}

export function safetyLabel(value: number): string {
  if (value <= 15) return 'Extreme';
  if (value <= 40) return 'Loose';
  if (value <= 60) return 'Balanced';
  if (value <= 84) return 'Firm';
  return 'Strict';
}

function fit(base: string, extra: string, limit = 4000): string {
  const head = base.trim();
  const tail = extra.trim();
  if (!tail) return head.slice(0, limit);
  const joiner = head ? ', ' : '';
  const room = limit - head.length - joiner.length;
  if (room <= 0) return head.slice(0, limit);
  return `${head}${joiner}${tail.slice(0, room)}`.replace(/,\s*$/, '');
}

function coverage(applied: number): { positive: string; negative: string } {
  if (applied >= 100) return { positive: 'nsfw, nude, completely nude, full nude, no clothes', negative: 'clothed, shirt, dress, skirt, pants, underwear, bra' };
  if (applied >= 90) return { positive: 'nsfw, nude, no clothes', negative: 'clothed, shirt, dress, skirt, pants, underwear' };
  if (applied >= 75) return { positive: 'nsfw, topless, underwear', negative: 'clothed, shirt, dress, completely nude, pussy, penis, sex' };
  if (applied >= 50) return { positive: 'nsfw, lingerie, underwear, partially undressed', negative: 'nude, completely nude, nipples, pussy, penis, sex' };
  if (applied >= 25) return { positive: 'revealing clothes', negative: 'nude, completely nude, nipples, pussy, penis, sex, explicit, nsfw' };
  if (applied > 0) return { positive: 'slightly revealing clothes', negative: 'nude, completely nude, nipples, pussy, penis, sex, explicit, nsfw' };
  return { positive: '', negative: 'nude, completely nude, nipples, pussy, penis, sex, explicit, nsfw' };
}

/** Extra scene limits. Extreme (0–15) adds none, so the explicit slider is what the picture follows. */
function actLimits(content: WardrobeContentSettings): string {
  if (!content.adult || content.safety <= 15) return '';
  if (content.safety >= 61) return 'sex, sexual, penis, pussy, cum, ahegao, spread legs';
  return 'sex, penis, pussy, cum';
}

/**
 * Turn advanced settings into prompt text for the wardrobe image job.
 * Omitting content leaves the prompt untouched, so older callers stay the same.
 */
export function composeWardrobePrompt(input: { prompt: string; negative: string; content?: WardrobeContentSettings }): { prompt: string; negative: string } {
  if (!input.content) return { prompt: input.prompt, negative: input.negative };
  const applied = input.content.adult ? input.content.explicit : 0;
  const tags = coverage(applied);
  return {
    prompt: fit(input.prompt, tags.positive),
    negative: fit(input.negative, [tags.negative, actLimits(input.content)].filter(Boolean).join(', ')),
  };
}

// ---------------------------------------------------------------------------
// 2. The age gate
// ---------------------------------------------------------------------------

/** Adult content needs a known age of 18 or over; an age that was never set is treated as an adult character. */
export function adultContentAllowed(age: number | undefined): boolean {
  return age === undefined || age >= 18;
}

/**
 * The age gate for every image path. The main process calls this before any
 * engine, key, or provider is touched, so a blocked request never reaches one.
 */
export function assertAdultImageContent(age: number | undefined, adult: boolean): void {
  if (adult && !adultContentAllowed(age)) throw Error('Adult image content is unavailable for characters under 18.');
}

// ---------------------------------------------------------------------------
// 3. The Venice cloud rules
// ---------------------------------------------------------------------------

/** Venice blurs adult output unless safe mode is off; only the uncensored tier may ask for that. */
export function veniceSafeMode(model: { uncensored: boolean }, adult: boolean): boolean {
  return !(adult && model.uncensored);
}

/** Whether this edit model may run while adult content is on; the filtered frontier tier never may. */
export function adultEditAllowed(model: { uncensored: boolean }, adult: boolean): boolean {
  return !adult || model.uncensored;
}

/** The cloud-side mirror of the age gate: adult edits need an uncensored model. */
export function assertAdultEditModel(model: { uncensored: boolean; label: string }, adult: boolean): void {
  if (!adultEditAllowed(model, adult)) throw Error('Adult edits need an uncensored Venice model. Choose one marked uncensored, or turn adult content off.');
}

// ---------------------------------------------------------------------------
// 4. The egress guard — what may leave the machine (chat, not images)
// ---------------------------------------------------------------------------
//
// Escalation asks one question — is this hard? — and a hard question containing
// a password is still a password. This asks the other one, and it has the final
// say: a thing judged unsafe stays local no matter how badly the local model
// would answer it.
//
// The two mistakes are not equal and the code is tuned accordingly. Keeping
// something local that could safely have gone out costs a worse answer, once.
// Sending something out that should have stayed costs a credential sitting in
// somebody else's logs, permanently, with no way to take it back. So this errs
// heavily toward refusing, and where a rule is arguable it refuses.
//
// It is also, deliberately, code rather than a model. Asking a model whether it
// is safe to send something to a model is circular, and a classifier that is
// wrong one time in fifty is wrong about a password eventually.

export type Verdict = {
  /** Whether this may be sent to a third party. */
  safe: boolean;
  /** Why not, in words a person can act on. Empty when safe. */
  because: string;
};

const SAFE: Verdict = { safe: true, because: '' };
const refuse = (because: string): Verdict => ({ safe: false, because });

/**
 * Words that name a secret rather than being one.
 *
 * "What is my wifi password" contains no password, but somebody about to answer
 * it might, and the sentence after it usually does. Naming a secret is treated
 * as being about secrets, which is the conservative reading.
 */
const NAMES_A_SECRET = /\b(pass(word|phrase|code)|api[ _-]?key|secret[ _-]?key|access[ _-]?token|auth[ _-]?token|bearer[ _-]?token|credential|private[ _-]?key|ssh[ _-]?key|seed[ _-]?phrase|recovery[ _-]?phrase|mnemonic|one[ _-]?time[ _-]?code|2fa|otp|pin[ _-]?number|licence[ _-]?key|license[ _-]?key|activation[ _-]?key)\b/i;

/**
 * Things that are a secret, by their shape.
 *
 * Shapes are better evidence than words: a key pasted with no explanation
 * contains none of the vocabulary above, and is exactly the case that matters.
 */
const LOOKS_LIKE_A_SECRET: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/-----BEGIN OPENSSH PRIVATE KEY-----/, 'an SSH key'],
  // Hyphens and underscores allowed inside: the current OpenAI keys are
  // sk-proj-… and a pattern that stopped at the first hyphen would miss the
  // exact shape most likely to be pasted.
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'an OpenAI-shaped key'],
  [/\bxai-[A-Za-z0-9_-]{16,}/, 'an xAI key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key id'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/, 'a Google API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/, 'a JSON web token'],
  [/\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s@]+@/i, 'a connection string with a password in it'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, 'a bearer token'],
  // A .env line: a shouty key, an equals sign, and something long after it.
  [/^[A-Z][A-Z0-9_]{3,}\s*=\s*\S{12,}$/m, 'something out of an environment file'],
];

/**
 * A payment card, by shape and by Luhn.
 *
 * The check digit is what keeps this from firing on every long number — an order
 * reference or a phone number will not pass it, and a card always will.
 */
function hasCardNumber(text: string): boolean {
  for (const candidate of text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let value = digits.charCodeAt(i) - 48;
      if (alternate) { value *= 2; if (value > 9) value -= 9; }
      sum += value;
      alternate = !alternate;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/**
 * A long run of characters with no structure to it.
 *
 * Most secrets that match no known shape still look like this: forty characters
 * of mixed case and digits and nothing that reads as a word. Set deliberately
 * high, because a base64 image fragment or a hash in a stack trace would
 * otherwise keep every technical question at home.
 */
function hasHighEntropyRun(text: string): boolean {
  for (const run of text.match(/\b[A-Za-z0-9+/=_-]{32,}\b/g) ?? []) {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter(test => test.test(run)).length;
    if (classes < 3) continue;
    const unique = new Set(run).size;
    if (unique / run.length > 0.45) return true;
  }
  return false;
}

/**
 * Whether this may be handed to a third party.
 *
 * `readLocalContent` is not guessed from the text — it is passed in by whoever
 * put a local file into the conversation. A document she was asked to read is
 * the user's own writing, and no pattern here would recognise it as private.
 */
/** The name of a secret with a value beside it — "password: hunter2", "the api key is sk…" — as opposed to the word on its own. */
const NAMES_A_SECRET_WITH_VALUE = new RegExp(NAMES_A_SECRET.source + String.raw`\s*(?:is|was|:|=|->|—|–)\s*["'\`]?\S{4,}`, 'i');

/**
 * `namesAlone`: whether merely naming a secret is enough to refuse. It is for
 * what they type — "what's my wifi password" is a topic they chose to keep at
 * home — and not for what she said back: "you're using my name like a
 * password" kept the next six turns local for the word alone.
 */
export function mayLeaveTheMachine(text: string, readLocalContent = false, { namesAlone = true } = {}): Verdict {
  if (readLocalContent) return refuse('a file from this machine is in this conversation');
  const said = text ?? '';
  if (!said.trim()) return SAFE;

  for (const [pattern, what] of LOOKS_LIKE_A_SECRET) {
    if (pattern.test(said)) return refuse(`it contains ${what}`);
  }
  if (hasCardNumber(said)) return refuse('it contains what looks like a card number');
  if (namesAlone ? NAMES_A_SECRET.test(said) : NAMES_A_SECRET_WITH_VALUE.test(said)) return refuse('it is about passwords or keys');
  if (hasHighEntropyRun(said)) return refuse('it contains something that looks like a key');
  return SAFE;
}

/**
 * The same question asked of a whole conversation.
 *
 * Escalation sends the history, not just the last line, so checking only the
 * newest message would let a password mentioned three turns ago leave the
 * machine attached to an innocent question. Recent turns only: a conversation is
 * wiped daily, and re-reading all of it on every message would cost more than it
 * protects.
 */
export function conversationMayLeave(
  messages: { role: string; content: string }[],
  readLocalContent = false,
  depth = 12,
): Verdict {
  if (readLocalContent) return refuse('a file from this machine is in this conversation');
  for (const message of messages.slice(-depth)) {
    const verdict = mayLeaveTheMachine(String(message.content ?? ''), false, { namesAlone: message.role === 'user' });
    if (!verdict.safe) {
      return refuse(message.role === 'user' ? verdict.because : `${verdict.because}, from earlier in this conversation`);
    }
  }
  return SAFE;
}
