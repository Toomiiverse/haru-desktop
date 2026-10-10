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
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EMOTIONS, type EmotionName } from './emotion';
import { voiceSense, type DeliveryPlan } from './voice-sense';
import { coreIdentity } from './core-identity';
import { corePolicySync } from './core-policy-sync';

// 'windows' has no adapter here — it is spoken by the renderer through the
// built-in SAPI voices, which are reachable from a window and nowhere else.
export type VoiceEngine = 'off' | 'windows' | 'openai' | 'gpt-sovits' | 'hume' | 'breeze';

/** A clip to clone from, and what it says. The two travel together because a
 *  transcript that does not match its clip drags the cloned timbre off target —
 *  it does not merely get the words wrong. */
export type VoiceReference = { clip: string; text: string;
  /** More clips of the same voice in the same mood (GPT-SoVITS v2+ `aux_ref_audio_paths`): the timbre is fused across them, so one clip's quirk does not colour every line. */
  aux?: string[] };

/** GPT-SoVITS sampling, sent rather than left to the server. Temperature stays at 1: at 0.85 the smug reference cut every line off at half length — the cooler sampling reaches the end-of-speech token early. */
export type VoiceSampling = { topK: number; topP: number; temperature: number; repetitionPenalty: number; fragmentInterval: number };
export const DEFAULT_SAMPLING: VoiceSampling = { topK: 15, topP: 1, temperature: 1, repetitionPenalty: 1.35, fragmentInterval: 0.45 };

export type VoiceConfig = {
  /** Per-utterance direction, never saved by readVoiceConfig. */
  deliveryInstruction?: string;
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
  /** Her recorded sighs and grunts, for the gaps between paragraphs — see pickSigh. */
  sighs: string[];
  /** Optional clip for shouted lines. Falls back to the annoyed clip. */
  shoutVoice?: VoiceReference;
  /**
   * Whether the web door may synthesise. The desktop keeps the full TTS path;
   * a phone waits 8-17s a reply on it, which is where canned voice lines are
   * meant to take over. When false, /api/speak answers 503 and the page stays
   * silent rather than blocking on synthesis.
   */
  webEnabled: boolean;
  /** The desk window speaking her replies aloud. Off on a headless box, where it is a synthesis per reply for nobody. */
  desktopEnabled: boolean;
  /** GPT-SoVITS only; anything unset is DEFAULT_SAMPLING. */
  sampling?: Partial<VoiceSampling>;
  /** Breeze only: a voice already encoded on the server (see its /v1/voices).
   *  Sending voice_id skips the per-request reference encode — measured
   *  ~650 ms shaved off, and time to first audio drops from ~1.2 s to ~0.4 s. */
  voiceId?: string;
};

/** Hume's TTS endpoint: one utterance in, a WAV file out. */
export const HUME_TTS_URL = 'https://api.hume.ai/v0/tts/file';
/** The streaming half — audio arrives as it is generated, so a phone can start
 *  speaking on the first bytes instead of waiting for the whole clip. */
export const HUME_STREAM_URL = 'https://api.hume.ai/v0/tts/stream/file';

/** Breeze TTS 2's streaming endpoint: multipart form in, 24 kHz s16le PCM out. */
export const BREEZE_SPEECH_URL = '/v1/audio/speech';

/**
 * Haru's emotions, as short acting directions for Octave. With a voice already
 * chosen, the `description` field steers delivery — the docs recommend keeping
 * it to a few words. This is what replaces the twelve per-emotion reference
 * clips: one cloned voice, the mood carried by how it says the line.
 */
export const HUME_DESCRIPTIONS: Record<EmotionName, string> = {
  neutral: 'dry, flat, matter-of-fact',
  happy: 'bright, pleased',
  curious: 'interested, light, wondering',
  smug: 'smug, self-satisfied, teasing',
  annoyed: 'annoyed, clipped, testy',
  bored: 'bored, flat, unimpressed',
  sleepy: 'sleepy, slow, soft, low energy, a little annoyed',
  surprised: 'surprised, sharp',
  affectionate: 'warm, fond, soft',
  embarrassed: 'embarrassed, sheepish, deflecting',
  determined: 'determined, firm, pushing',
  worried: 'worried, soft, uncertain',
  shy: 'shy, flustered, hesitant, quiet',
  seductive: 'seductive, low, slow, husky',
  teasing: 'teasing, playful, smirking, sing-song',
  sexy: 'sultry, breathy, confident, warm',
  direct: 'direct, firm, blunt, no nonsense',
};

/** Breeze TTS 2 steers delivery with a natural-language `instruction`, so the
 *  acting directions do the same job they do for Hume. Breeze has no speed
 *  parameter — its own docs demonstrate tempo with "Speak slowly with a
 *  restrained, serious tone" — so the tempo cue lives in the instruction
 *  too, folded into each mood's direction. Kept as Breeze's own object rather
 *  than a shared one: the two engines get different phrasing ("description"
 *  there, a spoken sentence here), and a tempo that works in one voice does
 *  not necessarily suit the other. */
export const BREEZE_DESCRIPTIONS: Record<EmotionName, string> = {
  neutral: 'dry, flat, matter-of-fact',
  happy: 'bright, pleased, slightly quicker',
  curious: 'interested, light, wondering',
  smug: 'smug, self-satisfied, teasing, unhurried',
  annoyed: 'annoyed, clipped, testy, sharp',
  bored: 'bored, flat, unimpressed, drawn out',
  sleepy: 'sleepy, slow, soft and low, drowsy, a little annoyed',
  surprised: 'surprised, sharp, quick',
  affectionate: 'Warm and fond, soft and gentle, a little shy about it.',
  embarrassed: 'embarrassed, sheepish, deflecting, hesitant',
  determined: 'determined, firm, pushing, deliberate',
  worried: 'worried, soft, uncertain, strained',
  shy: 'Shy and flustered, hesitant and quiet, her voice dropping as she tries to hide it.',
  seductive: 'seductive, low, slow, husky',
  teasing: 'teasing, playful, smirking, sing-song',
  sexy: 'sultry, breathy, confident, warm',
  direct: 'Direct and firm, blunt and no-nonsense, short clipped words, completely sure.',
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
  sighs: [],
  webEnabled: true,
  desktopEnabled: true,
};

/**
 * The clip to clone from for this line. A mapping only counts if it actually has
 * a clip — a half-filled row in the settings should fall back rather than send an
 * empty path the server will reject.
 */
export function referenceFor(config: VoiceConfig, emotion?: EmotionName | null): VoiceReference {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.reference',[config,emotion??null]);
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
// Breeze is eager and local: ~3x slower than realtime on a 3060, so a long
// chunk can need a minute. The desk retries timeouts once, so a too-short
// ceiling doubles the wait instead of saving it.
const BREEZE_TIMEOUT_MS = 90_000;

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
  'HDMI', 'MIA', 'XAI', 'GB', 'TB', 'MB', 'LLM',
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
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.spokenCase',[text]);
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
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.hasShout',[text]);
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
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.shoutReference',[config,fallback]);
  if (config.shoutVoice?.clip) return config.shoutVoice;
  const angry = config.emotionVoices.annoyed;
  if (angry?.clip) return angry;
  return fallback;
}

export function speakableText(reply: string): string {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.speakableText',[reply]);
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
/**
 * A sigh or a grunt of hers, for the gap between paragraphs.
 *
 * Cut from the reel he recorded, not synthesised: a model asked to say "ugh"
 * says the word. Louder ones are grunts and go with a mood that has an edge
 * to it — annoyed, smug, determined — quieter ones are sighs and go with the
 * flat moods; anything else takes whichever comes. `files` is voice.sighs.
 */
export function pickSigh(files: readonly string[], emotion: string | null | undefined, random: () => number = Math.random): string | null {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on'){const p=corePolicySync<any>('speech-boundary.pickSigh',[files,emotion??null]);return p?.needsRandom?corePolicySync<any>('speech-boundary.pickSigh',[files,emotion??null,random()]):p;}
  const all = files.filter(Boolean);
  if (!all.length) return null;
  const grunts = all.filter(file => /grunt|hmph|loud/i.test(file));
  const sighs = all.filter(file => !/grunt|hmph|loud/i.test(file));
  const edge = emotion === 'annoyed' || emotion === 'smug' || emotion === 'determined' || emotion === 'surprised';
  const flat = emotion === 'sleepy' || emotion === 'bored' || emotion === 'worried' || emotion === 'neutral';
  const pool = edge && grunts.length ? grunts : flat && sighs.length ? sighs : all;
  return pool[Math.floor(random() * pool.length) % pool.length] ?? null;
}

export function splitForSpeech(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.splitForSpeech',[text,maxChars]);
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

/**
 * Sentences cut out of a reply as it streams in, so her voice can start on the
 * first one while the model is still writing the rest.
 *
 * A sentence is a run ending in a terminator that is followed by whitespace —
 * and nothing else. A terminator at the very end of the buffer is left in
 * `rest` because it may be gaining more ("it's 2." is a decimal until "50"
 * arrives), and the caller flushes what is left when the stream ends: the
 * reply's final sentence arrives without the space the splitter waits for.
 * Emoji between sentences keep the splitter honest: the engine is given the
 * sentence raw, and speakableText strips them at /api/speak.
 */
export function streamedSentences(buffer: string): { sentences: string[]; rest: string } {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.streamedSentences',[buffer]);
  const sentences: string[] = [];
  let rest = buffer ?? '';
  // /s: a paragraph break must not freeze the cut — a sentence ending in the
  // paragraph before it is still a sentence, and her replies change paragraphs.
  const re = /^.*?[.!?…]+\s/s;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest))) {
    const sentence = match[0].trim();
    rest = rest.slice(match[0].length);
    if (/[\p{Letter}\p{Number}]/u.test(sentence)) sentences.push(sentence);
  }
  return { sentences, rest };
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
export function isSilent(bytes: Uint8Array): boolean {
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
 * speaks itself, so callers can treat every engine the same way. `emotion` is
 * what the clip-based engines select on and what Hume steers delivery with;
 * the other engines ignore it.
 */
export function planVoice(config: VoiceConfig, reference: VoiceReference, emotion?: EmotionName | null): { config: VoiceConfig; reference: VoiceReference; plan: DeliveryPlan } {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.planVoice',[config,reference,emotion??null,voiceSense.plan(emotion??'neutral')]);
  const plan = voiceSense.plan(emotion ?? 'neutral');
  const expressive = config.engine === 'breeze' || config.engine === 'hume';
  const directions = config.engine === 'breeze' ? BREEZE_DESCRIPTIONS : HUME_DESCRIPTIONS;
  const chosen = plan.emotion !== (emotion ?? 'neutral') ? referenceFor(config, plan.emotion) : reference;
  const applied = { ...config, speed: Math.max(0.5, Math.min(2, config.speed * plan.speedScale)), ...(expressive && plan.instruction ? { deliveryInstruction: plan.instruction } : {}) };
  return { config: applied, reference: chosen, plan: { ...plan, instruction: expressive ? plan.instruction || directions[plan.emotion] : 'reference voice and playback speed; free-form acting directions are unsupported by this engine' } };
}

export async function synthesise(text: string, config: VoiceConfig, reference: VoiceReference = referenceFor(config), auth: Record<string, string> = {}, emotion?: EmotionName | null): Promise<{ audio: Uint8Array; mime: string } | null> {
  const planned = planVoice(config, reference, emotion);
  const clip = await synthesisePlanned(text, planned.config, planned.reference, auth, planned.plan.emotion);
  if (clip) voiceSense.generated(text, planned.plan, config.engine, clip.audio, clip.mime);
  return clip;
}

async function synthesisePlanned(text: string, config: VoiceConfig, reference: VoiceReference, auth: Record<string, string>, emotion?: EmotionName | null): Promise<{ audio: Uint8Array; mime: string } | null> {
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
      return post(`${endpoint}/tts`, sovitsRequest(config, reference, text), auth);
    // Hume Octave, with a cloned voice. The reference clips mean nothing here —
    // the voice is one clone and the mood is acting directions in the request.
    case 'hume': {
      const key = auth['X-Hume-Api-Key'];
      if (!key) throw new Error('Hume is selected but no Hume API key is saved.');
      if (!config.voice) throw new Error('Hume is selected but no Hume voice is saved.');
      const directions = config.deliveryInstruction || [emotion ? HUME_DESCRIPTIONS[emotion] : '', hasShout(text) ? 'loud, shouting' : ''].filter(Boolean).join(', ');
      const response = await net.fetch(HUME_TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hume-Api-Key': key },
        body: JSON.stringify({
          utterances: [{
            text,
            voice: { id: config.voice },
            ...(directions ? { description: directions } : {}),
            ...(config.speed !== 1 ? { speed: config.speed } : {}),
          }],
          format: { type: 'wav' },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
      }
      const audio = new Uint8Array(await response.arrayBuffer());
      if (isSilent(audio)) throw new Error('the server returned silence — inference probably failed part-way.');
      return { audio, mime: 'audio/wav' };
    }
    // Breeze TTS 2, self-hosted. One reference clip + its exact transcript
    // clones the voice, and the instruction steers delivery the way Hume's
    // description does — the same acting directions, a different engine.
    case 'breeze': {
      if (!reference.clip) throw new Error('Breeze is selected but no reference clip is set.');
      const release = await breezeSlot();
      let pcm: Uint8Array;
      try {
        const response = await postBreeze(config, reference, text, emotion);
        // Breeze streams 24 kHz mono s16le PCM; wrap it in a WAV so the rest of
        // the voice path — silence check, clipping check, playback — can treat it
        // like every other engine's clip.
        pcm = new Uint8Array(await response.arrayBuffer());
      } finally {
        release();
      }
      const audio = pcmToWav(pcm);
      if (isSilent(audio)) throw new Error('the server returned silence — inference probably failed part-way.');
      return { audio, mime: 'audio/wav' };
    }
  }
}

/** The instruction Breeze gets for a line: the mood's acting direction, plus a
 *  shout where the text is one. Shared by the buffered and streaming paths so
 *  the phone and the desk ask for the same delivery. */
function breezeInstruction(text: string, emotion?: EmotionName | null): string {
  const acting = coreIdentity()?.breezeActing ?? BREEZE_DESCRIPTIONS;
  return [emotion ? acting[emotion] : '', hasShout(text) ? 'loud, shouting' : ''].filter(Boolean).join(', ') || 'Speak clearly and naturally.';
}

/** Builds and sends the multipart clone-and-direction request Breeze's API
 *  takes. Returns the raw response so a caller can buffer or stream it. When a
 *  voice has already been encoded on the server (config.voiceId), that id is
 *  sent instead of the clip — the server keeps the encoded voice, so nothing
 *  is re-run and the first audio arrives sooner. */
/**
 * breeze-server holds one model slot and answers a second concurrent request
 * with 409 busy. The desk's loop is serial for it, but the phone's sentence
 * pieces arrive together, and every refused piece was a line she never said.
 * One synthesis at a time, then: a caller takes the slot, and gives it back
 * only once its audio has all come back, since the server is busy for as long
 * as the stream runs. Resolves to the release.
 */
let breezeTurn: Promise<void> = Promise.resolve();
export function breezeSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  let release: () => void = () => {};
  let released = false;
  const mine = new Promise<void>(resolve => { release = () => { if (!released) { released = true; resolve(); } }; });
  const before = breezeTurn;
  breezeTurn = before.then(() => mine);
  if (!signal) return before.then(() => release);
  return new Promise((resolve, reject) => {
    const abort = () => { release(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    before.then(() => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { release(); reject(signal.reason); }
      else resolve(release);
    });
  });
}

/** The stream as it is, and the slot given back when it ends, is cancelled,
 *  or has run past any reasonable synthesis — nobody reading it counts. */
function releasingWhenDone(source: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const timer = setTimeout(release, BREEZE_TIMEOUT_MS + 5_000);
  const done = () => { clearTimeout(timer); release(); };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done: end } = await reader.read();
        if (end) { controller.close(); done(); return; }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        done();
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    },
  });
}

async function postBreeze(config: VoiceConfig, reference: VoiceReference, text: string, emotion?: EmotionName | null, seed?: number, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const form = new FormData();
  form.append('text', text);
  form.append('instruction', config.deliveryInstruction || breezeInstruction(text, emotion));
  const guidance = process.env.HARU_CORE_BREEZE_GUIDANCE === 'on'
    ? corePolicySync<number>('breeze.guidance', [emotion ?? null, text]) : 4;
  if (guidance !== 2 && guidance !== 3 && guidance !== 4) throw new Error('invalid_core_breeze_guidance');
  signal?.throwIfAborted();
  form.append('cfg_scale', String(guidance));
  form.append('ref_text', reference.text || '');
  // Random per line, not the server's fixed 42: a fixed seed gives the same
  // delivery for the same text every time, which is how a voice starts to
  // sound like a recording of itself. Prosody varies run to run instead.
  // A caller that voices a reply in several pieces passes one seed for all
  // of them, so the pieces are takes of the same performance.
  form.append('seed', String(seed ?? Math.floor(Math.random() * 2 ** 31)));
  if (config.voiceId) {
    form.append('voice_id', config.voiceId);
  } else {
    const clip = await readFile(reference.clip);
    form.append('ref_audio', new Blob([clip as unknown as BlobPart], { type: 'audio/wav' }), basename(reference.clip));
  }
  // Breeze takes one request at a time and answers a second with 409. The
  // slot above keeps ours in line, but a line the phone abandoned mid-stream
  // gives the slot back while Breeze is still finishing it — so the next line
  // was refused and, on the phone, silently skipped (55 times on 2026-09-05).
  // A busy Breeze is a Breeze about to be free: wait a little and ask again.
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    const response = await net.fetch(`${trimEndpoint(config.endpoint)}${BREEZE_SPEECH_URL}`, {
      method: 'POST',
      body: form,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(BREEZE_TIMEOUT_MS)]) : AbortSignal.timeout(BREEZE_TIMEOUT_MS),
    });
    if (response.ok) {
      if (attempt) console.log(`[voice] breeze was busy — waited ${Date.now() - started}ms`);
      return response;
    }
    const detail = await response.text().catch(() => '');
    if (response.status === 409 && attempt < BREEZE_BUSY_TRIES) {
      await delay(BREEZE_BUSY_WAIT_MS, undefined, { signal });
      continue;
    }
    throw new Error(`${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

/** How often, and how long apart, a busy Breeze is asked again: about two seconds in all. */
const BREEZE_BUSY_TRIES = 6;
const BREEZE_BUSY_WAIT_MS = 350;

/** Wraps Breeze's 24 kHz s16le PCM stream in a WAV the phone's <audio> element
 *  can play progressively. The data length is unknown while it streams, so the
 *  header declares the WAV-extended "open" length (0xFFFFFFFF) and the stream
 *  simply ends when the connection does. */
export function wrapPcmAsWav(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        const header = new Uint8Array(44);
        const view = new DataView(header.buffer);
        const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) header[offset + i] = text.charCodeAt(i); };
        ascii(0, 'RIFF');
        view.setUint32(4, 0xFFFFFFFF, true);
        ascii(8, 'WAVE');
        ascii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 24000, true);
        view.setUint32(28, 48000, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        ascii(36, 'data');
        view.setUint32(40, 0xFFFFFFFF, true);
        controller.enqueue(header);
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });
}

/** The streaming half of the Breeze door, for the phone's GET /api/speak: the
 *  PCM arrives progressively, and the WAV wrapper keeps the first byte fast. */
export async function synthesiseBreezeStream(config: VoiceConfig, reference: VoiceReference, text: string, emotion?: EmotionName | null, seed?: number, rawPCM = false, signal?: AbortSignal): Promise<{ mime: string; body: ReadableStream<Uint8Array>; sampleRate?: number } | null> {
  const planned = planVoice(config, reference, emotion);
  const release = await breezeSlot(signal);
  try {
    const response = await postBreeze(planned.config, planned.reference, text, planned.plan.emotion, seed, signal);
    if (!response.body) { release(); return null; }
    const observed = voiceSense.stream(text, planned.plan, config.engine, releasingWhenDone(response.body, release), 'audio/wav', pcmToWav);
    return rawPCM ? { mime: 'audio/pcm', sampleRate: 24000, body: observed }
      : { mime: 'audio/wav', body: wrapPcmAsWav(observed) };
  } catch {
    release();
    signal?.throwIfAborted();
    return null;
  }
}

/** Wraps 24 kHz mono s16le PCM in a standard 44-byte WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) header[offset + i] = text.charCodeAt(i); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(header);
  out.set(pcm, 44);
  return out;
}

/** The api_v2 /tts body: reference, its fellows, and the sampling that shapes the take. */
export function sovitsRequest(config: VoiceConfig, reference: VoiceReference, text: string) {
  const sampling = { ...DEFAULT_SAMPLING, ...(config.sampling ?? {}) };
  return {
        text,
        text_lang: config.language,
        ref_audio_path: reference.clip,
        prompt_text: reference.text,
        prompt_lang: config.language,
        aux_ref_audio_paths: (reference.aux ?? []).filter(Boolean),
        media_type: 'wav',
        streaming_mode: false,
        speed_factor: config.speed,
        top_k: sampling.topK,
        top_p: sampling.topP,
        temperature: sampling.temperature,
        repetition_penalty: sampling.repetitionPenalty,
        // The pause between the fragments the server makes of one chunk — with
        // cut0 that is one, so this is the breath at a sentence end inside it.
        fragment_interval: sampling.fragmentInterval,
        // Not cut5, the server's default, which splits on every comma — its
        // punctuation set literally contains "," — so she stopped dead
        // mid-clause: the seam between two takes rather than a pause in her
        // delivery.
        //
        // cut4 splits on sentence ends, which is where a person breathes, and
        // fragment_interval is the length of that breath. It was cut0 — no
        // split at all — back when a chunk was one sentence anyway; now a chunk
        // can be a short paragraph and running its sentences together is what
        // made her sound like someone reading rather than talking.
        text_split_method: 'cut4',
  };
}

/** Reads a stored config forward, so a partial or older record still starts up. */
export function readVoiceConfig(saved: unknown): VoiceConfig {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.readVoiceConfig',[saved??null]);
  if (!saved || typeof saved !== 'object') return DEFAULT_VOICE;
  const record = saved as Partial<VoiceConfig>;
  const engines: VoiceEngine[] = ['off', 'windows', 'openai', 'gpt-sovits', 'hume', 'breeze'];
  return {
    engine: engines.includes(record.engine as VoiceEngine) ? record.engine as VoiceEngine : DEFAULT_VOICE.engine,
    endpoint: typeof record.endpoint === 'string' ? record.endpoint : DEFAULT_VOICE.endpoint,
    voice: typeof record.voice === 'string' ? record.voice : DEFAULT_VOICE.voice,
    referenceText: typeof record.referenceText === 'string' ? record.referenceText : DEFAULT_VOICE.referenceText,
    language: typeof record.language === 'string' ? record.language : DEFAULT_VOICE.language,
    speed: typeof record.speed === 'number' && record.speed > 0 ? Math.min(2, record.speed) : DEFAULT_VOICE.speed,
    volume: typeof record.volume === 'number' ? Math.max(0, Math.min(1, record.volume)) : DEFAULT_VOICE.volume,
    emotionVoices: readEmotionVoices(record.emotionVoices),
    sighs: Array.isArray(record.sighs) ? (record.sighs as unknown[]).filter((file): file is string => typeof file === 'string' && file.trim().length > 0) : [],
    ...(record.sampling && typeof record.sampling === 'object' ? { sampling: readSampling(record.sampling as Record<string, unknown>) } : {}),
    shoutVoice: readReference(record.shoutVoice),
    webEnabled: record.webEnabled !== false,
    desktopEnabled: record.desktopEnabled !== false,
    ...(typeof record.voiceId === 'string' && record.voiceId.trim() ? { voiceId: record.voiceId.trim() } : {}),
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
function readSampling(saved: Record<string, unknown>): Partial<VoiceSampling> {
  const out: Partial<VoiceSampling> = {};
  for (const key of Object.keys(DEFAULT_SAMPLING) as (keyof VoiceSampling)[]) {
    const value = saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function readEmotionVoices(saved: unknown): Partial<Record<EmotionName, VoiceReference>> {
  if (!saved || typeof saved !== 'object') return {};
  const source = saved as Record<string, unknown>;
  const result: Partial<Record<EmotionName, VoiceReference>> = {};
  for (const emotion of EMOTIONS) {
    const entry = source[emotion];
    if (!entry || typeof entry !== 'object') continue;
    const { clip, text } = entry as Partial<VoiceReference>;
    if (typeof clip !== 'string' || !clip.trim()) continue;
    const { aux } = entry as Partial<VoiceReference>;
    result[emotion] = { clip, text: typeof text === 'string' ? text : '', ...(Array.isArray(aux) && aux.some(a => typeof a === 'string' && a.trim()) ? { aux: aux.filter((a): a is string => typeof a === 'string' && a.trim().length > 0) } : {}) };
  }
  return result;
}

/**
 * Whether what came back is too short to be the line she was given.
 *
 * The model ends on its own token, and now and then it ends early: the same
 * hundred-and-forty characters that took nine and a half seconds came back
 * once as two and a half, mid-sentence. Nothing in the request says so and
 * nothing errors — the clip is simply short. Measured across her own renders
 * she speaks at about fifteen characters a second, so anything under half of
 * what the text needs was cut off rather than said.
 *
 * PCM only, which is what the wav these servers return always is: bytes after
 * the 44-byte header, over the rate times the width. The rate is read from the
 * header rather than assumed — GPT-SoVITS is 32 kHz and Breeze 24 kHz, and a
 * wrongly assumed rate makes a full clip look cut short.
 */
export const SPOKEN_CHARS_PER_SECOND = 15;
export function looksClipped(audio: Uint8Array, text: string, rate = 32000, bytesPerSample = 2): boolean {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.clipped',[{length:audio.length,rate:wavSampleRate(audio)},text,rate,bytesPerSample]);
  const said = (text ?? '').replace(/\s+/g, ' ').trim();
  // Too short to judge: a two-word answer has no reliable length.
  if (said.length < 40 || audio.length <= 44) return false;
  const headerRate = wavSampleRate(audio);
  const actualRate = headerRate || rate;
  const seconds = (audio.length - 44) / (actualRate * bytesPerSample);
  return seconds < (said.length / SPOKEN_CHARS_PER_SECOND) * 0.5;
}

/** The sample rate in a WAV's fmt chunk, or 0 when this is not a WAV it knows. */
function wavSampleRate(audio: Uint8Array): number {
  if (audio.length < 44) return 0;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const riff = view.getUint32(0, false);
  if (riff !== 0x52494646) return 0; // 'RIFF'
  return view.getUint32(24, true);
}
