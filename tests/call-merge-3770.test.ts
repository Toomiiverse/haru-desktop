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
  let clock = 1_000_000, heardN = 0; const asked: string[] = [], shown: string[] = [], lines: string[] = [];
  const speaker = { enabled: true, check: async () => ({ allow: true, enforcing: true, speaker: 'owner', reason: 'voice_match', notice: null }),
    confirm: async () => ({ current: true }), notice: async () => ({ notice: null }), frame: async () => ({ audio: '', allow: true }), frameBytes: 6400, maxPendingBytes: 128000, close() {} } as any;
  const deps: LocalCallDeps = { ...(filterOn ? { speaker } : {}), hear: async () => (++heardN === 1 ? 'I went to the shops yesterday' : 'and bought a lamp'),
    answer: (text: string, o: any) => { asked.push(text); if (asked.length === 1 && firstReplies) o.onSentence('Sure. ', 'neutral');
      if (asked.length === 1 && firstActs === 'acted') o.onActed(); if (asked.length === 1 && firstActs === 'tool') o.onToolCall('remember'); return new Promise(() => {}); },
    speak: async () => ({ stream: new ReadableStream({ start() {} }), sampleRate: 24000 }), filler: () => '', moodNow: () => 'neutral', said: () => {}, now: () => clock,
    vad: { endAfterMs: 500 }, log: (l: string) => lines.push(l) } as any;
  const c = openLocalCall({ onEvent: e => { if (e.type === 'user_message') shown.push((e as any).text); }, onAudio: () => {}, onClose: () => {} }, deps);
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / FRAME_MS; i++) { c.feed(frame(level)); clock += FRAME_MS; } };
  return { c, asked, shown, lines, feed };
}

for (const filterOn of [true, false]) {
  test(`filter ${filterOn ? 'on' : 'off'}: a turn dropped before any reply joins his next words`, async () => {
    const h = call(filterOn, false);
    h.feed(0.002, 1000); h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
    assert.deepEqual(h.asked, ['I went to the shops yesterday']);
    h.feed(0.3, 1000); h.feed(0.002, 700); await settle();
    assert.equal(h.asked.at(-1), 'I went to the shops yesterday and bought a lamp');
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

test('main.ts: every durable write of a call turn is behind an abort check and signals that the turn acted', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  const between = (a: string, b: string) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert.ok(i > 0 && j > i, `${a} .. ${b}`); return src.slice(i, j); };
  // turn entry: check, then the ticks, then acted if any agenda write committed
  const entry = between('signal?.throwIfAborted();\n  const agendaWritesAtEntry = agendaWrites;', 'if (agendaWrites !== agendaWritesAtEntry) onActed?.();');
  for (const step of ['tickOffSpoken(latest)', 'startedSpoken(latest)', 'putOffSpoken(latest)', 'noteTheyAccounted(latest)']) assert.ok(entry.includes(step), step);
  assert.ok(!/await /.test(entry), 'nothing awaited between the check and the writes');
  const direct = between("signal?.throwIfAborted();   // 3770: see the turn-entry note\n    const packet=corePolicySync<any>('agenda-life.directReminder'", 'if(packet.plan)onActed?.();');
  assert.ok(!/await /.test(direct));
  const fin = between("signal?.throwIfAborted();   // 3770: see the turn-entry note\n    const packet=corePolicySync<any>('agenda-life.final'", 'if(packet.plan)onActed?.();');
  assert.ok(!/await /.test(fin));
  assert.ok(src.includes("signal?.throwIfAborted();   // 3770: a dropped turn runs no tool (it would run again in the merged turn)\n      onToolCall?.(tool);"));
  assert.ok(/function ownedAgendaChanged\(packet:any\)\{\n  if\(packet\.plan\)agendaWrites\+\+;/.test(src));
  assert.equal(src.split('options?.signal?.throwIfAborted();   // 3770: a dropped call turn posts nothing').length - 1, 3);
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
