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
    markTurn('policy_span' as any, { operation: 'mood.normalize', durationMs: 3, status: 'error' });   // a failed call
    markTurn('storage_span' as any, { durationMs: 70, status: 'ok' });
    markTurn('published' as any);
  }, spanCountingSink(c => { summary = c; }, e => written.push(e)));
  await new Promise(r => setImmediate(r));
  assert.ok(inside, 'the turn context exists inside the call turn');
  assert.deepEqual(written.map(e => e.stage), ['runner_start', 'published', 'runner_end']);
  assert.deepEqual({ coreCalls: summary.coreCalls, memoHits: summary.memoHits, failed: summary.failed, storageCalls: summary.storageCalls, capped: summary.capped }, { coreCalls: 1, memoHits: 1, failed: 1, storageCalls: 1, capped: undefined });
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
  const deps: LocalCallDeps = { hear: async () => 'and then I went to the', answer: async (_t: string, o: any) => { o.onSentence('Oh nice. ', 'neutral'); return { reply: 'Oh nice.' }; },
    speak: async () => ({ stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4800)); c.close(); } }), sampleRate: 24000 }),
    filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: (l: string) => lines.push(l) } as any;
  const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  feed(0.002, 1000); feed(0.3, 1000); feed(0.002, 700);
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  feed(0.002, 1200);                                  // quiet past the hold: the fragment is answered alone
  const hold = lines.filter(l => l.startsWith('[call-hold] '));
  assert.equal(hold.length, 1);
  const body = JSON.parse(hold[0].slice(12));
  assert.equal(body.reason, 'unfinished'); assert.equal(body.merged, false); assert.equal(body.outcome, 'timeout'); assert.equal(body.ending, 'none');
  assert.ok(body.heldMs >= 600 && !JSON.stringify(body).includes('went'));
  for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
  const latency = lines.find(l => l.startsWith('[call-latency] '));
  assert.ok(latency, 'a [call-latency] line was written');
  assert.equal(JSON.parse(latency!.slice(15)).frameMs, FRAME_MS);
  c.close('test');
});

test('the turn token exists only while the turn runs, and a review inside it shares it', async () => {
  const { timeTurnReview } = await import('../electron/turn-timing');
  let during: unknown, inReview: unknown, later: unknown; let resolveLater: () => void = () => {};
  const done = new Promise<void>(r => { resolveLater = r; });
  await runTimedTurn('call-y-1', async () => {
    during = currentTurn();
    await timeTurnReview(async () => { inReview = currentTurn(); });
    setTimeout(() => { later = currentTurn(); resolveLater(); }, 5);   // work the turn started that outlives it
  }, spanCountingSink(() => {}, () => {}));
  await done;
  assert.ok(during && inReview === during, 'the review shares the turn token');
  assert.equal(later, undefined);
});

test('the counting summary is written once on error and flags a capped turn', async () => {
  const sums: any[] = [];
  await assert.rejects(runTimedTurn('call-z-1', async () => { for (let i = 0; i < 800; i++) markTurn('policy_span' as any, { operation: 'mood.normalize', durationMs: 0.1, status: 'ok' }); throw Error('boom'); },
    spanCountingSink(c => sums.push(c), () => {})));
  await new Promise(r => setImmediate(r));
  assert.equal(sums.length, 1); assert.equal(sums[0].capped, true); assert.equal(sums[0].memoHits, 768);
});

test('main.ts wires call turns through the counting timer and flushes the voice at publish', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  const answerLine = src.split('\n').find(l => /^\s*answer: \(text, \{ interrupted, onSentence, onToolCall,/.test(l)) ?? '';
  assert.ok(answerLine.includes('runTimedTurn(') && answerLine.includes('spanCountingSink('));
  assert.ok(src.includes("onPublished: content => { published = content; try { voice.flush(); }"));
  assert.ok(src.includes("try{onPublished?.(content);}"));
});

test('filter on: the early transcript runs only after a non-final voice check says it is him', async () => {
  const table: Record<string, unknown> = { 'speech-boundary.unfinished': false, 'speech-boundary.continued': null, 'speech-boundary.echoOfHers': false,
    'speech-boundary.settleTake': { report: false }, 'speech-boundary.callMicCheckReply': null, 'speech-boundary.callInputCommand': null, 'speech-boundary.unfinishedHold': 0 };
  (policy as any).corePolicySync = (op: string) => table[op];
  const FRAME_MS = 40, FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;
  const frame = (level: number) => { const out = new Int16Array(FRAME_BYTES / 2), a = Math.round(level * 32767); for (let i = 0; i < out.length; i++) out[i] = i % 2 ? a : -a; return new Uint8Array(out.buffer); };
  const run = async (allowPreview: boolean, allowFinal: boolean) => {
    let clock = 1_000_000; const order: string[] = []; let prepared = 0, used = 0, answered = 0;
    const speaker = { enabled: true, check: async (_w: unknown, final: boolean) => { order.push(final ? 'final' : 'preview-check'); const ok = final ? allowFinal : allowPreview; return { allow: ok, enforcing: true, speaker: ok ? 'owner' : 'other', reason: ok ? 'voice_match' : 'different_voice', notice: null }; },
      confirm: async () => ({ current: true }), notice: async () => ({ notice: null }), frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
    const deps: LocalCallDeps = { speaker, hear: async () => 'unprepared', prepareHear: async () => { prepared++; order.push('asr'); return Object.assign(() => { used++; return 'prepared words.'; }, { text: 'prepared words.' }); },
      prepareAfterMs: 150, answer: async () => { answered++; return { reply: '' }; }, speak: async () => ({ stream: new ReadableStream(), sampleRate: 24000 }),
      filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: () => {} } as any;
    const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
    const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
    feed(0.002, 1000); feed(0.3, 1000);
    for (let i = 0; i < 6; i++) { feed(0.002, 80); for (let j = 0; j < 10; j++) await new Promise(r => setImmediate(r)); }
    feed(0.002, 600);
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    c.close('test');
    return { order, prepared, used, answered };
  };
  const refused = await run(false, true);
  assert.ok(refused.order.includes('preview-check'), 'a non-final check ran on the preview');
  assert.ok(refused.order.indexOf('asr') > refused.order.indexOf('final'), `no transcript before the final check (${refused.order})`);
  const allowed = await run(true, true);
  assert.ok(allowed.order.indexOf('asr') < allowed.order.indexOf('final') && allowed.prepared === 1 && allowed.used === 1, `the prepared transcript is used (${allowed.order})`);
  const finalNo = await run(true, false);
  assert.equal(finalNo.used, 0, 'the final check still decides');
  assert.equal(finalNo.answered, 0);
});

test('hanging up during a hold writes a dropped [call-hold] line', async () => {
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
  c.close('the phone hung up');
  const hold = lines.filter(l => l.startsWith('[call-hold] '));
  assert.equal(hold.length, 1);
  assert.equal(JSON.parse(hold[0].slice(12)).outcome, 'dropped');
  const end = lines.findIndex(l => l.startsWith('[call-end] '));
  assert.ok(end > lines.indexOf(hold[0]), 'the hold line comes before the call end');
});

test('filter on: another voice is preview-checked once per utterance, and a failed preview check is logged', async () => {
  const table: Record<string, unknown> = { 'speech-boundary.unfinished': false, 'speech-boundary.continued': null, 'speech-boundary.echoOfHers': false,
    'speech-boundary.settleTake': { report: false }, 'speech-boundary.callMicCheckReply': null, 'speech-boundary.callInputCommand': null, 'speech-boundary.unfinishedHold': 0 };
  (policy as any).corePolicySync = (op: string) => table[op];
  const FRAME_MS = 40, FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;
  const frame = (level: number) => { const out = new Int16Array(FRAME_BYTES / 2), a = Math.round(level * 32767); for (let i = 0; i < out.length; i++) out[i] = i % 2 ? a : -a; return new Uint8Array(out.buffer); };
  const run = async (fail: boolean) => {
    let clock = 1_000_000, previews = 0; const lines: string[] = [];
    const speaker = { enabled: true, check: async (_w: unknown, final: boolean) => { if (!final) { previews++; if (fail) throw Error('voice_session_expired'); }
        return { allow: false, enforcing: true, speaker: 'other', reason: 'different_voice', notice: null }; },
      confirm: async () => ({ current: true }), notice: async () => ({ notice: null }), frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
    const deps: LocalCallDeps = { speaker, hear: async () => 'tv talking', prepareHear: async () => Object.assign(() => 'tv talking', { text: 'tv talking' }),
      prepareAfterMs: 150, answer: async () => ({ reply: '' }), speak: async () => ({ stream: new ReadableStream(), sampleRate: 24000 }),
      filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock, vad: { endAfterMs: 500 }, log: (l: string) => lines.push(l) } as any;
    const c = openLocalCall({ onEvent: () => {}, onAudio: () => {}, onClose: () => {} }, deps);
    const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
    feed(0.002, 1000); feed(0.3, 1000);
    for (let p = 0; p < 3; p++) { feed(0.002, 240); for (let j = 0; j < 20; j++) await new Promise(r => setImmediate(r)); feed(0.3, 400); }   // pauses shorter than the endpoint
    feed(0.002, 700); for (let j = 0; j < 40; j++) await new Promise(r => setImmediate(r));
    c.close('test');
    return { previews, lines };
  };
  const refused = await run(false);
  assert.equal(refused.previews, 1, `one preview check for one utterance of another voice (${refused.previews})`);
  const failed = await run(true);
  const line = failed.lines.find(l => l.startsWith('[call-speaker] ') && l.includes('"error"'));
  assert.ok(line && JSON.parse(line.slice(15)).final === false && JSON.parse(line.slice(15)).error === 'voice_session_expired');
});

test('main.ts keeps a published call reply only under the narrow condition, with a [turn-failed] trace', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(src.includes('if (published === null || flushError || !options?.call || options?.signal?.aborted) throw error;'));
  assert.ok(src.includes("console.log('[turn-failed] '+JSON.stringify({id:trace.id,callId:options.callTrace?.id??null,turn:options.callTrace?.turn??null,kept:true,"));
  // within sayStream, from the early flush to the reply mark: the rethrow comes before the final flush
  const from = src.indexOf('onPublished: content => { published = content; try { voice.flush(); }');
  const seg = src.slice(from, src.indexOf("trace.mark('reply')", from));
  assert.ok(from > 0 && seg.indexOf('if (flushError) throw flushError;') > 0 && seg.indexOf('if (flushError) throw flushError;') < seg.lastIndexOf('voice.flush();'));
});
