// 3770 (user choice): words she was still thinking about, with nothing of her reply queued, when he carried on join his next turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalCall, CALL_RATE, type LocalCallDeps } from '../electron/localcall';
import * as policy from '../electron/core-policy-sync';

const table: Record<string, unknown> = { 'speech-boundary.unfinished': false, 'speech-boundary.continued': null, 'speech-boundary.echoOfHers': false,
  'speech-boundary.settleTake': { report: false }, 'speech-boundary.callMicCheckReply': null, 'speech-boundary.callInputCommand': null, 'speech-boundary.unfinishedHold': 0,
  'speech-boundary.sentencePlan': { mood: null, stretch: '', sentences: 1, commands: [{ text: 'Sure.', emotion: null }] } };
const FRAME_MS = 40, FRAME_BYTES = (CALL_RATE * FRAME_MS / 1000) * 2;
const frame = (level: number) => { const out = new Int16Array(FRAME_BYTES / 2), a = Math.round(level * 32767); for (let i = 0; i < out.length; i++) out[i] = i % 2 ? a : -a; return new Uint8Array(out.buffer); };
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

function call(filterOn: boolean, firstReplies: boolean, firstActs: '' | 'acted' | 'tool' = '') {
  (policy as any).corePolicySync = (op: string) => table[op];
  let clock = 1_000_000, heardN = 0; const asked: string[] = [], shown: string[] = [], lines: string[] = [], repeatedSeen: (string | null)[] = [], signals: AbortSignal[] = [];
  const speaker = { enabled: true, check: async () => ({ allow: true, enforcing: true, speaker: 'owner', reason: 'voice_match', notice: null }),
    confirm: async () => ({ current: true }), notice: async () => ({ notice: null }), frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const deps: LocalCallDeps = { ...(filterOn ? { speaker } : {}), hear: async () => (++heardN === 1 ? 'I went to the shops yesterday' : 'and bought a lamp'),
    answer: (text: string, o: any) => { asked.push(text); repeatedSeen.push(o.repeated ?? null); signals.push(o.signal); if (asked.length === 1 && firstReplies) o.onSentence('Sure. ', 'neutral');
      if (asked.length === 1 && firstActs === 'acted') o.onActed(); if (asked.length === 1 && firstActs === 'tool') o.onToolCall('remember'); return new Promise(() => {}); },
    speak: async () => ({ stream: new ReadableStream({ start() {} }), sampleRate: 24000 }), filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock,
    vad: { endAfterMs: 500 }, log: (l: string) => lines.push(l) } as any;
  const c = openLocalCall({ onEvent: e => { if (e.type === 'user_message') shown.push((e as any).text); }, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  return { c, asked, shown, lines, feed, repeatedSeen, signals };
}

for (const filterOn of [true, false]) {
  test(`filter ${filterOn ? 'on' : 'off'}: a turn dropped before any reply joins his next words`, async () => {
    const h = call(filterOn, false);
    h.feed(0.002, 1000); h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
    assert.deepEqual(h.asked, ['I went to the shops yesterday']);
    h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
    assert.equal(h.asked.at(-1), 'I went to the shops yesterday and bought a lamp');
    assert.equal(h.repeatedSeen.at(-1), 'I went to the shops yesterday');   // counted once, not again
    assert.deepEqual(h.shown, ['I went to the shops yesterday', 'and bought a lamp']);
    const merge = h.lines.find(l => l.startsWith('[call-merge] '));
    assert.ok(merge && !merge.includes('lamp') && !merge.includes('shops'));
    h.c.close('test');
  });
}

test('a turn whose reply was already queued is not merged', async () => {
  const h = call(true, true);
  h.feed(0.002, 1000); h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
  h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
  assert.equal(h.asked.at(-1), 'and bought a lamp');
  assert.ok(!h.lines.some(l => l.startsWith('[call-merge] ')));
  h.c.close('test');
});

for (const kind of ['acted', 'tool'] as const) {
  test(`a dropped turn that ${kind === 'acted' ? 'wrote a reminder' : 'ran a tool'} is never merged (it would act twice)`, async () => {
    const h = call(true, false, kind);
    h.feed(0.002, 1000); h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
    h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
    assert.equal(h.asked.at(-1), 'and bought a lamp');
    assert.ok(!h.lines.some(l => l.startsWith('[call-merge] ')));
    h.c.close('test');
  });
}

test('main.ts: every durable write of a call turn is behind a drop check, and only acting writes signal it', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  const between = (a: string, b: string, from = 0) => { const i = src.indexOf(a, from); const j = src.indexOf(b, i); assert.ok(i > 0 && j > i, `${a} .. ${b}`); return src.slice(i, j + b.length); };
  assert.ok(src.includes("function stopIfDropped(signal?: AbortSignal) { if (signal?.aborted && signal.reason !== 'hung-up') signal.throwIfAborted(); }"));
  const entry = between('  stopIfDropped(signal);\n  // They are talking to her', '// They have spoken, which is what every escalation was trying to achieve.');
  assert.ok(!/await /.test(entry));
  assert.ok(/const agendaWritesAtEntry = agendaWrites;\n  tickOffSpoken\(latest\);\n[^\n]*\n  if \(agendaWrites !== agendaWritesAtEntry\) onActed\?\.\(\);\n  startedSpoken\(latest\);/.test(entry));
  assert.equal(entry.split('onActed?.()').length - 1, 1);
  const direct = between("stopIfDropped(signal);   // 3770: see the turn-entry note\n    const packet=corePolicySync<any>('agenda-life.directReminder'", 'if(packet.plan)onActed?.();');
  assert.ok(!/await /.test(direct));
  const fin = between("  signal?.throwIfAborted();\n  // 3770: her reply-promise reminder", '  replyGate.commit(content);');
  assert.ok(fin.includes("corePolicySync<any>('agenda-life.final'") && !/await /.test(fin) && !fin.includes('onActed'));
  assert.ok(src.includes("signal?.throwIfAborted();   // 3770: a dropped turn runs no tool (it would run again in the merged turn)\n      onToolCall?.(tool);"));
  assert.ok(/function ownedAgendaChanged\(packet:any\)\{\n  if\(packet\.plan\)agendaWrites\+\+;/.test(src));
  const check = 'stopIfDropped(options?.signal);   // 3770: a dropped call turn posts nothing';
  assert.equal(src.split("await affectOutcome(affect, 'completed');\n        " + check).length - 1, 2);
  assert.ok(/const affect = await admitAffect\([^\n]*\n      stopIfDropped\(options\?\.signal\);   \/\/ 3770: a dropped call turn posts nothing/.test(src));
  assert.ok(src.includes("const pushback=(deviceMutation('pushback',[newWords],deviceStateAdapter()));") && src.includes("if (readsAsDropIt(newWords)) feelNow('drop-it');"));
});

test('a mic check or mode command while she thinks keeps the dropped words for his next turn', async () => {
  const h = call(true, false);
  table['speech-boundary.callMicCheckReply'] = null;
  h.feed(0.002, 1000); h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
  table['speech-boundary.callMicCheckReply'] = 'Your words came through.';
  h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
  table['speech-boundary.callMicCheckReply'] = null;
  h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
  assert.equal(h.asked.at(-1)?.startsWith('I went to the shops yesterday '), true, `the dropped words joined his next turn (${h.asked.at(-1)})`);
  h.c.close('test');
});

test('hanging up aborts the turn as a hang-up, not a drop', async () => {
  const h = call(true, false);
  h.feed(0.002, 1000); h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
  h.c.close('the phone hung up');
  assert.equal(h.signals[0]?.aborted, true);
  assert.equal(h.signals[0]?.reason, 'hung-up');
});
