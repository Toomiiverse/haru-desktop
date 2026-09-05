// Speech to speech — her ears and her voice on one socket, her words her own.
//
// The phone's talk mode is a relay race with a baton drop at every hand-off:
// the recording closes, the words come back, the reply is written, each
// sentence is rendered, and all of it waits on the step before. Hume's EVI does
// the listening, the deciding-when-you-have-finished, the being-talked-over and
// the saying, as one stream in her own cloned voice. What it does not do is
// think for her. Her replies still come from the same place the phone's typed
// messages go — memory, tools, mood, the filters — reached through EVI's
// "custom language model" hook: EVI posts what it heard, this side streams
// back what she says, EVI speaks it.
//
// This file is the pure part: the config, the session settings, the shape of
// what EVI sends to the hook and what the hook sends back, and the small
// translation between EVI's socket and the phone's. The socket itself lives in
// evibridge.ts; the routes in webserver.ts; the brain in main.ts.
//
// Speech to speech is a call, not a setting: it runs only while the mic is on.
// Typed messages keep their own voice engine. Nothing here touches that path.

export type EviConfig = {
  enabled: boolean;
  /** The EVI configuration on Hume's side — her voice, the hook's URL, the timeouts. */
  configId: string;
  /** Where Hume reaches the brain hook. Public, by necessity; see the bearer below. */
  publicUrl: string;
  /** The cloned voice the config speaks with, kept here so a rebuild can check it. */
  voiceId: string;
  /** Calls cost by the minute. A forgotten open mic must not run all night. */
  dailyMinutesCap: number;
};

export const DEFAULT_EVI: EviConfig = { enabled: false, configId: '', publicUrl: '', voiceId: '', dailyMinutesCap: 60 };

/** The Haru clone, as Hume knows it. Cloned from her dub clips on 2026-09-04. */
export const HARU_CLONE_VOICE = 'c84f5efd-f6ab-40d4-9a47-23f27cfaa524';

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Reads a stored config forward, so a partial or older record still starts up. */
export function readEviConfig(saved: unknown): EviConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_EVI;
  const record = saved as Partial<EviConfig>;
  const cap = typeof record.dailyMinutesCap === 'number' && Number.isFinite(record.dailyMinutesCap) ? Math.max(0, Math.floor(record.dailyMinutesCap)) : DEFAULT_EVI.dailyMinutesCap;
  return {
    enabled: record.enabled === true,
    configId: str(record.configId),
    publicUrl: str(record.publicUrl),
    voiceId: str(record.voiceId) || DEFAULT_EVI.voiceId,
    dailyMinutesCap: cap,
  };
}

// -- the socket to Hume ----------------------------------------------------------

/** What the phone sends: 16 kHz mono PCM16, the format its own ear already makes. */
export const EVI_AUDIO = { encoding: 'linear16', sample_rate: 16000, channels: 1 } as const;

/**
 * The first message on the socket. The session id is how the hook later knows
 * which call a request belongs to; the key is the bearer Hume presents at the
 * hook, so a request from anyone else is refused before a byte is read.
 */
export function sessionSettingsFor(sessionId: string, secret: string) {
  return {
    type: 'session_settings',
    custom_session_id: sessionId,
    audio: { ...EVI_AUDIO },
    language_model_api_key: secret,
  };
}

/**
 * A session names its device so the hook can tell whose call it is answering.
 * The nonce is the caller's — this file makes nothing random.
 */
export function newSessionId(deviceId: string, nonce: string): string {
  return `${deviceId.replace(/[^A-Za-z0-9_-]/g, '')}.${nonce.replace(/[^A-Za-z0-9]/g, '')}`;
}

export function deviceFromSession(sessionId: string): string {
  const at = sessionId.lastIndexOf('.');
  return at < 0 ? sessionId : sessionId.slice(0, at);
}

/** One stretch of the phone's audio, as EVI takes it. */
export function audioInput(pcm: Uint8Array) {
  return { type: 'audio_input', data: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64') };
}

/**
 * EVI's events, reduced to what the phone needs and nothing it does not.
 *
 * The audio comes through untouched — base64 WAV, one message per sentence —
 * because the phone plays it as it is and decoding it here would be work done
 * twice. Everything not listed is EVI's own bookkeeping and stops here.
 */
export function relay(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  const message = e.message as { content?: unknown } | undefined;
  switch (e.type) {
    case 'chat_metadata':
      return { type: 'chat_metadata', chatId: str(e.chat_id), chatGroupId: str(e.chat_group_id) };
    case 'user_message':
      return { type: 'user_message', text: str(message?.content), interim: e.interim === true };
    case 'assistant_message':
      return { type: 'assistant_message', text: str(message?.content), id: str(e.id) };
    case 'audio_output':
      return typeof e.data === 'string' && e.data ? { type: 'audio_output', data: e.data, id: str(e.id), index: typeof e.index === 'number' ? e.index : 0 } : null;
    case 'assistant_end':
      return { type: 'assistant_end' };
    case 'user_interruption':
      return { type: 'user_interruption' };
    case 'error':
      return { type: 'error', message: str(e.message) || 'Hume returned an error.', code: str(e.code), slug: str(e.slug) };
    default:
      return null;
  }
}

// -- the brain hook -----------------------------------------------------------------

export type ClmTurn = {
  /** What EVI heard them say, this turn. */
  text: string;
  /** How they sounded saying it: Hume's expression names → 0..1. Null when EVI sent none. */
  prosody: Record<string, number> | null;
};

/**
 * What EVI posts to the hook, reduced to the one turn that matters.
 *
 * EVI sends the whole conversation as it holds it, OpenAI-shaped, with the
 * prosody of each spoken line beside it. Her own history is kept here and is
 * the fuller one — the day's messages, the memory, the asides — so only the
 * newest thing they said is taken, and the rest is EVI's copy, not hers.
 */
export function clmTurnFrom(body: unknown): ClmTurn | null {
  if (!body || typeof body !== 'object') return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: unknown; content?: unknown; models?: { prosody?: { scores?: unknown } } } | null;
    if (!message || message.role !== 'user') continue;
    const text = withoutExpressionNote(contentText(message.content));
    if (!text) return null;
    const scores = message.models?.prosody?.scores;
    let prosody: Record<string, number> | null = null;
    if (scores && typeof scores === 'object') {
      prosody = {};
      for (const [name, score] of Object.entries(scores as Record<string, unknown>)) {
        if (typeof score === 'number' && Number.isFinite(score)) prosody[name] = score;
      }
      if (!Object.keys(prosody).length) prosody = null;
    }
    return { text, prosody };
  }
  return null;
}

/**
 * EVI writes how they sounded into the words themselves — "… whatever.
 * {extremely contemptuous, quite disappointed}" — for a language model that
 * reads nothing else. Hers reads the scores beside the message instead, so
 * the note comes off: it is not something they said, and it must not be
 * answered as if it were, or written into the day as their words.
 */
export function withoutExpressionNote(text: string): string {
  return text.replace(/\s*\{[^{}]*\}\s*$/, '').trim();
}

/** OpenAI lets content be a string or a list of parts; EVI sends a string, but a list is read too. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('').trim();
  }
  return '';
}

/** One streamed stretch of her reply, in the shape EVI reads: an OpenAI chat completion chunk. */
export function sseChunk(text: string, id: string, created: number): string {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model: 'haru',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
  })}\n\n`;
}

/** The last chunk: nothing more to say. */
export function sseStop(id: string, created: number): string {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model: 'haru',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`;
}

export const SSE_DONE = 'data: [DONE]\n\n';

// -- the cap ---------------------------------------------------------------------------

/** How long the calls have run today, kept beside the config as `evi.usage`. */
export type EviUsage = { day: string; seconds: number };

export function secondsUsedToday(usage: unknown, today: string): number {
  if (!usage || typeof usage !== 'object') return 0;
  const record = usage as Partial<EviUsage>;
  if (record.day !== today || typeof record.seconds !== 'number' || !Number.isFinite(record.seconds)) return 0;
  return Math.max(0, record.seconds);
}

/** The day's total with one more call on it. A new day starts from nothing. */
export function noteUsage(usage: unknown, today: string, seconds: number): EviUsage {
  return { day: today, seconds: secondsUsedToday(usage, today) + Math.max(0, Math.round(seconds)) };
}

/** Whether another call may start. The cap is on starting, not on finishing — a call is not cut mid-sentence. */
export function underCap(usage: unknown, today: string, capMinutes: number): boolean {
  if (capMinutes <= 0) return false;
  return secondsUsedToday(usage, today) < capMinutes * 60;
}
