// A call handled at home, driven with fakes: frames in, events and her voice
// out. Sample time runs off the frames, so the tests need no clock beyond a
// counter for the call's length.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalCall, wavSampleRate, withoutWavHeader, oneChunk, CALL_RATE, type CallEvent, type LocalCallDeps } from '../electron/localcall';
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
  return { call, events, audio, closes, heard, answered, spoken, voices, feed, types, advance: (ms: number) => { clock += ms; } };
}

test('an utterance is heard, answered, and voiced a sentence at a time', async () => {
  const h = harness();
  h.feed(0.002, 2000);                 // the room
  h.feed(0.3, 900);                    // them
  h.feed(0.002, 700);                  // quiet ends it
  await settle(60);
  assert.equal(h.heard.length, 1, 'one utterance reached her ears');
  // Roughly the spoken stretch plus the pre-roll and the tail, as 16 kHz WAV.
  assert.ok(h.heard[0] > 44 + CALL_RATE * 2 * 0.9 && h.heard[0] < 44 + CALL_RATE * 2 * 1.6, `the cut is ${h.heard[0]} bytes`);
  assert.deepEqual(h.answered, [{ text: 'What did you say?', interrupted: false }]);
  assert.deepEqual(h.types(), [
    'user_message',
    'assistant_message', 'audio_start', 'audio_end',
    'assistant_message', 'audio_start', 'audio_end',
    'assistant_end',
  ]);
  assert.equal(h.audio.length, 6, 'three chunks per line went down');
  assert.equal((h.events.at(-1) as { emotion?: string }).emotion, 'annoyed', 'the face at the end is the mood the reply was said in');
  assert.equal((h.events[1] as { text: string }).text, 'First thing.');
  assert.deepEqual(h.spoken.map(s => s.emotion), ['annoyed', 'annoyed'], 'one register for the whole reply, not a mood per sentence');
  assert.equal(h.spoken[0].seed, h.spoken[1].seed, 'one take: the same seed for every piece');
  assert.equal((h.events[2] as { sampleRate: number }).sampleRate, 24000);
});

test('a breath mid-sentence does not split what they said: the first half waits for the second', async () => {
  const heardTexts = ['Hey, quick question.', 'is it going to rain tomorrow?'];
  let release: (() => void) | null = null;
  const h = harness({
    // The first transcription is slow enough that they have started talking again by the time it lands.
    hear: async () => { const text = heardTexts.shift() ?? ''; if (text.startsWith('Hey')) await new Promise<void>(resolve => { release = resolve; }); return text; },
  });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 700);   // "Hey, quick question." — its transcription hangs
  await settle(5);
  h.feed(0.3, 400);                                             // …and they go on
  release!();
  await settle(10);
  assert.equal(h.answered.length, 0, 'the first half is held, not answered');
  assert.deepEqual(h.types(), [], 'nothing shown yet either');
  h.feed(0.3, 600); h.feed(0.002, 700);                         // the second half ends
  await settle(60);
  assert.deepEqual(h.answered.map(a => a.text), ['Hey, quick question. is it going to rain tomorrow?']);
  assert.equal((h.events[0] as { text: string }).text, 'Hey, quick question. is it going to rain tomorrow?');
  assert.equal(h.types().filter(t => t === 'user_message').length, 1);
});

test('a half sentence waits for its other half, and a finished one does not', async () => {
  const texts = ['The weather gonna be like in Perth tomorrow', 'Is it going to rain?'];
  const h = harness({ hear: async () => texts.shift() ?? '' });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 700);   // the first half, no full stop
  await settle(10);
  assert.equal(h.answered.length, 0, 'held: it sounds unfinished');
  h.feed(0.002, 200);                                            // a breath, shorter than the hold
  h.feed(0.3, 600); h.feed(0.002, 700);                          // the other half
  await settle(60);
  assert.deepEqual(h.answered.map(a => a.text), ['The weather gonna be like in Perth tomorrow Is it going to rain?']);
  assert.equal(h.types().filter(t => t === 'user_message').length, 1);
});

test('a half sentence with nothing after it is answered once the wait is up', async () => {
  const h = harness({ hear: async () => 'so anyway I was thinking about the' });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 700);
  await settle(10);
  assert.equal(h.answered.length, 0);
  h.feed(0.002, 900);                                            // quiet past the hold
  await settle(40);
  assert.deepEqual(h.answered.map(a => a.text), ['so anyway I was thinking about the']);
});

test('what reads as unfinished', () => {
  for (const text of ['Hey, quick quest-', 'The weather gonna be like in purse tomorrow', 'so I was thinking about the', 'so I was thinking about the.', 'um', 'and then', 'Perth,', 'what I mean is…']) assert.equal(looksUnfinished(text), true, text);
  for (const text of ['Is it going to rain?', 'Hey, quick question.', 'Stop it!', 'It is not some crummy little league game, you are aware of that? Fine, whatever.', 'Fine.', 'okay never mind that one "thing".']) assert.equal(looksUnfinished(text), false, text);
  assert.equal(looksUnfinished(''), false);
});

test('the first sentence goes out at once; the rest of the reply is said in stretches', async () => {
  const h = harness({
    answer: async (_text, options) => {
      // Sentences arrive without their trailing space, as the streamer hands them.
      const parts = ['One.', 'Two, which is a bit longer.', 'Three.', '\n\nFour, after a paragraph.', 'Five.'];
      for (const part of parts) { await tick(); options.onSentence(part, 'smug'); }
      return { reply: parts.join(' ') };
    },
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(80);
  assert.deepEqual(h.spoken.map(s => s.text), ['One.', 'Two, which is a bit longer. Three.', 'Four, after a paragraph. Five.']);
  assert.equal(new Set(h.spoken.map(s => s.seed)).size, 1);
  assert.deepEqual(h.spoken.map(s => s.emotion), ['smug', 'smug', 'smug'], 'the first sentence names the register; her resting mood only when it reads as nothing');
  assert.equal((h.events.at(-1) as { emotion?: string }).emotion, 'smug');
  assert.equal(h.types().at(-1), 'assistant_end');
});

test('nothing worth answering is nothing said', async () => {
  const h = harness({ hear: async () => '' });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  assert.deepEqual(h.types(), []);
  assert.equal(h.answered.length, 0);
});

test('a bump too short for words never reaches her ears', async () => {
  const h = harness();
  h.feed(0.002, 2000); h.feed(0.3, 200); h.feed(0.002, 700);
  await settle(30);
  assert.equal(h.heard.length, 0);
});

test('while a tool runs she says a filler, before any sentence', async () => {
  const h = harness({
    answer: async (_text, options) => {
      await tick();
      options.onToolCall('search_web');
      options.onToolCall('read_web_page');
      await settle(10);
      options.onSentence('Found it.', 'happy');
      return { reply: 'Found it.' };
    },
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(60);
  assert.deepEqual(h.types(), ['user_message', 'filler', 'audio_start', 'audio_end', 'assistant_message', 'audio_start', 'audio_end', 'assistant_end']);
  assert.equal((h.events[1] as { text: string }).text, 'Hang on.');
  assert.equal(h.events.filter(e => e.type === 'filler').length, 1, 'one filler a turn, however many tools');
});

test('talking over her drops her voice, tells the phone, and the next turn knows', async () => {
  let release: (() => void) | null = null;
  const answers: { text: string; interrupted: boolean }[] = [];
  const h = harness({
    answer: async (text, options) => {
      answers.push({ text, interrupted: options.interrupted });
      if (text === 'First thing.') {
        options.onSentence('A long line she never finishes.', 'neutral');
        await new Promise<void>(resolve => { release = resolve; });
        return { reply: 'A long line she never finishes.' };
      }
      options.onSentence('Fine, what.', 'annoyed');
      return { reply: 'Fine, what.' };
    },
    hear: async () => (answers.length ? 'Second thing, stop.' : 'First thing.'),
    // The line she is cut off in goes on and on; her answer to the interruption is short.
    speak: async text => { const v = voice(text.startsWith('A long') ? 200 : 3); h.voices.push(v); return { stream: v.stream, sampleRate: 24000 }; },
    moodNow: () => null,
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  assert.ok(h.audio.length > 0, 'her voice is going out');
  assert.deepEqual(h.types().slice(0, 3), ['user_message', 'assistant_message', 'audio_start']);
  // Over her: louder than the room by more than the raised ratio.
  h.feed(0.5, 600);
  await settle(10);
  assert.ok(h.types().includes('user_interruption'), 'the phone is told to hush');
  assert.ok(h.voices[0].cancelled(), 'the stream of her voice is cancelled');
  const sentBefore = h.audio.length;
  await settle(10);
  assert.equal(h.audio.length, sentBefore, 'no more of that line goes down');
  h.feed(0.002, 700);
  release!();
  await settle(60);
  assert.deepEqual(answers.map(a => a.interrupted), [false, true], 'the next turn is told she was cut off');
  assert.equal(h.types().at(-1), 'assistant_end');
});

test('hanging up cancels her voice and reports the call\'s length', async () => {
  const h = harness({ speak: async () => { const v = voice(500); h.voices.push(v); return { stream: v.stream, sampleRate: 24000 }; } });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(20);
  h.advance(30_000);
  h.call.close('the phone hung up');
  await settle(10);
  assert.deepEqual(h.closes, [['the phone hung up', 33]]);
  assert.ok(h.voices[0].cancelled());
  h.feed(0.3, 600);
  assert.equal(h.heard.length, 1, 'nothing is heard after the close');
});

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

test('the call config reads forward, and the fillers rotate', () => {
  assert.deepEqual(readCallConfig(undefined), DEFAULT_CALL);
  assert.equal(readCallConfig({ engine: 'local', endAfterMs: 400 }).engine, 'local');
  assert.equal(readCallConfig({ engine: 'local', endAfterMs: 400 }).endAfterMs, 400);
  assert.equal(readCallConfig({ engine: 'nope', endAfterMs: 5 }).engine, 'hume');
  assert.equal(readCallConfig({ endAfterMs: 5 }).endAfterMs, 200, 'clamped');
  assert.equal(pickFiller(0), FILLERS[0]);
  assert.equal(pickFiller(0.999), FILLERS[FILLERS.length - 1]);
  assert.notEqual(pickFiller(0, FILLERS[0]), FILLERS[0], 'not the one said last time');
});
