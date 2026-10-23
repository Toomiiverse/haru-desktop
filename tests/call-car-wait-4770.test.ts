// 4770: in the car a silent brain gets a holding line at 8 s and is given up aloud at 16 s; parked, nothing changes.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { openLocalCall, CALL_RATE, type LocalCallDeps } from '../electron/localcall';
import { noteDeviceFrame } from '../electron/core-ios';
import * as policy from '../electron/core-policy-sync';

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
  const lines: string[] = [], asked: { text: string; signal?: AbortSignal }[] = [], said: string[] = [];
  const deps: LocalCallDeps = {
    hear: async () => heard.shift() ?? '',
    answer: (text, options) => { asked.push({ text, signal: options.signal }); if (h.toolCall) setImmediate(() => options.onToolCall(h.toolCall!)); return new Promise(() => {}); },   // a brain that never answers
    speak: async (text: string) => { said.push(text); return { stream: new ReadableStream({ start(c) { c.close(); } }), sampleRate: 24000 }; },
    filler: () => 'One sec.', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: line => lines.push(line),
  };
  const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  const h = { c, lines, asked, said, feed, toolCall: '' as string };
  return h;
}
const car = (state: string) => noteDeviceFrame(JSON.stringify({ type: 'heartbeat', carPlay: state }));

test('driving: a holding line at 8 s, given up aloud at 16 s', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    car('listening');
    const h = call(['what is the status this morning', '']);
    h.feed(0.002, 600); h.feed(0.3, 800); h.feed(0.002, 900); await settle();
    assert.equal(h.asked.length, 1);
    mock.timers.tick(8000); await settle();
    assert.ok(h.lines.some(l => l.includes('[call-car-wait]') && l.includes('"action":"holding"')), h.lines.join('\n'));
    assert.equal(h.asked[0].signal?.aborted ?? false, false, 'the answer is still running');
    mock.timers.tick(8000); await settle();
    assert.ok(h.lines.some(l => l.includes('"action":"gave up"')));
    assert.equal(h.asked[0].signal?.aborted, true, 'the answer was abandoned');
    assert.deepEqual(h.said, ['One sec.', 'That is taking too long, ask me again in a moment.']);
    h.c.close('test');
  } finally { car('ready'); mock.timers.reset(); }
});

test('driving: a tool call stands the car wait down', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    car('listening');
    const h = call(['search it up', '']);
    h.toolCall = 'browser_control';
    h.feed(0.002, 600); h.feed(0.3, 800); h.feed(0.002, 900); await settle();
    assert.equal(h.asked.length, 1);
    mock.timers.tick(20000); await settle();
    assert.ok(!h.lines.some(l => l.includes('[call-car-wait]')), h.lines.join('\n'));
    assert.equal(h.asked[0].signal?.aborted ?? false, false, 'the tool round runs on');
    h.c.close('test');
  } finally { car('ready'); mock.timers.reset(); }
});

test('parked: no car wait', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    car('ready');
    const h = call(['what is the status this morning', '']);
    h.feed(0.002, 600); h.feed(0.3, 800); h.feed(0.002, 900); await settle();
    mock.timers.tick(20000); await settle();
    assert.ok(!h.lines.some(l => l.includes('[call-car-wait]')));
    assert.equal(h.asked[0].signal?.aborted ?? false, false);
    h.c.close('test');
  } finally { mock.timers.reset(); }
});
