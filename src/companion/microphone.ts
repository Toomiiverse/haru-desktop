// Getting words out of the microphone and into the box.
//
// Recorded as raw PCM and encoded to WAV here rather than handed to
// MediaRecorder, which would give back webm/opus. Both work, but WAV at 16 kHz
// mono is exactly what a Whisper model wants and needs no decoder on the far
// side — one less thing that can be missing from whichever Python the speech
// server happens to be running under.
//
// Downsampled here too, for the same reason it is worth doing at all: the
// browser captures at 44.1 or 48 kHz, Whisper resamples to 16 kHz regardless,
// and sending three times the bytes over localhost to have them thrown away is
// just latency.

/** What Whisper wants; anything else is resampled on arrival anyway. */
const TARGET_RATE = 16000;

/** Below this there is no sentence in there, only a slipped click. */
export const MIN_SPEECH_MS = 350;

export type Recording = { bytes: Uint8Array; mime: string; ms: number };

export type Recorder = {
  /** Resolves with the recording, or null if it was too short to be speech. */
  stop(): Promise<Recording | null>;
  /** Abandon it — no transcript, and the microphone is released. */
  cancel(): void;
  /** 0..1, for something on screen that shows it is hearing anything at all. */
  level(): number;
};

function downsample(input: Float32Array, from: number, to: number) {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Averaged across the window rather than picked from it: taking one sample
    // per step aliases anything above the new Nyquist straight back down into
    // the speech band as a whistle.
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: string | number, text?: string) => {
    if (typeof offset === 'string') return;
    for (let i = 0; i < (text ?? '').length; i++) view.setUint8(offset + i, (text ?? '').charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);   // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

// --- continuous listening ------------------------------------------------
//
// What the wake word needs, and a different job from the button above: the
// microphone stays open and the audio is cut into utterances, so only the
// stretches where somebody actually spoke are ever transcribed. Silence never
// leaves this file.

/** Speech has to clear the room's own noise by this much to count. */
const TRIGGER_OVER_FLOOR = 3.2;
/** A floor for the trigger, so a silent room cannot make it hair-trigger. */
const MIN_TRIGGER = 0.012;
/** Quiet for this long ends the utterance — roughly the gap between sentences. */
const SILENCE_MS = 700;
/** Kept before the trigger, so the first consonant of "Haru" is not clipped off. */
const PREROLL_MS = 320;
/** Nobody says one thing for this long; past it, cut and transcribe. */
const MAX_UTTERANCE_MS = 15000;
/** Below this it is a cough or a door, not a sentence. */
const MIN_UTTERANCE_MS = 400;

export type Listener = {
  stop(): void;
  /** 0..1, same easing as the recorder's. */
  level(): number;
  /** True while an utterance is being captured, for something on screen. */
  speaking(): boolean;
};

/**
 * Opens the microphone and leaves it open, handing back one clip per utterance.
 *
 * The noise floor is measured continuously rather than fixed: a threshold that
 * works in a quiet room misses every word once a fan is on, and one that works
 * over a fan ignores someone talking quietly. Tracking the floor means the
 * trigger sits a constant distance above whatever the room is doing.
 */
export async function startListening(onUtterance: (clip: Recording) => void): Promise<Listener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const rate = context.sampleRate;
  const frameMs = 4096 / rate * 1000;
  const prerollFrames = Math.ceil(PREROLL_MS / frameMs);

  let floor = 0.02;
  let live = 0;
  let inSpeech = false;
  let quietMs = 0;
  let spokenMs = 0;
  const preroll: Float32Array[] = [];
  let captured: Float32Array[] = [];
  let closed = false;

  function emit() {
    const total = captured.reduce((sum, chunk) => sum + chunk.length, 0);
    const ms = (total / rate) * 1000;
    const chunks = captured;
    captured = [];
    inSpeech = false;
    spokenMs = 0;
    if (ms < MIN_UTTERANCE_MS || !total) return;
    const joined = new Float32Array(total);
    let at = 0;
    for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; }
    onUtterance({ bytes: encodeWav(downsample(joined, rate, TARGET_RATE), TARGET_RATE), mime: 'audio/wav', ms });
  }

  processor.onaudioprocess = event => {
    if (closed) return;
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (const sample of input) sum += sample * sample;
    const rms = Math.sqrt(sum / input.length);
    live = live * 0.7 + rms * 0.3;

    const trigger = Math.max(floor * TRIGGER_OVER_FLOOR, MIN_TRIGGER);
    if (!inSpeech) {
      // Only tracked between utterances, so someone talking does not slowly
      // raise the floor until they are talking beneath it.
      floor = floor * 0.98 + rms * 0.02;
      preroll.push(new Float32Array(input));
      while (preroll.length > prerollFrames) preroll.shift();
      if (rms > trigger) {
        inSpeech = true;
        quietMs = 0;
        spokenMs = 0;
        captured = preroll.splice(0, preroll.length);
      }
      return;
    }

    captured.push(new Float32Array(input));
    spokenMs += frameMs;
    quietMs = rms > trigger * 0.6 ? 0 : quietMs + frameMs;
    if (quietMs >= SILENCE_MS || spokenMs >= MAX_UTTERANCE_MS) emit();
  };

  source.connect(processor);
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(context.destination);

  return {
    level: () => Math.min(1, live * 12),
    speaking: () => inSpeech,
    stop() {
      if (closed) return;
      closed = true;
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

/**
 * Opens the microphone and starts recording. Rejects if permission is refused or
 * there is no input device, which is worth surfacing rather than leaving a
 * button that silently does nothing.
 */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // Her own voice comes out of the same machine, so without cancellation a
      // push-to-talk held while she is talking transcribes her instead.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const meter = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  // Deprecated, and still the only node that works without shipping a separate
  // worklet file — which the packaged build would have to resolve on disk.
  const processor = context.createScriptProcessor(4096, 1, 1);

  const chunks: Float32Array[] = [];
  let total = 0;
  let live = 0;

  processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    total += input.length;
  };

  source.connect(analyser);
  source.connect(processor);
  // ScriptProcessor only runs while connected to the graph. Through a silent
  // gain so the microphone is not fed back out of the speakers.
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(context.destination);

  const startedAt = performance.now();
  let closed = false;

  function release() {
    if (closed) return;
    closed = true;
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  }

  return {
    level() {
      if (closed) return 0;
      analyser.getByteTimeDomainData(meter);
      let peak = 0;
      for (const sample of meter) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      // Eased so a meter built on this does not flicker on every frame.
      live = live * 0.7 + peak * 0.3;
      return Math.min(1, live * 1.8);
    },
    cancel: release,
    async stop() {
      const ms = performance.now() - startedAt;
      const rate = context.sampleRate;
      release();
      if (ms < MIN_SPEECH_MS || !total) return null;
      const joined = new Float32Array(total);
      let at = 0;
      for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; }
      const reduced = downsample(joined, rate, TARGET_RATE);
      return { bytes: encodeWav(reduced, TARGET_RATE), mime: 'audio/wav', ms };
    },
  };
}
