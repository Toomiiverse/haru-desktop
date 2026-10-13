// 3760: call turns are timed with span counting, held utterances get a [call-hold] line, the latency line carries frameMs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTimedTurn, markTurn, spanCountingSink, currentTurn } from '../electron/turn-timing';
import { endingOf } from '../electron/localcall';

test('a call turn counts its spans, writes its stage marks and opens a turn context for the policy memo', async () => {
  const written: any[] = []; let summary: any = null; let inside: unknown;
  await runTimedTurn('call-x-1', async () => {
    inside = currentTurn();
    markTurn('policy_span' as any, { operation: 'mood.normalize', durationMs: 2, coreMs: 0.5, status: 'ok' });
    markTurn('policy_span' as any, { operation: 'mood.normalize', durationMs: 0.1, status: 'ok' });   // a memo hit: no Core clock
    markTurn('published' as any);
  }, spanCountingSink(c => { summary = c; }, e => written.push(e)));
  await new Promise(r => setImmediate(r));
  assert.ok(inside, 'the turn context exists inside the call turn');
  assert.deepEqual(written.map(e => e.stage), ['runner_start', 'published', 'runner_end']);
  assert.deepEqual({ spans: summary.spans, coreCalls: summary.coreCalls, memoOrLocal: summary.memoOrLocal }, { spans: 2, coreCalls: 1, memoOrLocal: 1 });
});

test('a held transcript is classed by how it ended, never quoted', () => {
  assert.equal(endingOf('I went to the shops.'), 'punctuation');
  assert.equal(endingOf('I went to the shops,'), 'mark');
  assert.equal(endingOf('and then I went to the'), 'none');
  assert.equal(endingOf('wait — '), 'mark');
});

import { openLocalCall, CALL_RATE, type LocalCallDeps } from '../electron/localcall';
import * as policy from '../electron/core-policy-sync';

test('an unfinished sentence that times out writes one [call-hold] line with no words', async () => {
  const table: Record<string, unknown> = { 'speech-boundary.unfinished': true, 'speech-boundary.unfinishedHold': 700, 'speech-boundary.continued': null,
    'speech-boundary.echoOfHers': false, 'speech-boundary.settleTake': { report: false }, 'speech-boundary.callMicCheckReply': null, 'speech-boundary.callInputCommand': null };
  (policy as any).corePolicySync = (op: string) => table[op];
  const FRAME_MS = 40, FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;
  const frame = (level: number) => { const out = new Int16Array(FRAME_BYTES / 2), a = Math.round(level * 32767); for (let i = 0; i < out.length; i++) out[i] = i % 2 ? a : -a; return new Uint8Array(out.buffer); };
  let clock = 1_000_000; const lines: string[] = [];
  const deps: LocalCallDeps = { hear: async () => 'and then I went to the', answer: () => new Promise(() => {}), speak: async () => ({ stream: new ReadableStream(), sampleRate: 24000 }),
    filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: (l: string) => lines.push(l) } as any;
  const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  feed(0.002, 1000); feed(0.3, 1000); feed(0.002, 700);
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  feed(0.002, 1200);                                  // quiet past the hold: the fragment is answered alone
  const hold = lines.filter(l => l.startsWith('[call-hold] '));
  assert.equal(hold.length, 1);
  const body = JSON.parse(hold[0].slice(12));
  assert.equal(body.reason, 'unfinished'); assert.equal(body.merged, false); assert.equal(body.ending, 'none');
  assert.ok(body.heldMs >= 600 && !JSON.stringify(body).includes('went'));
  const latency = lines.find(l => l.startsWith('[call-latency] '));
  if (latency) assert.equal(JSON.parse(latency.slice(15)).frameMs, FRAME_MS);
  c.close('test');
});
