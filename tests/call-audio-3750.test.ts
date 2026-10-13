// 3750: no reaction sound starts while the microphone hears him, and each speaker verdict is logged without words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalCall, CALL_RATE, type LocalCallDeps } from '../electron/localcall';

const FRAME_MS = 40, FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;
function frame(level: number): Uint8Array {
  const out = new Int16Array(FRAME_BYTES / 2), a = Math.round(level * 32767);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? a : -a;
  return new Uint8Array(out.buffer);
}
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

function call(extra: Partial<LocalCallDeps>) {
  let clock = 1_000_000;
  const plans: { event: string; replyBusy: unknown }[] = [], lines: string[] = [];
  const deps: LocalCallDeps = {
    hear: async () => '', answer: async () => ({ reply: '' }), speak: async () => ({ stream: new ReadableStream(), sampleRate: 24000 }),
    filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: line => lines.push(line),
    engagement: { plan: (state, event, facts) => { plans.push({ event, replyBusy: facts.replyBusy }); return { state, command: null, afterMs: null, inputMode: null } as any; }, clip: () => null, available: () => true },
    ...extra,
  };
  const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  return { c, plans, lines, feed };
}

test('a reaction never starts while the microphone hears him', async () => {
  const h = call({});
  h.feed(0.002, 1000);                       // quiet: the welcome decision sees nothing busy
  assert.equal(h.plans[0].event, 'ready');
  assert.equal(h.plans[0].replyBusy, false);
  h.feed(0.3, 600);                          // he starts talking: the onset decision is made while the VAD hears him
  const onset = h.plans.find(p => p.event === 'speechStart');
  assert.ok(onset, 'speechStart reached the engagement policy');
  assert.equal(onset!.replyBusy, true);
  h.c.close('test');
});

test('every final speaker verdict is logged with no words', async () => {
  const verdict = { allow: false, enforcing: true, speaker: 'uncertain', reason: 'too_little_speech', score: null, notice: null };
  const speaker = { enabled: true, check: async () => verdict, confirm: async () => ({ current: true }), notice: async () => ({ notice: null }),
    frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const h = call({ speaker });
  h.feed(0.002, 1000); h.feed(0.3, 800); h.feed(0.002, 900);
  await settle();
  const line = h.lines.find(l => l.startsWith('[call-speaker] '));
  assert.ok(line, 'a [call-speaker] line was written');
  const body = JSON.parse(line!.slice('[call-speaker] '.length));
  assert.deepEqual({ final: body.final, allow: body.allow, reason: body.reason, enforcing: body.enforcing }, { final: true, allow: false, reason: 'too_little_speech', enforcing: true });
  assert.ok(!('text' in body) && !('words' in body));
  h.c.close('test');
});
