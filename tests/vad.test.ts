// The server's copy of the phone's voice activity detector. The first test is
// the page's own (tests/webpage.test.ts), so the two cannot drift apart quietly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVad, pcm16Level, type VadEvent } from '../electron/vad';

test('speech is a level well above the room held for a beat, and ends after a stretch of quiet', () => {
  const vad = makeVad();
  const events: VadEvent[] = [];
  let t = 0;
  const feed = (level: number, ms: number, ratio?: number) => { for (let i = 0; i < ms / 30; i++) { t += 30; const ev = vad.feed(level, t, ratio); if (ev) events.push(ev); } };
  feed(0.002, 3000);
  assert.ok(vad.floor() < 0.003, 'the floor settles on the room');
  feed(0.02, 60); feed(0.002, 300);
  assert.equal(events.length, 0, 'a blip too short to start');
  feed(0.03, 500);
  assert.equal(events[0].type, 'start');
  assert.equal(vad.speaking(), true);
  feed(0.002, 800);
  const end = events[1] as { type: string; from: number; to: number; ms: number };
  assert.equal(end.type, 'end');
  assert.ok(end.ms >= 400 && end.ms <= 600 && end.from < end.to, `an utterance of ${end.ms}ms`);
  assert.equal(vad.speaking(), false);
  feed(0.03, 200); feed(0.002, 800);
  assert.equal(events[3].type, 'drop', 'too short to have been words');
  feed(0.03, 16000);
  const cut = events.filter(e => e.type === 'end').at(-1) as unknown as { ms: number };
  assert.ok(cut.ms >= 14900 && cut.ms <= 15100, `a monologue is cut at the limit, not ${cut.ms}ms`);
  const quiet = makeVad(); let tt = 0; for (let i = 0; i < 100; i++) { tt += 30; quiet.feed(0.002, tt); }
  assert.equal(quiet.feed(0.012, tt + 30, 7), null, 'with the ratio raised for her turn, that is not loud enough');
});

test('a shorter quiet ends the turn sooner, for a call', () => {
  const vad = makeVad({ endAfterMs: 500 });
  let t = 0;
  const events: VadEvent[] = [];
  const feed = (level: number, ms: number) => { for (let i = 0; i < ms / 20; i++) { t += 20; const ev = vad.feed(level, t); if (ev) events.push(ev); } };
  feed(0.002, 2000); feed(0.03, 800);
  const spoke = t;
  feed(0.002, 400);
  assert.equal(events.filter(e => e.type === 'end').length, 0, 'not over at 400 ms of quiet');
  feed(0.002, 200);
  const end = events.find(e => e.type === 'end') as { to: number } | undefined;
  assert.ok(end, 'over by 600 ms of quiet');
  assert.ok(end.to <= spoke + 120, 'the utterance ends where the voice stopped, not where the quiet was noticed');
});

test('the level of a PCM frame is its RMS on the page\'s scale', () => {
  const silence = new Uint8Array(640);
  assert.equal(pcm16Level(silence), 0);
  const loud = new Int16Array(320);
  for (let i = 0; i < loud.length; i++) loud[i] = i % 2 ? 16384 : -16384;
  const level = pcm16Level(new Uint8Array(loud.buffer));
  assert.ok(Math.abs(level - 0.5) < 0.001, `half scale is 0.5, not ${level}`);
  assert.equal(pcm16Level(new Uint8Array(0)), 0);
  // A view into a bigger buffer reads only its own bytes.
  const big = new Uint8Array(1000); big.set(new Uint8Array(loud.buffer), 100);
  assert.ok(Math.abs(pcm16Level(big.subarray(100, 740)) - 0.5) < 0.001);
});
