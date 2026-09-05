// A call handled at home: her own ears, her own brain, her own voice.
//
// The phone's microphone arrives as frames; the detector in vad.ts decides
// where what they said begins and ends; the utterance goes to her ears
// (whisper, with the corrections she has been taught); the words go to the
// same brain a typed message reaches; and each sentence of the reply is voiced
// the moment it is complete, streamed down to the phone while the next one is
// still being written. She starts talking at her first sentence, not her last
// — which is the difference from the Hume engine, where nothing is said until
// the whole reply is in. While a tool runs she says one of the fillers in
// call.ts, because a search is seconds of silence otherwise.
//
// Talking over her: speech that starts while her voice is going out is an
// interruption — her queue is dropped, the phone is told to hush, and the
// next turn is told she was cut off, exactly as the phone's own talk mode
// does. Nothing here touches the transcript: the brain's own path writes the
// exchange into the day, the way it does for every message.
//
// Time inside the detector is sample time, counted from the frames, so a test
// can feed a call without a clock; the phone's clock only decides how long a
// call ran.

import { makeVad, pcm16Level, type VadOptions } from './vad';
import { pcmToWav } from './voice';
import { looksUnfinished } from './call';

/** The phone's rate; what its ear already makes. */
export const CALL_RATE = 16_000;
/** Her voice's rate off the local engine, when the engine does not say. */
export const VOICE_RATE = 24_000;
/** How much of the microphone is kept, so an utterance can be cut out whole. */
const RING_SECONDS = 20;
/** After her voice stops, how long the detector stays wary of an echo of it. */
const HER_ECHO_MS = 500;
/** While she is audible, how much louder than the room they must be to count. */
const OVER_HER_RATIO = 7;
/** How long a sentence that reads as unfinished waits for its other half. */
export const UNFINISHED_HOLD_MS = 700;

export type CallEvent = Record<string, unknown>;

export type LocalCallDeps = {
  /** Words for one utterance, as WAV bytes — the phone's ear: transcription, the taught corrections, the hallucination filter. '' when nothing worth sending. */
  hear(wav: Uint8Array): Promise<string>;
  /**
   * Her reply. Sentences arrive as they complete, with the mood read from the
   * line so far; a tool round announces itself as it starts. Resolves with the
   * reply that settled, which the brain has already written into the day.
   */
  answer(text: string, options: { interrupted: boolean; onSentence(sentence: string, emotion: string): void; onToolCall(name: string): void }): Promise<{ reply: string; ignored?: boolean }>;
  /** Her voice for a line: a stream of mono PCM16 with no header, and its rate. Null when she has no voice to give. */
  speak(text: string, emotion: string | null): Promise<{ stream: ReadableStream<Uint8Array>; sampleRate: number } | null>;
  /** A line to say while a tool runs. */
  filler(): string;
  vad?: Partial<VadOptions>;
  /** Wall clock, for the call's length. */
  now?(): number;
  log?(line: string): void;
};

export type LocalCallHandlers = {
  onEvent(event: CallEvent): void;
  /** A stretch of her voice: 24 kHz mono PCM16, after an audio_start and before its audio_end. */
  onAudio(pcm: Uint8Array): void;
  onClose(reason: string, seconds: number): void;
};

export type LocalCall = {
  /** A frame of the phone's microphone: 16 kHz mono PCM16. */
  feed(frame: Uint8Array): void;
  /** The phone says whether she is audible through its speaker right now. */
  herSpeaking(on: boolean): void;
  close(reason?: string): void;
};

type Line = { text: string; emotion: string | null; filler: boolean };

/** The sample rate a WAV header declares, or 0 when the bytes are not a WAV. */
export function wavSampleRate(bytes: Uint8Array): number {
  if (bytes.byteLength < 44 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RIFF') return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(24, true);
}

/** A WAV stream with its 44-byte header taken off: the PCM the phone plays. */
export function withoutWavHeader(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let skipped = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (skipped >= 44) { controller.enqueue(chunk); return; }
      const take = Math.min(44 - skipped, chunk.byteLength);
      skipped += take;
      if (chunk.byteLength > take) controller.enqueue(chunk.subarray(take));
    },
  }));
}

/** One buffer as a stream, for a voice that only renders whole. */
export function oneChunk(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { if (bytes.byteLength) controller.enqueue(bytes); controller.close(); } });
}

export function openLocalCall(handlers: LocalCallHandlers, deps: LocalCallDeps): LocalCall {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const startedAt = now();
  const vad = makeVad(deps.vad);
  const ring: { at: number; frame: Uint8Array }[] = [];
  let ringSamples = 0;
  let samples = 0;                // sample time, in samples since the call began
  let closed = false;
  let phoneHearsHer = false;
  let sending = false;            // her voice is going down the socket
  let herEchoUntil = 0;           // wall clock; after her voice, the detector stays wary
  let interrupted = false;        // she was cut off; the next turn is told
  let thinking = false;           // the brain is on a turn
  let generation = 0;             // bumps on every interruption: stale audio is dropped
  let queue: Line[] = [];
  let pumping = false;
  let spokeThisTurn = false;
  let fillerThisTurn = false;
  let turnDone: (() => void) | null = null;
  let lineId = 0;
  let turns = 0;
  let lastEmotion: string | null = null;  // the mood of her last line, for the phone's face
  // Words heard but not yet answered: a breath in the middle of a sentence
  // reads to the detector as its end. What was said before the breath waits
  // here for what comes after it, and the two go to her brain as one.
  let pending = '';
  let holdUntil = 0;              // sample time; a held fragment is answered alone once this passes in quiet
  let transcribing = 0;           // utterances at her ears right now; a held fragment waits for them

  const emit = (event: CallEvent) => { if (!closed) handlers.onEvent(event); };
  const hers = () => phoneHearsHer || sending || now() < herEchoUntil;

  // -- the microphone ----------------------------------------------------------------

  function feed(frame: Uint8Array) {
    if (closed || !frame.byteLength) return;
    const at = samples;
    samples += frame.byteLength >> 1;
    ring.push({ at, frame });
    ringSamples += frame.byteLength >> 1;
    while (ringSamples > CALL_RATE * RING_SECONDS && ring.length) ringSamples -= ring.shift()!.frame.byteLength >> 1;
    const t = (samples * 1000) / CALL_RATE;
    const event = vad.feed(pcm16Level(frame), t, hers() ? OVER_HER_RATIO : undefined);
    if (pending && holdUntil && !transcribing && !vad.speaking() && t >= holdUntil && !event) {
      // Nothing more came: the half they said is the whole of it.
      const text = pending;
      pending = '';
      holdUntil = 0;
      commit(text);
    }
    if (!event) return;
    if (event.type === 'start') { spokeOver(); return; }
    if (event.type === 'drop') return;
    void heard(cut(event.from, event.to));
  }

  /** The frames between two sample-times, as one WAV for her ears. */
  function cut(fromMs: number, toMs: number): Uint8Array {
    const from = Math.floor((fromMs * CALL_RATE) / 1000);
    const to = Math.ceil((toMs * CALL_RATE) / 1000);
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const { at, frame } of ring) {
      const end = at + (frame.byteLength >> 1);
      if (end <= from || at >= to) continue;
      const head = Math.max(0, from - at) * 2;
      const tail = Math.min(frame.byteLength, (to - at) * 2);
      const piece = frame.subarray(head, tail);
      parts.push(piece);
      total += piece.byteLength;
    }
    const pcm = new Uint8Array(total);
    let offset = 0;
    for (const piece of parts) { pcm.set(piece, offset); offset += piece.byteLength; }
    return pcmToWav(pcm, CALL_RATE);
  }

  /** They started talking. Over her, that is an interruption; over her thinking, the reply will not be voiced. */
  function spokeOver() {
    if (sending || queue.length || (thinking && spokeThisTurn)) {
      interrupted = true;
      dropHerVoice();
      emit({ type: 'user_interruption' });
      finishTurn();
      log('[call] talked over her');
    } else if (thinking) {
      // Nothing of hers has gone out yet: the reply on its way is not spoken,
      // and what they are saying now is the turn that counts.
      generation++;
      queue = [];
      log('[call] they spoke before she could');
    }
  }

  function dropHerVoice() {
    generation++;
    queue = [];
    sending = false;
    herEchoUntil = now() + HER_ECHO_MS;
  }

  // -- a turn --------------------------------------------------------------------------

  async function heard(wav: Uint8Array) {
    let text = '';
    transcribing++;
    try { text = await deps.hear(wav); } catch (error) { log(`[call] her ears failed: ${error instanceof Error ? error.message : String(error)}`); return; } finally { transcribing--; }
    if (closed) return;
    if (!text) { log('[call] heard nothing worth answering'); return; }
    text = pending ? `${pending} ${text}` : text;
    pending = '';
    holdUntil = 0;
    // They went on talking while this was being written down: what they are
    // saying now belongs with it, and she answers the whole once it has ended.
    if (vad.speaking()) { pending = text; log(`[call] holding "${text.slice(0, 40)}" — they are still talking`); return; }
    // A sentence they stopped in the middle of waits a moment for its end.
    if (looksUnfinished(text)) {
      pending = text;
      holdUntil = (samples * 1000) / CALL_RATE + UNFINISHED_HOLD_MS;
      log(`[call] holding "${text.slice(0, 40)}" — it sounds unfinished`);
      return;
    }
    commit(text);
  }

  function commit(text: string) {
    emit({ type: 'user_message', text, interim: false });
    if (thinking) {
      // Two things said before she could answer the first: the second is the
      // one she answers. The first turn finishes on its own, unvoiced.
      generation++;
      queue = [];
    }
    void turn(text);
  }

  async function turn(text: string) {
    const mine = ++turns;
    const wasInterrupted = interrupted;
    interrupted = false;
    thinking = true;
    spokeThisTurn = false;
    fillerThisTurn = false;
    const myGeneration = generation;
    const started = now();
    let firstVoiceAt = 0;
    try {
      const answer = await deps.answer(text, {
        interrupted: wasInterrupted,
        onSentence: (sentence, emotion) => {
          if (generation !== myGeneration || turns !== mine) return;
          lastEmotion = emotion;
          say({ text: sentence, emotion, filler: false });
        },
        onToolCall: name => {
          if (generation !== myGeneration || turns !== mine || fillerThisTurn || spokeThisTurn) return;
          fillerThisTurn = true;
          log(`[call] a tool is running (${name}) — she says something meanwhile`);
          say({ text: deps.filler(), emotion: null, filler: true });
        },
      });
      if (turns !== mine) return;
      if (answer.ignored) log('[call] she is not answering that');
    } catch (error) {
      log(`[call] her brain failed: ${error instanceof Error ? error.message : String(error)}`);
      emit({ type: 'error', message: 'She lost her train of thought.' });
    } finally {
      if (turns === mine) {
        thinking = false;
        // The turn is over once every queued line has been voiced.
        await new Promise<void>(resolve => { if (!queue.length && !pumping) resolve(); else turnDone = resolve; });
        if (turns === mine && !closed) {
          // The face goes with the end of the turn, read off her last line, so
          // the phone need not ask a model — that one shares the card with her voice.
          emit({ type: 'assistant_end', ...(lastEmotion ? { emotion: lastEmotion } : {}) });
          log(`[call] turn ${mine}: ${firstVoiceAt ? `first voice at ${firstVoiceAt - started}ms, ` : 'nothing voiced, '}done in ${now() - started}ms`);
        }
      }
    }
    function say(line: Line) {
      if (!firstVoiceAt) firstVoiceAt = now();
      queue.push(line);
      void pump();
    }
  }

  function finishTurn() {
    const done = turnDone;
    turnDone = null;
    done?.();
  }

  // -- her voice --------------------------------------------------------------------

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && !closed) {
        const line = queue.shift()!;
        const myGeneration = generation;
        emit(line.filler ? { type: 'filler', text: line.text } : { type: 'assistant_message', text: line.text, id: String(++lineId) });
        if (!line.filler) spokeThisTurn = true;
        let voice: { stream: ReadableStream<Uint8Array>; sampleRate: number } | null = null;
        try { voice = await deps.speak(line.text, line.emotion); } catch (error) { log(`[call] her voice failed: ${error instanceof Error ? error.message : String(error)}`); }
        if (!voice || generation !== myGeneration || closed) { if (voice) void voice.stream.cancel().catch(() => {}); continue; }
        const id = String(lineId);
        emit({ type: 'audio_start', id, sampleRate: voice.sampleRate || VOICE_RATE });
        sending = true;
        const reader = voice.stream.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (generation !== myGeneration || closed) { await reader.cancel().catch(() => {}); break; }
            if (value?.byteLength) handlers.onAudio(value);
          }
        } catch (error) {
          log(`[call] her voice broke off: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (generation === myGeneration) { sending = false; herEchoUntil = now() + HER_ECHO_MS; emit({ type: 'audio_end', id }); }
      }
    } finally {
      pumping = false;
      if (!queue.length) finishTurn();
    }
  }

  return {
    feed,
    herSpeaking(on) {
      phoneHearsHer = on;
      if (!on) herEchoUntil = now() + HER_ECHO_MS;
    },
    close(reason = 'hung up') {
      if (closed) return;
      closed = true;
      dropHerVoice();
      finishTurn();
      handlers.onClose(reason, Math.round((now() - startedAt) / 1000));
    },
  };
}
