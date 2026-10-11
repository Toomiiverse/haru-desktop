// A call handled at home, driven with fakes: frames in, events and her voice
// out. Sample time runs off the frames, so the tests need no clock beyond a
// counter for the call's length.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalCall, wavSampleRate, withoutWavHeader, oneChunk, saidOf, CALL_RATE, type CallEvent, type LocalCallDeps } from '../electron/localcall';
import { pcmToWav } from '../electron/voice';
import { readCallConfig, DEFAULT_CALL, pickFiller, FILLERS, looksUnfinished } from '../electron/call';

const FRAME_MS = 40;
const FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;

function frame(level: number): Uint8Array {
  const out = new Int16Array(FRAME_BYTES / 2);
  const amplitude = Math.round(level * 32767);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? amplitude : -amplitude;
  return new Uint8Array(out.buffer);
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(times = 20) { for (let i = 0; i < times; i++) await tick(); }

/** A stream of a few PCM chunks, cancellable, that records whether it was drained. */
function voice(chunks: number, chunkBytes = 480): { stream: ReadableStream<Uint8Array>; cancelled(): boolean } {
  let cancelled = false;
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await tick();
      if (sent >= chunks) { controller.close(); return; }
      sent++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(sent));
    },
    cancel() { cancelled = true; },
  });
  return { stream, cancelled: () => cancelled };
}

type Harness = ReturnType<typeof harness>;
function harness(overrides: Partial<LocalCallDeps> = {}) {
  const events: CallEvent[] = [];
  const audio: number[] = [];
  const closes: [string, number][] = [];
  const heard: number[] = [];
  const answered: { text: string; interrupted: boolean }[] = [];
  const spoken: { text: string; emotion: string | null; seed: number }[] = [];
  const saids: [string, string][] = [];
  const voices: ReturnType<typeof voice>[] = [];
  let clock = 1_000_000;
  const deps: LocalCallDeps = {
    hear: async wav => { heard.push(wav.byteLength); return 'What did you say?'; },
    answer: async (text, options) => {
      answered.push({ text, interrupted: options.interrupted });
      await tick();
      options.onSentence('First thing. ', 'neutral');
      await tick();
      options.onSentence('Second thing.', 'smug');
      return { reply: 'First thing. Second thing.' };
    },
    speak: async (text, emotion, seed) => { spoken.push({ text, emotion, seed }); const v = voice(3); voices.push(v); return { stream: v.stream, sampleRate: 24000 }; },
    filler: () => 'Hang on.',
    moodNow: () => 'annoyed',
    said: (reply, said) => saids.push([reply, said]),
    now: () => clock,
    vad: { endAfterMs: 500 },
    log: () => {},
    ...overrides,
  };
  const call = openLocalCall({
    onEvent: event => events.push(event),
    onAudio: pcm => audio.push(pcm.byteLength),
    onClose: (reason, seconds) => closes.push([reason, seconds]),
  }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { call.feed(frame(level)); clock += FRAME_MS; } };
  const types = () => events.map(event => event.type);
  return { call, events, audio, closes, heard, answered, spoken, voices, saids, feed, types, advance: (ms: number) => { clock += ms; } };
}

test('a bump too short for words never reaches her ears', async () => {
  const h = harness();
  h.feed(0.002, 2000); h.feed(0.3, 200); h.feed(0.002, 700);
  await settle(30);
  assert.equal(h.heard.length, 0);
});

const LONG_LINE = 'A long line she never finishes, about the website and the shop and the graphics card and every other thing they have talked about this week, which goes on and on.';

test('a WAV gives up its rate and its header, and a whole clip streams as one chunk', async () => {
  const pcm = new Uint8Array(200).fill(7);
  const wav = pcmToWav(pcm, 32000);
  assert.equal(wavSampleRate(wav), 32000);
  assert.equal(wavSampleRate(pcm), 0);
  // The header split across chunks is still taken off exactly once.
  const chunks = [wav.subarray(0, 10), wav.subarray(10, 60), wav.subarray(60)];
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } });
  const out: number[] = [];
  const reader = withoutWavHeader(stream).getReader();
  for (;;) { const { value, done } = await reader.read(); if (done) break; out.push(...value); }
  assert.equal(out.length, 200);
  assert.ok(out.every(byte => byte === 7));
  const one = oneChunk(pcm).getReader();
  assert.equal((await one.read()).value?.byteLength, 200);
  assert.equal((await one.read()).done, true);
});
