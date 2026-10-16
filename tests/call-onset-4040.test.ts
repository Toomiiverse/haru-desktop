// 4040: with voice recognition off, a sound that carries no words no longer cancels her pending answer (10-16 call 1: six
// turns pre-empted within a second of starting); words still do, now at commit, as with recognition on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalCall, CALL_RATE, type LocalCallDeps } from '../electron/localcall';
import * as policy from '../electron/core-policy-sync';

// the same Core answers the call-merge test uses: nothing unfinished, no echo, no voice command
const table: Record<string, unknown> = { 'speech-boundary.unfinished': false, 'speech-boundary.continued': null, 'speech-boundary.echoOfHers': false,
  'speech-boundary.settleTake': { report: false }, 'speech-boundary.callMicCheckReply': null, 'speech-boundary.callInputCommand': null, 'speech-boundary.unfinishedHold': 0,
  'speech-boundary.sentencePlan': { mood: null, stretch: '', sentences: 1, commands: [{ text: 'Sure.', emotion: null }] } };

const FRAME_MS = 40, FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;
function frame(level: number): Uint8Array {
  const out = new Int16Array(FRAME_BYTES / 2), a = Math.round(level * 32767);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? a : -a;
  return new Uint8Array(out.buffer);
}
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

function call(heard: string[]) {
  (policy as any).corePolicySync = (op: string) => table[op];
  let clock = 1_000_000;
  const lines: string[] = [], asked: { text: string; signal?: AbortSignal }[] = [];
  let release: (v: { reply: string }) => void = () => {};
  const deps: LocalCallDeps = {
    hear: async () => heard.shift() ?? '',
    answer: (text, options) => { asked.push({ text, signal: options.signal }); return new Promise(r => { release = r; }); },
    speak: async () => ({ stream: new ReadableStream(), sampleRate: 24000 }),
    filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: line => lines.push(line),
  };
  const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  return { c, lines, asked, feed, release: (reply: string) => release({ reply }) };
}

test('a wordless sound while she is thinking leaves her answer running', async () => {
  const h = call(['what does that even mean', '']);
  h.feed(0.002, 600); h.feed(0.3, 800); h.feed(0.002, 900); await settle();
  assert.equal(h.asked.length, 1, 'his words started a turn');
  h.feed(0.3, 400); h.feed(0.002, 900); await settle();   // a cough, a door: the VAD fires, the ears hear nothing
  assert.ok(!h.lines.some(l => l.includes('"action":"preempt"')), 'no pre-emption on the sound');
  assert.equal(h.asked[0].signal?.aborted ?? false, false, 'her answer was not aborted');
  assert.equal(h.asked.length, 1, 'no second turn');
  h.c.close('test');
});

test('real words while she is thinking still pre-empt her answer', async () => {
  const h = call(['what does that even mean', 'no wait, I meant the other one']);
  h.feed(0.002, 600); h.feed(0.3, 800); h.feed(0.002, 900); await settle();
  h.feed(0.3, 800); h.feed(0.002, 900); await settle();
  assert.ok(h.lines.some(l => l.includes('"source":"commit"') && l.includes('"action":"preempt"')), 'pre-empted when the words arrived');
  assert.equal(h.asked[0].signal?.aborted, true);
  h.c.close('test');
});

test('a reply whose opening was replaced still gives her own mood tag, so no classifier runs', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes('const labelled = splitDelivery(herWords)[0]?.mood ?? splitDelivery(said)[0]?.mood;'));
});
