// Being asked to be quiet: what counts as the ask, and which way she goes.
//
// The two scenes he described (2026-09-19) are the fixtures: a happy day and
// "mute please, there's others around" gets a yes; a bad day and a bare "mute"
// gets a no, whatever the roll.

import test from 'node:test';
import assert from 'node:assert/strict';
import { breaksMute, isMuted, muteNote, readMuteAsk, weighMute, type Feeling } from '../electron/mute';

const happy: Feeling = { irritation: 0, grudge: 13, vitals: { happiness: 0.9, affection: 0.8, stress: 0.1 } };
const mad: Feeling = { irritation: 78, grudge: 80, vitals: { happiness: 0.35, affection: 0.5, stress: 0.5 } };
const ordinary: Feeling = { irritation: 11, grudge: 40, vitals: { happiness: 0.6, affection: 0.6, stress: 0.2 } };

test('the ask is read off short messages, with the reason he gave', () => {
  assert.deepEqual(readMuteAsk("Hey Haru, mute please, there's others around"), { kind: 'mute', polite: true, reason: { what: 'company', said: 'others around', minutes: 90 } });
  assert.equal(readMuteAsk('shush')?.reason, null);
  assert.equal(readMuteAsk('be quiet, I am in a meeting for 20 minutes')?.reason?.minutes, 20);
  assert.equal(readMuteAsk('quiet down, everyone is asleep')?.reason?.what, 'sleeping');
  assert.equal(readMuteAsk('ok you can talk again')?.kind, 'unmute');
  assert.equal(readMuteAsk('unmute')?.kind, 'unmute');
});

test('talk about muting something else is not an ask', () => {
  assert.equal(readMuteAsk('I muted the TV so I could hear you'), null);
  assert.equal(readMuteAsk('mute the group chat for me'), null);
  assert.equal(readMuteAsk('she told me to shut up in front of everyone'), null);
  assert.equal(readMuteAsk('what are you watching tonight'), null);
  assert.equal(readMuteAsk(`${'so then '.repeat(20)} he said be quiet`), null);
});

test('a happy day and a polite reason: she goes quiet, on any roll', () => {
  const ask = readMuteAsk("Hey Haru, mute please, there's others around")!;
  for (const roll of [0, 0.5, 1]) assert.equal(weighMute(ask, happy, roll).agreed, true);
  const decision = weighMute(ask, happy, 0.5);
  assert.ok(decision.minutes >= 90, `she holds it at least as long as the situation (${decision.minutes})`);
  assert.match(muteNote(ask, decision), /decided to do it/);
});

test('a bad day: no, bare or reasoned, on any roll', () => {
  for (const said of ['hey Haru, mute', "mute please, there's others around"]) {
    for (const roll of [0, 0.5, 1]) assert.equal(weighMute(readMuteAsk(said)!, mad, roll).agreed, false, said);
  }
  assert.match(muteNote(readMuteAsk('hey Haru, mute')!, weighMute(readMuteAsk('hey Haru, mute')!, mad, 0.5)), /decided not to/);
});

test('an ordinary day: the reason is what carries it', () => {
  assert.equal(weighMute(readMuteAsk('shush')!, ordinary, 0.5).agreed, false);
  assert.equal(weighMute(readMuteAsk('can you be quiet please, I am on a call')!, ordinary, 0.5).agreed, true);
});

test('the quiet ends on its own: by the clock, or by her temper', () => {
  const state = { since: 0, until: 60 * 60_000, reason: 'others around' };
  assert.equal(isMuted(state, 30 * 60_000), true);
  assert.equal(breaksMute(state, 30 * 60_000, 1), null);
  assert.equal(breaksMute(state, 30 * 60_000, 67), 'temper');
  assert.equal(breaksMute(state, 61 * 60_000, 0), 'time');
  assert.equal(isMuted(state, 61 * 60_000), false);
  assert.equal(breaksMute(null, 0, 100), null);
});

test('hurt, or left alone all day, she is less obliging — and says which', () => {
  const ask = readMuteAsk('can you be quiet please, I am on a call')!;
  assert.equal(weighMute(ask, ordinary, 0.5).agreed, true);
  const sore = weighMute(ask, { ...ordinary, hurt: 80, missing: 80 }, 0.5);
  assert.equal(sore.agreed, false);
  assert.match(sore.why, /barely spoken to you all day/);
  assert.match(weighMute(readMuteAsk('shush')!, { ...ordinary, hurt: 70 }, 0.5).why, /hurt you recently/);
});

test('one order too many: handled all day, a fair ask stops being a certainty', () => {
  const ask = readMuteAsk('can you be quiet please, I am on a call')!;
  // A polite reason carries an ordinary day whatever the roll...
  for (const roll of [0, 0.5, 1]) assert.equal(weighMute(ask, ordinary, roll).agreed, true);
  // ...and once she has been told what to do all day, it is a coin she can lose.
  const handled = [0, 0.1, 0.18].map(roll => weighMute(ask, { ...ordinary, hemmed: 85 }, roll));
  assert.ok(handled.every(one => !one.agreed), 'a bad roll now refuses a fair ask');
  assert.match(handled[0].why, /nothing but tell you what to do/);
  assert.equal(weighMute(ask, { ...ordinary, hemmed: 85 }, 0.9).agreed, true, 'and a good one still agrees');
  // A bare order on top of a day of them does not get through at all.
  for (const roll of [0, 0.5, 1]) assert.equal(weighMute(readMuteAsk('shush')!, { ...ordinary, hemmed: 85 }, roll).agreed, false);
});
