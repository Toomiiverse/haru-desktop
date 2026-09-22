// When she plays, and when she stops — the rules that are wrong invisibly.
//
// A gate that never opens and one that opens every minute both look, from
// outside, like "she plays Minecraft sometimes". Neither throws. So each rule
// is tested from both sides of its boundary, and the one that matters most —
// him speaking ends it, at once — is tested against every other reason a
// session might continue.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPlayConfig, DEFAULT_PLAY, whyNotStart, wantsToStart, newSession, whyStop, heSpoke,
  shouldAsk, noteTick, summarise, minutesPlayed, windDown, heardInGame, whyNotJoinHim,
  type Situation, type PlayConfig,
} from '../electron/minecraftlife';

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;

const ON: PlayConfig = { ...DEFAULT_PLAY, enabled: true };

/** A quiet afternoon: he spoke an hour ago, she is awake and in the world. */
const idle = (over: Partial<Situation> = {}): Situation => ({
  now: NOW,
  lastUserActivityAt: NOW - 60 * MINUTE,
  asleep: false,
  knockedAwake: false,
  speaking: false,
  inCall: false,
  workerUp: true,
  inWorld: true,
  bodyBusy: null,
  sessionsToday: 0,
  ...over,
});

// -- config --------------------------------------------------------------------

test('playing on her own is off until switched on', () => {
  assert.equal(readPlayConfig(undefined).enabled, false);
  assert.equal(readPlayConfig({}).enabled, false);
  assert.equal(readPlayConfig({ enabled: 'yes' }).enabled, false);
  assert.equal(readPlayConfig({ enabled: true }).enabled, true);
});

test('readPlayConfig clamps rather than trusting', () => {
  const read = readPlayConfig({ idleMinutes: -5, sessionMinutes: 9_999, tickSeconds: 1, oddsPerTick: 7, maxWaits: 0, maxPerDay: 'lots' });
  assert.equal(read.idleMinutes, 1);
  assert.equal(read.sessionMinutes, 6 * 60);
  assert.equal(read.tickSeconds, 20, 'a tick under twenty seconds is a metronome');
  assert.equal(read.oddsPerTick, 1);
  assert.equal(read.maxWaits, 1);
  assert.equal(read.maxPerDay, DEFAULT_PLAY.maxPerDay);
});

// -- the gate ------------------------------------------------------------------

test('an idle afternoon with everything on is her time', () => {
  assert.equal(whyNotStart(idle(), ON), null);
});

test('switched off means off, before anything else is looked at', () => {
  assert.match(whyNotStart(idle(), DEFAULT_PLAY)!, /switched off/);
});

test('every reason not to start names itself', () => {
  assert.match(whyNotStart(idle({ workerUp: false }), ON)!, /worker is not running/);
  assert.match(whyNotStart(idle({ inWorld: false }), ON)!, /not in the world/);
  assert.match(whyNotStart(idle({ asleep: true }), ON)!, /asleep/);
  assert.match(whyNotStart(idle({ knockedAwake: true }), ON)!, /knocked awake/);
  assert.match(whyNotStart(idle({ speaking: true }), ON)!, /mid-sentence/);
  assert.match(whyNotStart(idle({ inCall: true }), ON)!, /on a call/);
  assert.match(whyNotStart(idle({ sessionsToday: 3 }), ON)!, /3 times today/);
});

test('the idle threshold is a threshold, from both sides', () => {
  const needed = ON.idleMinutes * MINUTE;
  assert.match(whyNotStart(idle({ lastUserActivityAt: NOW - needed + 1 }), ON)!, /talking to her .* min ago/);
  assert.equal(whyNotStart(idle({ lastUserActivityAt: NOW - needed }), ON), null);
  // Never spoken to at all is as idle as it gets.
  assert.equal(whyNotStart(idle({ lastUserActivityAt: 0 }), ON), null);
});

test('the dice are a chance, not a rota', () => {
  assert.equal(wantsToStart(idle(), ON, 0), true);
  assert.equal(wantsToStart(idle(), ON, ON.oddsPerTick - 0.001), true);
  assert.equal(wantsToStart(idle(), ON, ON.oddsPerTick), false);
  assert.equal(wantsToStart(idle(), ON, 0.99), false);
  // No roll opens a closed gate.
  assert.equal(wantsToStart(idle({ asleep: true }), ON, 0), false);
});

// -- ending ---------------------------------------------------------------------

test('him speaking ends the session at once, whatever else is true', () => {
  const session = newSession(NOW, NOW - 60 * MINUTE);
  // Any activity after the session began.
  const spoke = idle({ now: NOW + 3 * MINUTE, lastUserActivityAt: NOW + 2 * MINUTE });
  assert.equal(heSpoke(session, spoke), true);
  assert.equal(whyStop(session, spoke, ON), 'he started talking to her');
  // Activity from *before* the session is not a yield — it is why she waited.
  const quiet = idle({ now: NOW + 3 * MINUTE, lastUserActivityAt: NOW - 60 * MINUTE });
  assert.equal(heSpoke(session, quiet), false);
  assert.equal(whyStop(session, quiet, ON), null);
});

test('him first: his speaking outranks every other reason to stop', () => {
  // A session at its cap AND he spoke: the reason given is him. The log should
  // say what actually happened, and what actually happened is that he spoke.
  const old = newSession(NOW - 60 * MINUTE, NOW - 120 * MINUTE);
  const both = idle({ now: NOW, lastUserActivityAt: NOW - MINUTE });
  assert.equal(whyStop({ ...old, waits: 99 }, both, ON), 'he started talking to her');
});

test('the session cap is wall-clock', () => {
  const session = newSession(NOW, NOW - 60 * MINUTE);
  const cap = ON.sessionMinutes * MINUTE;
  assert.equal(whyStop(session, idle({ now: NOW + cap - MINUTE, lastUserActivityAt: NOW - 60 * MINUTE }), ON), null);
  assert.match(whyStop(session, idle({ now: NOW + cap, lastUserActivityAt: NOW - 60 * MINUTE }), ON)!, /played for 45 minutes/);
});

test('waiting too many times running means there is nothing to do', () => {
  let session = newSession(NOW, NOW - 60 * MINUTE);
  const later = idle({ now: NOW + 5 * MINUTE, lastUserActivityAt: NOW - 60 * MINUTE });
  for (let i = 0; i < ON.maxWaits - 1; i++) session = noteTick(session, { kind: 'wait' });
  assert.equal(whyStop(session, later, ON), null, 'one short of the limit carries on');
  session = noteTick(session, { kind: 'wait' });
  assert.match(whyStop(session, later, ON)!, /waited 3 times running/);
});

test('a decision resets the waits; a failure counts as one', () => {
  let session = newSession(NOW, 0);
  session = noteTick(session, { kind: 'wait' });
  session = noteTick(session, { kind: 'wait' });
  assert.equal(session.waits, 2);
  session = noteTick(session, { kind: 'do', skill: 'collectBlock' });
  assert.equal(session.waits, 0);
  assert.deepEqual(session.did, ['collectBlock']);
  // A skill that failed is not progress, and three of them in a row is a
  // session going nowhere.
  session = noteTick(session, { kind: 'failed', skill: 'moveTo' });
  assert.equal(session.waits, 1);
  assert.deepEqual(session.did, ['collectBlock', 'moveTo (failed)']);
  assert.equal(session.ticks, 4);
});

test('losing the world ends the session', () => {
  // quietSince matches the fixture's last activity: these are not yields.
  const session = newSession(NOW, NOW - 60 * MINUTE);
  assert.match(whyStop(session, idle({ inWorld: false }), ON)!, /no longer in the world/);
  assert.match(whyStop(session, idle({ workerUp: false }), ON)!, /no longer in the world/);
  assert.match(whyStop(session, idle({ asleep: true }), ON)!, /fell asleep/);
  assert.match(whyStop(session, idle({ inCall: true }), ON)!, /call started/);
});

// -- ticking --------------------------------------------------------------------

test('a tick does not ask over a running skill', () => {
  // A new plan supersedes the running one. Planning over a three-minute
  // collectBlock would cancel it every tick, forever.
  const busy = shouldAsk(idle({ bodyBusy: 'collectBlock' }));
  assert.equal(busy.ask, false);
  if (!busy.ask) assert.match(busy.because, /still collectBlock/);
  assert.equal(shouldAsk(idle()).ask, true);
});

test('did is bounded', () => {
  let session = newSession(NOW, 0);
  for (let i = 0; i < 100; i++) session = noteTick(session, { kind: 'do', skill: `skill${i}` });
  assert.equal(session.did.length, 40);
  assert.equal(session.did[0], 'skill60');
});

// -- the summary ----------------------------------------------------------------

test('summarise reads as an evening, not a transcript', () => {
  let session = newSession(NOW, 0);
  for (const name of ['collectBlock', 'collectBlock', 'collectBlock', 'returnHome', 'depositItems', 'sleep']) {
    session = noteTick(session, { kind: 'do', skill: name });
  }
  assert.equal(summarise(session, NOW + 23 * MINUTE), 'played for 23 min: collectBlock ×3, returnHome, depositItems, sleep');
  assert.equal(summarise(newSession(NOW, 0), NOW + 4 * MINUTE), 'played for 4 min and did nothing much');
  assert.equal(minutesPlayed(newSession(NOW, 0), NOW - MINUTE), 0, 'never negative');
});

// -- winding down ------------------------------------------------------------------

test('winding down stops, checkpoints, and gets her somewhere safe', () => {
  const steps = windDown({ reason: 'he started talking to her', lastDecision: 'collectBlock {"type":"spruce_log"}', hasHome: true, nearHome: false, night: true });
  assert.deepEqual(steps.map(step => step.skill), ['stopMoving', 'checkpoint', 'returnHome']);
  // Not "sleep": she is far from home, and a bed is at home. The walk comes first.
  assert.match(String(steps[1].args.note), /stopped \(he started talking to her\) after: collectBlock/);
});

test('winding down at home at night goes to bed', () => {
  assert.deepEqual(
    windDown({ reason: 'cap', lastDecision: '', hasHome: true, nearHome: true, night: true }).map(step => step.skill),
    ['stopMoving', 'checkpoint', 'sleep'],
  );
});

test('winding down in the day, or with no home, does the minimum', () => {
  assert.deepEqual(
    windDown({ reason: 'cap', lastDecision: '', hasHome: true, nearHome: true, night: false }).map(step => step.skill),
    ['stopMoving', 'checkpoint'],
  );
  // No home: nowhere to walk to, but a bed nearby is still worth trying at night.
  assert.deepEqual(
    windDown({ reason: 'cap', lastDecision: '', hasHome: false, nearHome: false, night: true }).map(step => step.skill),
    ['stopMoving', 'checkpoint', 'sleep'],
  );
});

test('the checkpoint note is bounded', () => {
  const steps = windDown({ reason: 'cap', lastDecision: 'x'.repeat(1_000), hasHome: false, nearHome: false, night: false });
  assert.ok(String(steps[1].args.note).length <= 200);
});

// -- playing together ---------------------------------------------------------------

test('him talking to her in the game is not a yield', () => {
  // In-game chat goes through the same brain and bumps his activity clock. Read
  // naively that ends the session; re-based, it is him playing with her.
  let session = newSession(NOW, NOW - 60 * MINUTE);
  const spokeInGame = NOW + 2 * MINUTE;
  session = heardInGame(session, spokeInGame);
  const now = idle({ now: NOW + 3 * MINUTE, lastUserActivityAt: spokeInGame });
  assert.equal(heSpoke(session, now), false);
  assert.equal(whyStop(session, now, ON), null);
  // ...but speaking to her *after* that, elsewhere, still is.
  const later = idle({ now: NOW + 5 * MINUTE, lastUserActivityAt: NOW + 4 * MINUTE });
  assert.equal(whyStop(session, later, ON), 'he started talking to her');
});

test('heardInGame never moves the mark backwards', () => {
  const session = newSession(NOW, NOW);
  assert.equal(heardInGame(session, NOW - 60 * MINUTE).quietSince, NOW);
});

test('him arriving is an invitation: no idle rule, no dice, no daily cap', () => {
  // He spoke a minute ago (elsewhere), she has played three times today, and
  // the dice do not enter into it. He is in Minecraft; that is where he wants her.
  const busyDay = idle({ lastUserActivityAt: NOW - MINUTE, sessionsToday: 3 });
  assert.match(whyNotStart(busyDay, ON)!, /times today|talking/);
  assert.equal(whyNotJoinHim(busyDay, ON), null);
});

test('the hard reasons still hold when he arrives', () => {
  assert.match(whyNotJoinHim(idle(), DEFAULT_PLAY)!, /switched off/);
  assert.match(whyNotJoinHim(idle({ workerUp: false }), ON)!, /worker/);
  assert.match(whyNotJoinHim(idle({ inWorld: false }), ON)!, /not in the world/);
  assert.match(whyNotJoinHim(idle({ asleep: true }), ON)!, /asleep/);
  assert.match(whyNotJoinHim(idle({ inCall: true }), ON)!, /call/);
  // Knocked awake is not a reason: he woke her and then went into the game.
  assert.equal(whyNotJoinHim(idle({ knockedAwake: true }), ON), null);
});
