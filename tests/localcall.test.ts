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

test('admitted microphone checks speak without model calls in open, addressed and manual modes',async()=>{
 for(const mode of ['open','addressed','manual'] as const) {
  const text=mode==='addressed'?'Haru, testing one two three.':'Testing one two three.';
  let commits=0;
  const h=harness({inputMode:mode==='open'?'open':'addressed',
   hear:async()=>text,prepareHear:async()=>Object.assign(()=>{commits++;return text;},{text})});
  if(mode==='manual') {h.call.manualInput(true);h.call.inputHeld(true);h.feed(.3,900);h.call.inputHeld(false);}
  else {h.feed(.002,2000);h.feed(.3,900);h.feed(.002,600);}
  await settle();
  assert.equal(h.answered.length,0,mode);
  assert.deepEqual(h.spoken.map(row=>row.text),['Your words came through.'],mode);
  assert.equal(h.events.filter(row=>row.type==='user_message').length,1);
  assert.equal(h.events.filter(row=>row.type==='assistant_message').length,1);
  if(mode!=='open')assert.equal(commits,1);
  h.call.close();await settle();
 }
});

test('microphone diagnostics cannot bypass addressed admission or a released manual gate',async()=>{
 for(const manual of [false,true]) {
  let reads=0,commits=0;
  const h=harness({inputMode:'addressed',prepareHear:async()=>{reads++;return Object.assign(()=>{commits++;return 'Mic check.';},{text:'Mic check.'});}});
  if(manual)h.call.manualInput(true);
  h.feed(.002,2000);h.feed(.3,900);h.feed(.002,1500);await settle();
  assert.equal(commits,0);assert.equal(h.answered.length,0);assert.equal(h.spoken.length,0);
  assert.equal(h.events.some(e=>e.type==='user_message'),false);
  if(manual)assert.equal(reads,0);
  h.call.close();await settle();
 }
});

test('a mixed microphone check and memory request still reaches the answer pipeline',async()=>{
 const text='Haru, mic check, what did I tell you yesterday?';
 const h=harness({inputMode:'addressed',prepareHear:async()=>Object.assign(()=>text,{text})});
 h.feed(.002,2000);h.feed(.3,900);h.feed(.002,700);await settle();
 assert.equal(h.answered.length,1);assert.equal(h.answered[0].text,'mic check, what did I tell you yesterday?');
 assert.equal(h.spoken.some(row=>row.text==='Your words came through.'),false);h.call.close();
});

test('manual input drops even addressed background audio outside a hold and releases one turn immediately',async()=>{
 let commits=0,reads=0;
 const h=harness({inputMode:'addressed',prepareHear:async()=>{reads++;return Object.assign(()=>{commits++;return 'How are you?';},{text:'How are you?'});}});
 h.call.manualInput(true);
 h.feed(.3,1500);await settle();assert.equal(reads,0);
 h.call.inputHeld(true);h.feed(.3,900);h.feed(.002,1200);await settle();assert.equal(h.answered.length,0);
 h.call.inputHeld(false);await settle();
 assert.equal(h.answered.length,1);assert.equal(h.answered[0].text,'How are you?');assert.equal(commits,1);
 h.feed(.3,1500);await settle();assert.equal(reads,1);h.call.close();
});

test('new manual press interrupts a pending answer without waiting for speech recognition',async()=>{
 let signal:AbortSignal|undefined;
 const h=harness({prepareHear:async()=>Object.assign(()=> 'Hi.',{text:'Hi.'}),answer:async(_text,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Error('cancelled'))));}});
 h.call.manualInput(true);h.call.inputHeld(true);h.feed(.3,900);h.call.inputHeld(false);await settle();
 assert.ok(signal);h.call.inputHeld(true);assert.equal(signal.aborted,true);h.call.close();await settle();
});

test('a second manual press invalidates recognition from an older release before committing',async()=>{
 let complete!:()=>void,commits=0;
 const h=harness({prepareHear:async()=>{await new Promise<void>(resolve=>{complete=resolve;});return Object.assign(()=>{commits++;return 'Old phrase.';},{text:'Old phrase.'});}});
 h.call.manualInput(true);h.call.inputHeld(true);h.feed(.3,900);h.call.inputHeld(false);await settle();
 h.call.inputHeld(true);complete();await settle();assert.equal(commits,0);assert.equal(h.answered.length,0);h.call.close();
});

test('manual holds are capped and a disconnected hold never commits',async()=>{
 const h=harness({prepareHear:async()=>Object.assign(()=> 'One phrase.',{text:'One phrase.'})});
 h.call.manualInput(true);h.call.inputHeld(true);h.feed(.3,17000);await settle();
 assert.equal(h.answered.length,1);assert.ok(h.events.some(e=>e.type==='input_gate'&&e.active===false));
 h.call.inputHeld(true);h.feed(.3,900);h.call.close();await settle();assert.equal(h.answered.length,1);
});

test('hangup aborts an unanswered model request without reporting a brain failure', async () => {
 let signal:AbortSignal|undefined;
 const h=harness({answer:async(_text,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
 h.feed(.002,2000);h.feed(.3,900);h.feed(.002,700);await settle();
 assert.ok(signal);h.call.close();await settle();assert.equal(signal.aborted,true);
 assert.equal(h.types().includes('error'),false);
});

test('replacement speech cancels the old request and rejects its late sentence',async()=>{
 let old:Parameters<LocalCallDeps['answer']>[1]|undefined;let calls=0;
 const h=harness({answer:async(_text,options)=>{if(++calls===1){old=options;return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>{options.onSentence('STALE','neutral');reject(Error('cancelled'));}));}return {reply:'Replacement.'};}});
 h.feed(.002,2000);h.feed(.3,900);h.feed(.002,700);await settle();
 h.feed(.3,900);h.feed(.002,700);await settle();
 assert.equal(old?.signal?.aborted,true);assert.equal(calls,2);assert.equal(h.types().includes('error'),false);
 assert.equal(h.spoken.some(line=>line.text==='STALE'),false);h.call.close();
});

test('addressed mode rejects video before recognition commit, interruption or answering',async()=>{
 let commits=0;let line='A nearby video is talking.';let signal:AbortSignal|undefined;
 const h=harness({inputMode:'addressed',prepareHear:async()=>Object.assign(()=>{commits++;return line;},{text:line}),
  answer:async(_text,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Error('cancelled'))));}});
 h.feed(.002,2000);h.feed(.3,900);h.feed(.002,700);await settle();
 assert.equal(commits,0);assert.equal(h.types().includes('user_message'),false);
 line='Haru, how are you?';h.feed(.3,900);h.feed(.002,700);await settle();
 assert.equal(commits,1);assert.ok(signal);assert.equal(h.events.find(e=>e.type==='user_message')?.text,'how are you?');
 line='More background video.';h.feed(.3,900);h.feed(.002,700);await settle();
 assert.equal(commits,1);assert.equal(signal.aborted,false);assert.equal(h.types().includes('user_interruption'),false);
 h.call.close();await settle();
});

test('mode controls are voiced locally and apply only to this call',async()=>{
 let line='Haru, hands free mode.';let modelCalls=0;
 const h=harness({inputMode:'addressed',prepareHear:async()=>Object.assign(()=>line,{text:line}),answer:async()=>{modelCalls++;return {reply:'Hello.'};}});
 h.feed(.002,2000);h.feed(.3,900);h.feed(.002,700);await settle();
 assert.equal(modelCalls,0);assert.ok(h.spoken.some(row=>/Hands free/.test(row.text)));
 h.advance(2000);line='How are you?';h.feed(.002,1000);h.feed(.3,900);h.feed(.002,700);await settle();assert.equal(modelCalls,1);h.call.close();
});

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

test('hangup cancels synthesis that has not returned a stream', async () => {
  let signal: AbortSignal | undefined;
  const h = harness({ speak: async (_text, _emotion, _seed, pending) => {
    signal = pending;
    return new Promise((_resolve, reject) => pending!.addEventListener('abort', () => reject(pending!.reason), { once: true }));
  } });
  h.feed(0.002, 2000); h.feed(0.3, 900); h.feed(0.002, 700);
  await settle();
  assert.ok(signal);
  h.call.close();
  await settle();
  assert.equal(signal.aborted, true);
  assert.equal(h.audio.length, 0);
});

test('interruption cancels a stalled PCM read before replacement speech', async () => {
  let cancelled = false, calls = 0;
  const h = harness({
    hear: async () => 'Please change the subject.',
    answer: async (_text, options) => { options.onSentence('Here is my answer.', 'neutral'); return { reply: 'Here is my answer.' }; },
    speak: async () => ({ sampleRate: 24000, stream: ++calls === 1
      ? new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(480)); }, cancel() { cancelled = true; } })
      : voice(2).stream }),
  });
  h.feed(0.002, 2000); h.feed(0.3, 900); h.feed(0.002, 700);
  await settle();
  assert.equal(calls, 1);
  h.call.herSpeaking(true);
  h.feed(0.4, 1600); h.feed(0.002, 700);
  await settle(60);
  assert.equal(cancelled, true);
  assert.equal(calls, 2, 'the old pending read cannot hold the replacement behind it');
  assert.ok(h.types().includes('user_interruption'));
  h.call.close();
});

test('interruption aborts synthesis waiting for headers and voices the replacement', async () => {
  let calls = 0, cancelled = false;
  const h = harness({
    hear: async () => 'Please change the subject.',
    answer: async (_text, options) => { options.onSentence('Here is my answer.', 'neutral'); return { reply: 'Here is my answer.' }; },
    speak: async (_text, _emotion, _seed, signal) => {
      if (++calls > 1) return { stream: voice(2).stream, sampleRate: 24000 };
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => {
        cancelled = true; reject(signal!.reason);
      }, { once: true }));
    },
  });
  h.feed(0.002, 2000); h.feed(0.3, 900); h.feed(0.002, 700);
  await settle();
  assert.equal(calls, 1); assert.equal(h.audio.length, 0);
  h.feed(0.4, 1600); h.feed(0.002, 700);
  await settle(60);
  assert.equal(cancelled, true); assert.equal(calls, 2);
  assert.ok(h.audio.length > 0);
  h.call.close();
});

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
  assert.equal((h.events.at(-1) as { emotion?: string }).emotion, 'smug', 'the face at the end follows the last delivered sentence');
  assert.equal((h.events[1] as { text: string }).text, 'First thing.');
  assert.deepEqual(h.spoken.map(s => s.emotion), ['neutral', 'smug'], 'sentence delivery overrides the resting mood');
  assert.equal(h.spoken[0].seed, h.spoken[1].seed, 'one take: the same seed for every piece');
  assert.deepEqual(h.saids, [], 'she said all of it: nothing to correct');
  assert.equal((h.events[2] as { sampleRate: number }).sampleRate, 24000);
});

test('a complete greeting without ASR punctuation is answered without an extra fragment hold', async () => {
  const h = harness({ hear: async () => 'Hello Haru' });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 520);
  await settle(60);
  assert.equal(h.answered.length, 1);
  assert.equal(h.answered[0].text, 'Hello Haru');
  h.call.close();
});

test('call latency stamps real reply PCM separately from queuing and never labels it playback', async () => {
  const logs: string[] = [];
  let audio: ReadableStreamDefaultController<Uint8Array> | undefined;
  const h = harness({
    log: line => logs.push(line),
    hear: async () => { h.advance(120); return 'Hello Haru.'; },
    answer: async (_text, options) => { h.advance(80); options.onSentence('Hey there.', 'neutral'); return { reply: 'Hey there.' }; },
    speak: async () => ({ stream: new ReadableStream<Uint8Array>({ start(controller) { audio = controller; } }), sampleRate: 24000 }),
  });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 520);
  await settle();
  assert.equal(logs.filter(line => line.startsWith('[call-latency]')).length, 0, 'queued text and audio headers are not PCM');
  h.advance(260);
  audio!.enqueue(new Uint8Array(480)); audio!.close();
  await settle();
  const rows = logs.filter(line => line.startsWith('[call-latency]')).map(line => JSON.parse(line.slice('[call-latency] '.length)));
  assert.deepEqual(rows.map(row => row.stage), ['first-audio', 'done']);
  assert.equal(rows[0].endpointMs, 520);
  assert.ok(rows[0].listenMs >= 120);
  assert.equal(rows[0].answerMs, 80);
  assert.equal(rows[0].ttsFirstPcmMs, 260);
  assert.equal(rows[0].transcriptToFirstPcmMs, 340);
  assert.equal(rows[0].receivedSpeechEndToFirstPcmMs, rows[0].endpointMs + rows[0].listenMs + rows[0].holdMs + 340);
  assert.equal(rows[0].playbackMeasured, false);
  assert.ok(logs.some(line => /reply queued at 80ms, first PCM at 340ms/.test(line)));
  assert.ok(logs.every(line => !line.includes('first voice at')));
  h.call.close();
});

test('a tool filler is not measured as the first answer audio', async () => {
  const logs: string[] = [];
  let resume: (() => void) | undefined;
  const h = harness({ log: line => logs.push(line), answer: async (_text, options) => {
    options.onToolCall('search');
    await new Promise<void>(resolve => { resume = resolve; });
    options.onSentence('Here is the answer.', 'neutral'); return { reply: 'Here is the answer.' };
  } });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 700);
  await settle(40);
  assert.ok(h.audio.length > 0, 'the filler was streamed');
  assert.equal(logs.filter(line => line.startsWith('[call-latency]')).length, 0);
  h.advance(900); resume!(); await settle(40);
  const row = JSON.parse(logs.find(line => line.startsWith('[call-latency]'))!.slice('[call-latency] '.length));
  assert.equal(row.answerMs, 900);
  h.call.close();
});

test('a failed speech engine does not fabricate first-audio latency', async () => {
  const logs: string[] = [];
  const h = harness({ log: line => logs.push(line), speak: async () => null });
  h.feed(0.002, 2000); h.feed(0.3, 800); h.feed(0.002, 700); await settle(40);
  const rows = logs.filter(line => line.startsWith('[call-latency]')).map(line => JSON.parse(line.slice('[call-latency] '.length)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'done');
  assert.equal(rows[0].receivedSpeechEndToFirstPcmMs, null);
  assert.equal(rows[0].ttsFirstPcmMs, null);
  assert.equal(rows[0].playbackMeasured, false);
  h.call.close();
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

test('tone changes end a stretch without changing the words or the voice seed', async () => {
  const parts = [['First.', 'affectionate'], ['Still gentle.', 'affectionate'], ['Now neutral.', 'neutral'], ['And steady.', 'neutral']];
  const h = harness({ answer: async (_text, options) => {
    for (const [text, mood] of parts) options.onSentence(text, mood);
    return { reply: parts.map(([text]) => text).join(' ') };
  } });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(80);
  assert.deepEqual(h.spoken.map(s => [s.text, s.emotion]), [
    ['First.', 'affectionate'], ['Still gentle.', 'affectionate'], ['Now neutral. And steady.', 'neutral'],
  ]);
  assert.equal(new Set(h.spoken.map(s => s.seed)).size, 1);
  assert.equal(h.spoken.map(s => s.text).join(' '), parts.map(([text]) => text).join(' '));
  assert.equal(h.events.at(-1)?.emotion, 'neutral');
  h.call.close();
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

const LONG_LINE = 'A long line she never finishes, about the website and the shop and the graphics card and every other thing they have talked about this week, which goes on and on.';

test('talking over her drops her voice, tells the phone, and the next turn knows', async () => {
  let release: (() => void) | null = null;
  const answers: { text: string; interrupted: boolean }[] = [];
  const h = harness({
    answer: async (text, options) => {
      answers.push({ text, interrupted: options.interrupted });
      if (text === 'First thing.') {
        options.onSentence(LONG_LINE, 'neutral');
        await new Promise<void>(resolve => { release = resolve; });
        return { reply: LONG_LINE };
      }
      options.onSentence('Fine, what.', 'annoyed');
      return { reply: 'Fine, what.' };
    },
    hear: async () => (answers.length ? 'Second thing, stop.' : 'First thing.'),
    // The line she is cut off in goes on and on; her answer to the interruption is short.
    // Her long line comes as 50 ms pieces, so a cut lands part-way through it.
    speak: async text => { const v = voice(text.startsWith('A long') ? 400 : 3, text.startsWith('A long') ? 2400 : 480); h.voices.push(v); return { stream: v.stream, sampleRate: 24000 }; },
    moodNow: () => null,
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  assert.ok(h.audio.length > 0, 'her voice is going out');
  assert.deepEqual(h.types().slice(0, 3), ['user_message', 'assistant_message', 'audio_start']);
  // Two seconds of her line have played by the time they cut in — the bytes
  // sent run well ahead of that.
  h.advance(2000);
  // Over her: louder than the room by more than the raised ratio.
  h.feed(0.5, 600);
  await settle(10);
  // Not yet: a sound over her could be her own voice back through the phone.
  assert.ok(!h.types().includes('user_interruption'), 'a sound over her is a suspicion until the words are known');
  assert.ok(!h.voices[0].cancelled(), 'her voice goes on meanwhile');
  h.feed(0.002, 700);
  await settle(10);
  assert.ok(h.types().includes('user_interruption'), 'his words, heard: the phone is told to hush');
  assert.ok(h.voices[0].cancelled(), 'the stream of her voice is cancelled');
  const sentBefore = h.audio.length;
  await settle(10);
  assert.equal(h.audio.length, sentBefore, 'no more of that line goes down');
  release!();
  await settle(60);
  assert.deepEqual(answers.map(a => a.interrupted), [false, true], 'the next turn is told she was cut off');
  assert.equal(h.types().at(-1), 'assistant_end');
  // The day keeps what she got out: the start of the long line, marked as cut, not the whole draft.
  assert.equal(h.saids.length, 1);
  assert.equal(h.saids[0][0], LONG_LINE);
  assert.ok(h.saids[0][1].startsWith('A long line') && h.saids[0][1].endsWith('—'), h.saids[0][1]);
  assert.ok(h.saids[0][1].length <= 70, `about three seconds' worth — the utterance is heard out first — not the twenty seconds that were sent: ${h.saids[0][1]}`);
});

test('her own voice back through the phone is not an interruption', async () => {
  let release: (() => void) | null = null;
  const answers: string[] = [];
  const h = harness({
    answer: async (text, options) => {
      answers.push(text);
      options.onSentence(LONG_LINE, 'neutral');
      await new Promise<void>(resolve => { release = resolve; });
      return { reply: LONG_LINE };
    },
    // What the speaker fed back into the microphone: her line, as the ears heard it (2026-09-18, "Psychologist.").
    hear: async () => (answers.length ? 'the website and the shop.' : 'First thing.'),
    speak: async () => { const v = voice(400, 2400); h.voices.push(v); return { stream: v.stream, sampleRate: 24000 }; },
    moodNow: () => null,
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  assert.ok(h.audio.length > 0, 'her voice is going out');
  h.advance(2000);
  h.feed(0.5, 600); h.feed(0.002, 700);
  await settle(20);
  assert.ok(!h.types().includes('user_interruption'), 'her echo does not hush her');
  assert.ok(!h.voices[0].cancelled(), 'her voice goes on');
  assert.equal(h.types().filter(t => t === 'user_message').length, 1, 'the echo is not a message of his');
  assert.equal(answers.length, 1, 'and not a turn');
  release!();
  h.call.close();
});

for (const nextEmotion of ['', 'worried']) {
  test(`an interrupted reply keeps its audible take; ${nextEmotion || 'unlabelled'} delivery follows the new words`, async () => {
    let release: (() => void) | undefined;
    const answers: boolean[] = [];
    const spoken: { text: string; emotion: string | null; seed: number }[] = [];
    const h = harness({
      hear: async () => answers.length ? 'Wait, the blue one.' : 'First thing.',
      answer: async (_text, options) => {
        answers.push(options.interrupted);
        if (answers.length === 1) {
          options.onSentence(LONG_LINE, 'affectionate');
          // This later mood is queued but never sent: it must not become the
          // continuity anchor after the interruption.
          options.onSentence('A different direction.', 'annoyed');
          await new Promise<void>(resolve => { release = resolve; });
          return { reply: LONG_LINE + ' A different direction.' };
        }
        if (nextEmotion) options.onSentence('The blue one, got it.', nextEmotion);
        return { reply: 'The blue one, got it.' };
      },
      speak: async (text, emotion, seed) => {
        spoken.push({ text, emotion, seed });
        const v = voice(text === LONG_LINE ? 400 : 3); h.voices.push(v);
        return { stream: v.stream, sampleRate: 24000 };
      },
    });
    h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
    await settle(30);
    assert.ok(h.audio.length > 0);
    h.feed(0.5, 600); h.feed(0.002, 700);
    await settle(30);
    release!(); await settle(40);
    assert.deepEqual(answers, [false, true]);
    assert.ok(h.voices[0].cancelled());
    assert.deepEqual(spoken.map(s => [s.text, s.emotion]), [
      [LONG_LINE, 'affectionate'], ['The blue one, got it.', nextEmotion || 'affectionate'],
    ]);
    assert.equal(spoken[0].seed, spoken[1].seed, 'an interruption does not randomize her voice');
    h.call.close();
  });
}

test('interrupting audio still playing on the phone preserves delivery after server streaming has finished', async () => {
  const answers: boolean[] = [];
  const h = harness({
    hear: async () => answers.length ? 'Wait, the blue one.' : 'First thing.',
    answer: async (_text, options) => {
      answers.push(options.interrupted);
      if (answers.length === 1) options.onSentence(LONG_LINE, 'affectionate');
      return { reply: answers.length === 1 ? LONG_LINE : 'The blue one, got it.' };
    },
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(40);
  assert.equal(h.types().at(-1), 'assistant_end', 'the server has finished sending');
  h.call.herSpeaking(true);
  h.feed(0.5, 600); h.feed(0.002, 700);
  await settle(40);
  assert.deepEqual(answers, [false, true]);
  assert.equal(h.types().filter(t => t === 'user_interruption').length, 1);
  assert.deepEqual(h.spoken.map(s => s.emotion), ['affectionate', 'affectionate']);
  assert.equal(h.spoken[0].seed, h.spoken[1].seed);
  h.call.herSpeaking(false);
  h.advance(1000);
  h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(40);
  assert.deepEqual(answers, [false, true, false], 'a completed turn clears interruption continuity');
  assert.equal(h.spoken[2].emotion, 'annoyed', 'normal turns still consult the current resting mood');
  h.call.close();
});

test('a long stretch of his words over her cuts her off before he has finished', async () => {
  let release: (() => void) | null = null;
  const answers: { text: string; interrupted: boolean }[] = [];
  const h = harness({
    answer: async (text, options) => {
      answers.push({ text, interrupted: options.interrupted });
      if (text === 'First thing.') {
        options.onSentence(LONG_LINE, 'neutral');
        await new Promise<void>(resolve => { release = resolve; });
        return { reply: LONG_LINE };
      }
      options.onSentence('Fine, what.', 'annoyed');
      return { reply: 'Fine, what.' };
    },
    hear: async () => (answers.length ? 'Hang on, wrong appointment, stop.' : 'First thing.'),
    speak: async text => { const v = voice(text.startsWith('A long') ? 400 : 3, text.startsWith('A long') ? 2400 : 480); h.voices.push(v); return { stream: v.stream, sampleRate: 24000 }; },
    moodNow: () => null,
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  h.advance(2000);
  // He keeps talking over her: after 1.2 s the start of it goes to her ears, and his words stop her.
  h.feed(0.5, 1400);
  await settle(10);
  assert.ok(h.types().includes('user_interruption'), 'cut off on the probe, before his utterance ends');
  assert.ok(h.voices[0].cancelled());
  h.feed(0.002, 700);
  release!();
  await settle(60);
  assert.deepEqual(answers.map(a => a.interrupted), [false, true], 'his whole utterance is the next turn, told she was cut off');
  assert.equal(h.types().filter(t => t === 'user_interruption').length, 1, 'cut off once, not again at the end');
});

test('a reply that streamed no sentence is still said, whole', async () => {
  const h = harness({ answer: async () => ({ reply: 'Fine. Go.' }) });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  assert.deepEqual(h.spoken.map(s => s.text), ['Fine. Go.']);
  assert.ok(h.types().includes('assistant_end'));
});

test('what she got out of a line is measured by how much of it played', () => {
  const line = 'Seven words here, then a few more words, and then the end of the sentence.';
  assert.equal(saidOf(line, 0.2), '', 'under half a second is nothing');
  assert.equal(saidOf(line, 1), 'Seven words—', 'fifteen characters a second, cut at a word');
  assert.equal(saidOf(line, 2), 'Seven words here, then a few—');
  assert.equal(saidOf(line, 10), line, 'long enough to have said all of it');
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

test('talked over before a word of it: the reply stays in the day as written', async () => {
  let release: (() => void) | null = null;
  let letSpeak: (() => void) | null = null;
  const answers: { text: string; interrupted: boolean }[] = [];
  const h = harness({
    answer: async (text, options) => {
      answers.push({ text, interrupted: options.interrupted });
      if (text === 'First thing.') {
        options.onSentence(LONG_LINE, 'neutral');
        await new Promise<void>(resolve => { release = resolve; });
        return { reply: LONG_LINE };
      }
      options.onSentence('Fine, what.', 'annoyed');
      return { reply: 'Fine, what.' };
    },
    hear: async () => (answers.length ? 'Second thing, stop.' : 'First thing.'),
    // Her voice for the long line is held back until they have already cut in:
    // the engine was still fetching it when they spoke, as at 11:12 on 2026-09-06.
    speak: async text => {
      if (text.startsWith('A long')) await new Promise<void>(resolve => { letSpeak = resolve; });
      const v = voice(text.startsWith('A long') ? 400 : 3, text.startsWith('A long') ? 2400 : 480); h.voices.push(v); return { stream: v.stream, sampleRate: 24000 };
    },
    moodNow: () => null,
  });
  h.feed(0.002, 2000); h.feed(0.3, 600); h.feed(0.002, 700);
  await settle(30);
  assert.equal(h.audio.length, 0, 'nothing of her voice has gone out yet');
  // Over her before a word of it has played.
  h.feed(0.5, 600);
  await settle(10);
  assert.ok(h.types().includes('user_interruption'), 'the phone is told to hush');
  letSpeak!();
  h.feed(0.002, 700);
  release!();
  await settle(60);
  assert.deepEqual(answers.map(a => a.interrupted), [false, true]);
  // Nothing of it came out, so nothing is rewritten: the draft is her answer.
  assert.deepEqual(h.saids, [], 'a reply she got no word of is not taken out of the day');
});

test('tentative recognition commits only at an identical final endpoint', async () => {
  let preparations=0,commits=0;
  const h=harness({prepareAfterMs:150,prepareHear:async()=>{preparations++;return()=>{commits++;return 'What did you say?';};}});
  h.feed(.002,1000);h.feed(.3,900);h.feed(.002,200);await settle();
  assert.equal(preparations,1);assert.equal(commits,0);assert.equal(h.answered.length,0);
  h.feed(.002,400);await settle();
  assert.equal(commits,1);assert.equal(h.heard.length,0);assert.equal(h.answered.length,1);h.call.close();
});

test('resumed speech and hangup discard tentative recognition without committing',async()=>{
  let commits=0,release!:()=>void;
  const h=harness({prepareAfterMs:150,prepareHear:async()=>{await new Promise<void>(r=>release=r);return()=>{commits++;return 'Old partial.';};}});
  h.feed(.002,1000);h.feed(.3,900);h.feed(.002,200);await settle();
  h.feed(.3,500);h.feed(.002,600);await settle();
  assert.equal(h.heard.length,0);release();await settle();
  assert.equal(commits,0);assert.equal(h.heard.length,1);assert.equal(h.answered[0].text,'What did you say?');h.call.close();
  const closed=harness({prepareAfterMs:150,prepareHear:async()=>()=>{commits++;return 'Stale.';}});
  closed.feed(.002,1000);closed.feed(.3,900);closed.feed(.002,200);await settle();closed.call.close();closed.feed(.002,600);await settle();assert.equal(commits,0);
});

test('unfinished quiet option counts existing silence but preserves a resumed phrase',async()=>{
  const h=harness({unfinishedQuietMs:700,hear:async()=> 'I was thinking about'});
  h.feed(.002,1000);h.feed(.3,900);h.feed(.002,600);await settle();assert.equal(h.answered.length,0);
  h.feed(.002,160);await settle();assert.equal(h.answered.length,1);h.call.close();
  const resumed=harness({unfinishedQuietMs:700,hear:async()=> 'I was thinking about'});
  resumed.feed(.002,1000);resumed.feed(.3,900);resumed.feed(.002,600);await settle();
  resumed.feed(.3,280);await settle();assert.equal(resumed.answered.length,0);resumed.call.close();
});

test('hangup cancels tentative recognition and never commits its result',async()=>{
 let signal:AbortSignal|undefined,commits=0;
 const h=harness({prepareAfterMs:150,prepareHear:async(_wav,received)=>{
  signal=received;await new Promise<void>((_resolve,reject)=>received!.addEventListener('abort',()=>reject(received!.reason),{once:true}));
  return()=>{commits++;return 'stale';};
 }});
 h.feed(.002,1000);h.feed(.3,900);h.feed(.002,200);await settle();assert.ok(signal);
 h.call.close();await settle();assert.equal(signal.aborted,true);assert.equal(commits,0);assert.equal(h.answered.length,0);
});

test('early recognition with the existing fragment hold preserves a 900 ms unfinished pause',async()=>{
 for(const quiet of [undefined,700]){
  const parts=['I was thinking about the','green felt hat.'];
  const recognize=async()=>parts.shift()??'';
  const h=harness({vad:{endAfterMs:550},prepareAfterMs:150,unfinishedQuietMs:quiet,
   hear:recognize,prepareHear:async()=>{const text=await recognize();return()=>text;}});
  h.feed(.002,2000);h.feed(.3,800);h.feed(.002,200);await settle();
  h.feed(.002,360);await settle();
  h.feed(.002,360);await settle();
  assert.equal(h.answered.length,quiet===700?1:0,'700 ms total quiet splits this unfinished pause; the existing hold does not');
  if(quiet===undefined){
   h.feed(.3,600);h.feed(.002,200);await settle();h.feed(.002,360);await settle(60);
   assert.deepEqual(h.answered.map(a=>a.text),['I was thinking about the green felt hat.']);
  }
  h.call.close();
 }
});
