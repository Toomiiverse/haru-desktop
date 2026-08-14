// Speech to text — the other half of the boundary in ./voice.
//
// Same shape and same reasoning: one function that takes audio and gives back
// words, and an HTTP contract that is somebody else's standard rather than ours.
// The route is OpenAI's `/v1/audio/transcriptions`, which whisper.cpp's server,
// faster-whisper, LocalAI and the rest already speak, so changing engine is a
// change of endpoint and nothing more. Adding another means one more case in
// `transcribe`; nothing upstream knows which engine produced the text.
//
// The recording never touches disk. It is captured in the companion window,
// passed through here as bytes, and dropped as soon as the transcript comes
// back — the same rule the window titles in ./activity follow, for the same
// reason: a microphone that keeps what it heard is a different product.

export type ListenEngine = 'off' | 'local';

export type ListenConfig = {
  engine: ListenEngine;
  endpoint: string;
  language: string;
  /** Send as soon as the transcript arrives, instead of filling the box. */
  autoSend: boolean;
  /**
   * Answer to her name instead of to the button. Off by default and worth
   * keeping that way: this is the one setting here that holds the microphone
   * open, and everything said near the machine gets transcribed to find out
   * whether it was meant for her. It all happens locally and nothing is kept,
   * but it is still a different bargain from press-to-talk and should be chosen
   * rather than inherited.
   */
  wakeWord: boolean;
  /**
   * Listen for an answer whenever she speaks first — the opening line, a
   * reaction to a window changing, a reminder, being poked.
   *
   * Cheaper than the wake word in every sense: the microphone opens for a few
   * seconds at a moment she chose, rather than staying open, and no name is
   * needed because she already has your attention. Where the wake word is on
   * this costs nothing at all, since the microphone is open regardless and this
   * only decides whether the next thing said counts as a reply.
   */
  replyWindow: boolean;
};

export const DEFAULT_LISTEN: ListenConfig = {
  engine: 'off',
  endpoint: 'http://127.0.0.1:9881',
  language: 'en',
  autoSend: false,
  wakeWord: false,
  replyWindow: false,
};

/** Reads a stored config forward, so a partial or older record still starts up. */
export function readListenConfig(saved: unknown): ListenConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_LISTEN;
  const record = saved as Partial<ListenConfig>;
  const engines: ListenEngine[] = ['off', 'local'];
  return {
    engine: engines.includes(record.engine as ListenEngine) ? record.engine as ListenEngine : DEFAULT_LISTEN.engine,
    endpoint: typeof record.endpoint === 'string' && record.endpoint.trim() ? record.endpoint.trim() : DEFAULT_LISTEN.endpoint,
    language: typeof record.language === 'string' && record.language.trim() ? record.language.trim() : DEFAULT_LISTEN.language,
    autoSend: record.autoSend === true,
    wakeWord: record.wakeWord === true,
    replyWindow: record.replyWindow === true,
  };
}

function trimEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, '');
}

/**
 * Whisper hallucinates on silence. The VAD in the server catches most of it, but
 * a short recording of nothing still comes back as one of a small set of stock
 * phrases — the subtitles it saw most in training. They are worth dropping here
 * rather than sending her "Thank you." because somebody bumped the key.
 */
const HALLUCINATED = /^(thank you\.?|thanks for watching[.!]?|you|bye[.!]?|\.|,|♪+|\[.*\]|\(.*\))$/i;

/**
 * Anything the model was ever primed with, kept here even though nothing primes
 * it any more. A stale server, an older build, or a prompt somebody adds later
 * all reintroduce the same failure — the transcript comes back as the prompt and
 * reads as a real sentence, so no amount of general filtering catches it.
 */
const PROMPT_ECHOES = [
  'a casual spoken message to a desktop companion',
  'haru a casual spoken message to a desktop companion',
];

export function looksLikeNothing(text: string) {
  const trimmed = text.trim();
  if (!trimmed || HALLUCINATED.test(trimmed)) return true;
  const bare = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  return PROMPT_ECHOES.includes(bare);
}

/**
 * Audio in, words out. Throws with something worth reading, because every
 * failure here is one the user can act on — the server is not running, the
 * endpoint is wrong, or the clip was empty.
 */
/**
 * Narrower than `typeof fetch` on purpose: Electron's net.fetch takes a string
 * rather than a URL, and only this one call shape is ever used here.
 */
type PostAudio = (url: string, init: { method: string; body: FormData; headers?: Record<string, string> }) => Promise<Response>;

export async function transcribe(
  audio: Uint8Array,
  mime: string,
  config: ListenConfig,
  fetchImpl: PostAudio,
  auth: Record<string, string> = {},
): Promise<string> {
  if (config.engine === 'off') throw new Error('Speech to text is switched off.');
  if (!audio.length) throw new Error('The recording was empty.');

  const form = new FormData();
  // The filename matters: some servers pick their decoder from the extension
  // rather than sniffing the bytes.
  const extension = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', new Blob([audio as unknown as BlobPart], { type: mime }), `speech.${extension}`);
  form.append('language', config.language);
  // Deliberately no prompt. Priming the model biases it toward the words it was
  // primed with, which sounds like a free accuracy win and is not: given silence
  // it returns the prompt itself, word for word, and that goes to her as though
  // somebody said it. Her name being misheard is the matcher's problem, and the
  // matcher was written expecting exactly that.

  // No Content-Type: the boundary belongs to the FormData and setting it by hand
  // breaks the upload. Only the bearer goes in, and only when there is one.
  const response = await fetchImpl(`${trimEndpoint(config.endpoint)}/v1/audio/transcriptions`, { method: 'POST', body: form, headers: auth });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`the speech server returned ${response.status}: ${body || response.statusText}`);
  }
  const data = await response.json() as { text?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.text ?? '').trim();
}
