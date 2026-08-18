// What is allowed to leave this machine.
//
// Escalation until now asked one question — is this hard? — and a hard question
// containing a password is still a password. This asks the other one, and it has
// the final say: a thing judged unsafe stays local no matter how badly the local
// model would answer it.
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
export function mayLeaveTheMachine(text: string, readLocalContent = false): Verdict {
  if (readLocalContent) return refuse('a file from this machine is in this conversation');
  const said = text ?? '';
  if (!said.trim()) return SAFE;

  for (const [pattern, what] of LOOKS_LIKE_A_SECRET) {
    if (pattern.test(said)) return refuse(`it contains ${what}`);
  }
  if (hasCardNumber(said)) return refuse('it contains what looks like a card number');
  if (NAMES_A_SECRET.test(said)) return refuse('it is about passwords or keys');
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
    const verdict = mayLeaveTheMachine(String(message.content ?? ''));
    if (!verdict.safe) {
      return refuse(message.role === 'user' ? verdict.because : `${verdict.because}, from earlier in this conversation`);
    }
  }
  return SAFE;
}
