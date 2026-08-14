// Turning a written reply into something worth hearing.
//
// Two jobs live here, and they are separate on purpose. Preparing the text is
// pure and engine-agnostic — what she says out loud differs from what is on
// screen no matter who synthesises it. Reaching the engine is a thin adapter
// per HTTP contract, so a voice trained in one toolchain can be swapped for
// another by changing a setting rather than the app.
//
// Synthesis stays in main for the same reason the Ollama calls do: the renderer
// gets audio, never an endpoint or a key.

import { net } from 'electron';
import { EMOTIONS, type EmotionName } from './emotion';

// 'windows' has no adapter here — it is spoken by the renderer through the
// built-in SAPI voices, which are reachable from a window and nowhere else.
export type VoiceEngine = 'off' | 'windows' | 'openai' | 'gpt-sovits';

/** A clip to clone from, and what it says. The two travel together because a
 *  transcript that does not match its clip drags the cloned timbre off target —
 *  it does not merely get the words wrong. */
export type VoiceReference = { clip: string; text: string };

export type VoiceConfig = {
  engine: VoiceEngine;
  endpoint: string;
  /** OpenAI-compatible: the voice name. GPT-SoVITS: path to the reference clip. */
  voice: string;
  /** GPT-SoVITS only: what the reference clip actually says. */
  referenceText: string;
  language: string;
  speed: number;
  /** 0..1, applied at playback rather than at synthesis so it takes effect instantly. */
  volume: number;
  /**
   * Per-emotion clips, so her voice moves with her mood the way her face already
   * does. Sparse on purpose: anything unmapped falls back to the default clip,
   * so one good reference is a complete configuration and the rest is optional.
   */
  emotionVoices: Partial<Record<EmotionName, VoiceReference>>;
  /** Optional clip for shouted lines. Falls back to the annoyed clip. */
  shoutVoice?: VoiceReference;
};

export const DEFAULT_VOICE: VoiceConfig = {
  engine: 'off',
  endpoint: 'http://127.0.0.1:9880',
  voice: '',
  referenceText: '',
  language: 'en',
  speed: 1,
  volume: 0.9,
  emotionVoices: {},
};

/**
 * The clip to clone from for this line. A mapping only counts if it actually has
 * a clip — a half-filled row in the settings should fall back rather than send an
 * empty path the server will reject.
 */
export function referenceFor(config: VoiceConfig, emotion?: EmotionName | null): VoiceReference {
  const mapped = emotion ? config.emotionVoices[emotion] : undefined;
  if (mapped?.clip) return mapped;
  return { clip: config.voice, text: config.referenceText };
}

/** What a chunk of speech looks like on its way to the window that plays it. */
export type SpeechClip = {
  /** Discarded if it does not match the turn currently being spoken. */
  turn: number;
  /** Always present: the renderer speaks this itself when the engine is 'windows'. */
  text: string;
  audio?: Uint8Array;
  mime?: string;
};

// Long enough for a slow first synthesis on CPU — GPT-SoVITS takes a few seconds
// to warm up — without hanging the queue forever if the server has gone away.
const REQUEST_TIMEOUT_MS = 30_000;

// Chunks are kept short so the first one comes back fast and she starts talking
// while the rest is still being synthesised. Too short and the engine loses the
// sentence prosody that makes it sound intended rather than recited.
const MAX_CHUNK_CHARS = 180;

function trimEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

/**
 * Strips what reads well but does not speak well. Markdown syntax is the main
 * offender — read literally it becomes "asterisk asterisk" — and code blocks
 * are dropped whole rather than narrated character by character.
 */
/**
 * Initialisms that are meant to be spelled out, because that is how they are
 * said aloud. Checked against what she actually writes: CPU appears 36 times in
 * her history and PC 31, so getting this wrong in the other direction would be
 * far more damaging than the bug it fixes.
 */
const SAID_AS_LETTERS = new Set([
  'CPU', 'GPU', 'PC', 'AM', 'PM', 'ADHD', 'AI', 'TTS', 'TV', 'GPT', 'RTX', 'DDR', 'IQ', 'UV', 'VI',
  'CBD', 'STD', 'TMI', 'SS', 'USB', 'RAM', 'SSD', 'API', 'URL', 'HTTP', 'FPS', 'DM', 'UK', 'US',
  'HD', 'ID', 'OS', 'IT', 'HR', 'ETA', 'FAQ', 'PDF', 'USD', 'AUD', 'NSFW', 'IRL', 'AFK',
]);

/** Words she shouts rather than abbreviates, whatever their length. */
const SHOUTED = new Set(['NO', 'GO', 'OI', 'HEY', 'NOW', 'STOP', 'WHAT', 'WHY', 'YES', 'FINE', 'MOVE', 'DONE', 'NEVER', 'ALWAYS', 'PLEASE', 'SERIOUSLY', 'ACTUALLY', 'REALLY', 'EVERY']);

/**
 * Capitals are emphasis, and emphasis is not an initialism.
 *
 * Given "STOP" the engine says S-T-O-P, because a run of capitals is exactly what
 * an abbreviation looks like. Spelled aloud it is unintelligible; she is meant to
 * be raising her voice. There is no SSML here to mark stress with, so the fix is
 * to hand it a word rather than a run of letters — the delivery still carries
 * from the punctuation around it.
 *
 * Deliberately conservative. Anything on the initialism list is left exactly as
 * it is, and so is anything short enough to be ambiguous, because "cpu" spoken as
 * a word is a worse failure than "STOP" spelled out.
 */
export function spokenCase(text: string): string {
  return text.replace(/\b[A-Z][A-Z'’]{1,}\b/g, token => {
    const letters = token.replace(/['’]/g, '');
    if (SHOUTED.has(letters)) return token.toLowerCase();
    if (SAID_AS_LETTERS.has(letters)) return token;
    // Two letters is where a shout and an abbreviation are least distinguishable,
    // and abbreviations are far commoner, so they stay as they are.
    if (letters.length < 3) return token;
    // No vowel means nothing to pronounce — it can only be an abbreviation.
    if (!/[AEIOUY]/.test(letters)) return token;
    return token.charAt(0) + token.slice(1).toLowerCase();
  });
}

/**
 * Whether this passage is being shouted.
 *
 * Kept separate from spokenCase, and run before it, because the two want the
 * text at different stages: this needs the capitals to know a shout happened,
 * and spokenCase removes them so the engine will pronounce the word. The
 * capitals also survive into the subtitle, where seeing STOP is the point.
 */
export function hasShout(text: string): boolean {
  for (const token of text.match(/\b[A-Z][A-Z'’]{1,}\b/g) ?? []) {
    const letters = token.replace(/['’]/g, '');
    if (SHOUTED.has(letters)) return true;
    if (SAID_AS_LETTERS.has(letters)) continue;
    if (letters.length >= 3 && /[AEIOUY]/.test(letters)) return true;
  }
  // Three or more marks in a row is the other way she raises her voice.
  return /[!?]{2,}/.test(text);
}

/**
 * The clip to shout with. Her angry clip is the right one and she usually
 * already has it mapped, so this needs no new setup to work — a dedicated
 * shoutVoice is there for anyone who wants to record one properly.
 */
export function shoutReference(config: VoiceConfig, fallback: VoiceReference): VoiceReference {
  if (config.shoutVoice?.clip) return config.shoutVoice;
  const angry = config.emotionVoices.annoyed;
  if (angry?.clip) return angry;
  return fallback;
}

export function speakableText(reply: string): string {
  return reply
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    // Link text carries the meaning; the URL spoken aloud is noise.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // A bracketed aside left inside a sentence is a stage direction, not
    // something she said. Whole paragraphs of it are already gone by now; this
    // catches "so anyway [she sighs] fine." mid-line.
    .replace(/\[[^\]]{1,80}\]/g, ' ')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    // Ordered list markers go, but "1990." mid-sentence has to survive, so this
    // only matches a number that opens a line.
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    // Emoji and pictographs: some engines name them aloud, most emit a gap.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits into pieces small enough to synthesise quickly, breaking at sentence
 * ends so no chunk starts mid-thought. A sentence longer than the limit is left
 * whole rather than cut at an arbitrary character — a clause broken in half
 * sounds worse than one long chunk takes to arrive.
 */
export function splitForSpeech(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(part => part.trim().length);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) { current = sentence; continue; }
    if (current.length + sentence.length + 1 <= maxChars) current = `${current} ${sentence}`;
    else { chunks.push(current); current = sentence; }
  }
  if (current) chunks.push(current);
  // Nothing but punctuation or whitespace is not worth a request.
  return chunks.filter(chunk => /[\p{Letter}\p{Number}]/u.test(chunk));
}

async function post(url: string, body: unknown, auth: Record<string, string> = {}) {
  const response = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // These servers report failures as JSON even when asked for audio, and the
    // message is the only thing that says which field was wrong.
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const payload = await response.text();
    throw new Error(`the server returned a message instead of audio: ${payload.slice(0, 300)}`);
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  // A 200 and a well-formed WAV are not proof of speech. GPT-SoVITS answers 200
  // with a buffer of pure silence when inference throws part-way — seen for real
  // when a print() of a non-ASCII string hit a cp1252 stdout and killed the run
  // mid-generation. Unchecked, that reaches the speakers as nothing at all and
  // reads as a bug in playback rather than as a server that failed.
  if (isSilent(audio)) throw new Error('the server returned silence — inference probably failed part-way. Check its console output.');
  return { audio, mime: type || 'audio/wav' };
}

/**
 * True when a 16-bit PCM WAV carries no signal. Anything that is not a WAV this
 * can parse is treated as fine — the check exists to catch a specific failure,
 * not to sit in judgement on formats it does not understand.
 */
function isSilent(bytes: Uint8Array): boolean {
  if (bytes.length < 64) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) return false; // 'RIFF'
  // Walk the chunk list rather than assuming a 44-byte header: WAVs written with
  // LIST or fact chunks put the samples somewhere else entirely.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 0x64617461) { // 'data'
      const end = Math.min(bytes.length, body + size);
      // Every 16th sample is plenty to find speech, and keeps this off the hot path.
      for (let i = body; i + 1 < end; i += 32) {
        if (Math.abs(view.getInt16(i, true)) > 64) return false;
      }
      return true;
    }
    offset = body + size + (size % 2);
  }
  return false;
}

/**
 * One chunk of speech as audio bytes. Returns null for engines the renderer
 * speaks itself, so callers can treat every engine the same way.
 */
export async function synthesise(text: string, config: VoiceConfig, reference: VoiceReference = referenceFor(config), auth: Record<string, string> = {}): Promise<{ audio: Uint8Array; mime: string } | null> {
  const endpoint = trimEndpoint(config.endpoint);
  switch (config.engine) {
    case 'off':
    case 'windows':
      return null;
    // Covers anything speaking OpenAI's /audio/speech shape — openedai-speech
    // wrapping an XTTS clone, Kokoro-FastAPI, LocalAI.
    case 'openai':
      return post(`${endpoint}/audio/speech`, {
        model: 'tts-1',
        input: text,
        // Named voices, not cloned clips: an emotion mapping has nothing to
        // select here, so this stays on the configured voice.
        voice: config.voice || 'alloy',
        response_format: 'wav',
        speed: config.speed,
      }, auth);
    // GPT-SoVITS api_v2.py. The reference clip is what the voice is cloned from,
    // and its transcript has to match or the output drifts badly off-target.
    case 'gpt-sovits':
      return post(`${endpoint}/tts`, {
        text,
        text_lang: config.language,
        ref_audio_path: reference.clip,
        prompt_text: reference.text,
        prompt_lang: config.language,
        media_type: 'wav',
        streaming_mode: false,
        speed_factor: config.speed,
        // The server's own default is cut5, which splits on every comma — its
        // punctuation set literally contains "," — and synthesises each fragment
        // as a separate utterance. That is why she stopped dead at every comma:
        // not a pause in her delivery but the seam between two takes.
        //
        // cut0 does not split at all, which is right because the text arriving
        // here has already been cut into sentence-sized pieces by
        // splitForSpeech. Left to the server it was being cut twice, and the
        // second cut was the one nobody asked for.
        text_split_method: 'cut0',
      }, auth);
  }
}

/** Reads a stored config forward, so a partial or older record still starts up. */
export function readVoiceConfig(saved: unknown): VoiceConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_VOICE;
  const record = saved as Partial<VoiceConfig>;
  const engines: VoiceEngine[] = ['off', 'windows', 'openai', 'gpt-sovits'];
  return {
    engine: engines.includes(record.engine as VoiceEngine) ? record.engine as VoiceEngine : DEFAULT_VOICE.engine,
    endpoint: typeof record.endpoint === 'string' ? record.endpoint : DEFAULT_VOICE.endpoint,
    voice: typeof record.voice === 'string' ? record.voice : DEFAULT_VOICE.voice,
    referenceText: typeof record.referenceText === 'string' ? record.referenceText : DEFAULT_VOICE.referenceText,
    language: typeof record.language === 'string' ? record.language : DEFAULT_VOICE.language,
    speed: typeof record.speed === 'number' && record.speed > 0 ? Math.min(2, record.speed) : DEFAULT_VOICE.speed,
    volume: typeof record.volume === 'number' ? Math.max(0, Math.min(1, record.volume)) : DEFAULT_VOICE.volume,
    emotionVoices: readEmotionVoices(record.emotionVoices),
    shoutVoice: readReference(record.shoutVoice),
  };
}

/** One clip-and-transcript pair, or nothing if it has no clip. */
function readReference(saved: unknown): VoiceReference | undefined {
  if (!saved || typeof saved !== 'object') return undefined;
  const { clip, text } = saved as Partial<VoiceReference>;
  if (typeof clip !== 'string' || !clip.trim()) return undefined;
  return { clip, text: typeof text === 'string' ? text : '' };
}

/** Keeps only entries naming a real emotion and carrying an actual clip, so a
 *  half-filled row cannot become a request with an empty path in it. */
function readEmotionVoices(saved: unknown): Partial<Record<EmotionName, VoiceReference>> {
  if (!saved || typeof saved !== 'object') return {};
  const source = saved as Record<string, unknown>;
  const result: Partial<Record<EmotionName, VoiceReference>> = {};
  for (const emotion of EMOTIONS) {
    const entry = source[emotion];
    if (!entry || typeof entry !== 'object') continue;
    const { clip, text } = entry as Partial<VoiceReference>;
    if (typeof clip !== 'string' || !clip.trim()) continue;
    result[emotion] = { clip, text: typeof text === 'string' ? text : '' };
  }
  return result;
}
