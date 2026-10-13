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

test('no reaction starts while her ears are still deciding on what he said', async () => {
  let release: (v: unknown) => void = () => {};
  const verdict = new Promise(r => { release = r; });
  const speaker = { enabled: true, check: async () => verdict, confirm: async () => ({ current: true }), notice: async () => ({ notice: null }),
    frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const h = call({ speaker });
  h.feed(0.002, 1000); h.feed(0.3, 800); h.feed(0.002, 900);   // he spoke and stopped; the voice check is pending
  await settle();
  h.c.herSpeaking(false);                                        // any engagement decision now must see 'busy'
  const last = h.plans[h.plans.length - 1];
  assert.equal(last.event, 'playback');
  assert.equal(last.replyBusy, true);
  release({ allow: false, enforcing: true, speaker: 'uncertain', reason: 'ambiguous_or_mixed_audio', notice: null });
  await settle();
  h.c.herSpeaking(false);
  assert.equal(h.plans[h.plans.length - 1].replyBusy, false);
  h.c.close('test');
});

test('a failed voice check is logged by its code, and the call end carries the call id', async () => {
  const speaker = { enabled: true, check: async () => { throw Error('voice_session_expired'); }, confirm: async () => ({ current: true }), notice: async () => ({ notice: null }),
    frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const h = call({ speaker });
  h.feed(0.002, 1000); h.feed(0.3, 800); h.feed(0.002, 900);
  await settle();
  const failed = h.lines.find(l => l.startsWith('[call-speaker] '));
  assert.ok(failed);
  assert.deepEqual(JSON.parse(failed!.slice(15)).error, 'voice_session_expired');
  h.c.close('the phone hung up');
  const end = h.lines.find(l => l.startsWith('[call-end] '));
  const speakerId = JSON.parse(failed!.slice(15)).callId;
  assert.ok(end && JSON.parse(end.slice(11)).callId === speakerId && JSON.parse(end.slice(11)).reason === 'the phone hung up');
});

import * as policy from '../electron/core-policy-sync';
function stubPolicy() {
  const table: Record<string, unknown> = { 'speech-boundary.unfinished': false, 'speech-boundary.continued': null, 'speech-boundary.echoOfHers': false,
    'speech-boundary.settleTake': { report: false }, 'speech-boundary.callMicCheckReply': null, 'speech-boundary.callInputCommand': null, 'speech-boundary.unfinishedHold': 0 };
  (policy as any).corePolicySync = (op: string) => table[op];
}

test('an utterance that began over her reaches the voice check as busy', async () => {
  stubPolicy();
  const calls: { final: unknown; busy: unknown }[] = [];
  const speaker = { enabled: true, check: async (_w: unknown, final: unknown, busy: unknown) => { calls.push({ final, busy }); return { allow: false, enforcing: true, speaker: 'uncertain', reason: 'too_little_speech', notice: null }; },
    confirm: async () => ({ current: true }), notice: async () => ({ notice: null }), frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const h = call({ speaker });
  h.feed(0.002, 1000);
  h.c.herSpeaking(true); h.feed(0.3, 400); h.c.herSpeaking(false); h.feed(0.3, 300); h.feed(0.002, 900);
  await settle();
  const final = calls.find(c => c.final === true);
  assert.ok(final, 'a final voice check ran');
  assert.equal(final!.busy, true);
  h.c.close('test');
});

test('filter on: a refused sound while she is still on his turn does not end her wait', async () => {
  stubPolicy();
  let n = 0;
  const speaker = { enabled: true, check: async () => (++n === 1 ? { allow: true, enforcing: true, speaker: 'owner', reason: 'voice_match', notice: null } : { allow: false, enforcing: true, speaker: 'other', reason: 'different_voice', notice: null }),
    confirm: async () => ({ current: true }), notice: async () => ({ notice: null }), frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const h = call({ speaker, hear: async () => 'What time is it there?', prepareHear: undefined, answer: () => new Promise(() => {}) } as any);
  h.feed(0.002, 1000); h.feed(0.3, 1200); h.feed(0.002, 900);   // his question: accepted and committed; her answer never comes back
  await settle(60);
  h.feed(0.3, 800); h.feed(0.002, 900);                           // the TV, refused
  await settle(60);
  const after = h.plans.slice(h.plans.findIndex(p => p.event === 'speechEnd'));
  assert.ok(after.length, 'his turn reached the policy');
  assert.ok(!after.some(p => p.event === 'hearingRejected'), 'the refusal did not reach the policy as hearingRejected while she was thinking');
  h.c.close('test');
});
