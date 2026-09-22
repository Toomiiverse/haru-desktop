// The planner, and the one property it has to keep.
//
// A model deciding what her body does is only safe because it can *choose* and
// cannot *compose*: it names one thing from a list, or it waits. Every test in
// the first half is a way an answer could try to be something other than a
// name from the list — prose, a fence, a shell command, a skill she may not
// pick on her own — and every one of them must read as "wait".
//
// The second half is the world in words. A model handed JSON reasons about the
// JSON; handed a paragraph it reasons about the world, so the paragraph has to
// say the things a decision turns on and nothing else.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPlan, planInstruction, describeWorld, minecraftNote, describePlan,
  isSkillName, SKILLS, SKILL_NAMES, AUTONOMOUS_SKILLS,
} from '../electron/minecraftplan';
import type { MinecraftObservation } from '../electron/minecraft';

const online = (over: Partial<MinecraftObservation> = {}): MinecraftObservation => ({
  state: 'online',
  at: '2026-09-10T00:00:00.000Z',
  self: { name: 'Haru', position: { x: 124, y: 68, z: -84 }, dimension: 'overworld', health: 20, food: 20, time: 'day', raining: false, asleep: false },
  nearby: { players: [] },
  intent: { kind: 'idle' },
  inventory: {},
  freeSlots: 30,
  currentProject: null,
  where: null,
  home: null,
  knownNearby: [],
  ...over,
});

const offline = (over: Partial<MinecraftObservation> = {}): MinecraftObservation =>
  ({ ...online(), state: 'reconnecting', self: null, ...over });

// -- the answer is a name from the list, or it is a wait -----------------------

test('a well-formed choice is read as one', () => {
  const plan = readPlan('{"skill": "collectBlock", "args": {"type": "spruce_log", "amount": 16}, "why": "the roof needs it"}');
  assert.equal(plan.kind, 'do');
  if (plan.kind !== 'do') return;
  assert.equal(plan.skill, 'collectBlock');
  assert.deepEqual(plan.args, { type: 'spruce_log', amount: 16 });
  assert.equal(plan.why, 'the roof needs it');
});

test('an explicit wait is a wait, with its reason', () => {
  const plan = readPlan('{"wait": true, "why": "it is night and I am at home"}');
  assert.deepEqual(plan, { kind: 'wait', why: 'it is night and I am at home' });
});

test('prose is a wait, not an attempt to read intent out of it', () => {
  // The model saying what it would like to do is not the same as naming it.
  for (const answer of [
    'I think I should go and collect some spruce logs for the roof.',
    'Sure! Let me follow Tommy.',
    '',
    'collectBlock spruce_log 16',
  ]) {
    const plan = readPlan(answer);
    assert.equal(plan.kind, 'wait', `"${answer}" should be a wait`);
    assert.match(plan.why, /no decision/);
  }
});

test('a fenced or prefixed answer is still read', () => {
  // Models wrap JSON in ```json and prefix it with "Sure!". Both are the same
  // decision and it would be silly to lose it to punctuation.
  for (const wrapped of [
    '```json\n{"skill": "eat", "args": {}, "why": "hungry"}\n```',
    'Sure, here is my decision:\n{"skill": "eat", "args": {}, "why": "hungry"}',
    '{"skill": "eat", "args": {}, "why": "hungry"} — that is what I will do.',
  ]) {
    const plan = readPlan(wrapped);
    assert.equal(plan.kind, 'do', `should have read: ${wrapped}`);
    if (plan.kind === 'do') assert.equal(plan.skill, 'eat');
  }
});

test('a name that is not on the list is a wait, and says which name', () => {
  const plan = readPlan('{"skill": "rm -rf /", "args": {}}');
  assert.equal(plan.kind, 'wait');
  assert.match(plan.why, /rm -rf \//);
  assert.match(plan.why, /not something her body can do/);
  // And a plausible-looking one the worker does not have.
  assert.equal(readPlan('{"skill": "buildHouse", "args": {}}').kind, 'wait');
  assert.equal(readPlan('{"skill": "eval", "args": {"code": "1+1"}}').kind, 'wait');
});

test('skills she may not choose on her own are waits when planning', () => {
  // Leaving the server is the scheduler's call; forgetting a place has no undo.
  for (const held of ['stop', 'forgetPlace']) {
    const plan = readPlan(`{"skill": "${held}", "args": {}, "why": "because"}`);
    assert.equal(plan.kind, 'wait', `${held} should not be hers to decide alone`);
    assert.match(plan.why, /not hers to decide/);
  }
  // ...but they are real skills, reachable when she is told to.
  assert.equal(readPlan('{"skill": "stop", "args": {}}', SKILL_NAMES).kind, 'do');
});

test('malformed JSON and non-objects are waits', () => {
  assert.equal(readPlan('{"skill": "eat", "args": {').kind, 'wait');
  assert.equal(readPlan('{"skill": 42}').kind, 'wait');
  assert.equal(readPlan('{"skill": null}').kind, 'wait');
  assert.equal(readPlan('{}').kind, 'wait');
});

test('a decision wrapped in a list is still the decision', () => {
  // The outermost braces are taken, so a model that puts its one answer in an
  // array has still named one thing from the list. Lenient, and safe for the
  // same reason everything else here is: it can only ever be a listed name.
  const plan = readPlan('[{"skill": "eat", "args": {}, "why": "hungry"}]');
  assert.equal(plan.kind, 'do');
  if (plan.kind === 'do') assert.equal(plan.skill, 'eat');
});

test('arguments are bounded and cleaned before they travel', () => {
  const plan = readPlan(JSON.stringify({
    skill: 'moveTo',
    args: {
      x: 1, y: 70, z: 2,
      note: 'x'.repeat(5_000),
      __proto__: { polluted: true },
      'not a key!': 1,
      nested: { deep: { deeper: { deepest: 'too far' } } },
      fn: 'function() {}',
    },
  }));
  assert.equal(plan.kind, 'do');
  if (plan.kind !== 'do') return;
  assert.equal((plan.args.note as string).length, 200);
  assert.equal('not a key!' in plan.args, false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan.args, 'polluted'), false);
  // Nesting stops at two levels.
  const nested = plan.args.nested as Record<string, unknown>;
  const deep = nested.deep as Record<string, unknown>;
  assert.equal('deeper' in deep, false);
});

test('why is trimmed and never enormous', () => {
  const plan = readPlan(`{"skill": "eat", "args": {}, "why": "${'because '.repeat(100)}"}`);
  assert.equal(plan.kind, 'do');
  if (plan.kind === 'do') assert.ok(plan.why.length <= 200);
});

test('the skill list agrees with itself', () => {
  assert.equal(new Set(SKILL_NAMES).size, SKILL_NAMES.length);
  for (const name of SKILL_NAMES) assert.ok(isSkillName(name));
  assert.equal(isSkillName('summon_a_horse'), false);
  assert.equal(isSkillName('constructor'), false, 'prototype names are not skills');
  assert.equal(AUTONOMOUS_SKILLS.length, SKILL_NAMES.length - 2);
  assert.ok(Object.values(SKILLS).every(text => text.length > 0), 'every skill has a description for the model');
});

// -- the world in words ---------------------------------------------------------

test('describeWorld says where, how, who and what — as sentences', () => {
  const text = describeWorld(online({
    where: 'at home',
    nearby: { players: ['Tommy'] },
    inventory: { spruce_log: 18, bread: 4, iron_pickaxe: 1 },
    currentProject: 'Build home (in progress, 1/3 done) — now: collect 32 spruce logs (18/32)',
    intent: { kind: 'following', player: 'Tommy', range: 3 },
    knownNearby: ['the store chest (6 away)'],
  }), 'Tommy');
  assert.match(text, /She is at home in the overworld, day\./);
  assert.match(text, /Tommy is here\./);
  assert.match(text, /following Tommy/);
  assert.match(text, /Carrying 18 spruce log, 4 bread, 1 iron pickaxe\./);
  assert.match(text, /Known places near her: the store chest \(6 away\)\./);
  assert.match(text, /Working on: Build home/);
  assert.ok(!text.includes('{'), 'no JSON in the world description');
});

test('describeWorld says how she is only when it matters', () => {
  assert.ok(!describeWorld(online(), 'Tommy').includes('She is hurt'));
  assert.match(describeWorld(online({ self: { ...online().self!, health: 5, food: 4 } }), 'Tommy'), /badly hurt \(5\/20\), very hungry \(4\/20\)/);
  assert.match(describeWorld(online({ self: { ...online().self!, health: 12 } }), 'Tommy'), /hurt \(12\/20\)/);
});

test('describeWorld tells his presence from a stranger\'s', () => {
  assert.match(describeWorld(online({ nearby: { players: ['Tommy', 'Steve'] } }), 'Tommy'), /Tommy is here, and so is Steve\./);
  assert.match(describeWorld(online({ nearby: { players: ['Steve'] } }), 'Tommy'), /Steve is nearby\./);
  // Case does not matter to whose name it is.
  assert.match(describeWorld(online({ nearby: { players: ['tommy'] } }), 'Tommy'), /tommy is here/);
});

test('describeWorld off the server says so, and keeps the project', () => {
  assert.equal(describeWorld(offline(), 'Tommy'), 'She is not in the world right now (reconnecting).');
  assert.match(describeWorld(offline({ currentProject: 'Build home (paused)' }), 'Tommy'), /Her project is waiting: Build home/);
});

test('describeWorld falls back to coordinates when she is nowhere named', () => {
  assert.match(describeWorld(online({ where: null }), 'Tommy'), /She is at 124, 68, -84/);
});

test('describeWorld warns about a nearly full inventory', () => {
  assert.match(describeWorld(online({ inventory: { dirt: 64 }, freeSlots: 2 }), 'Tommy'), /only 2 free slots/);
  assert.ok(!describeWorld(online({ inventory: { dirt: 64 }, freeSlots: 20 }), 'Tommy').includes('free slots'));
});

// -- the instruction ------------------------------------------------------------

test('planInstruction is her identity, the world, the list, and the shape of an answer', () => {
  const text = planInstruction(online({ where: 'at home' }), { identity: 'You are Haru. IDENTITY-MARKER', ownerName: 'Tommy' });
  assert.match(text, /^You are Haru\. IDENTITY-MARKER/, 'her own identity block, first');
  assert.match(text, /She is at home/);
  for (const name of AUTONOMOUS_SKILLS) assert.ok(text.includes(`- ${name}:`), `${name} must be on the list`);
  assert.ok(!text.includes('- stop:'), 'leaving is not on the autonomous list');
  assert.ok(!text.includes('- forgetPlace:'));
  assert.match(text, /\{"skill": "<name from the list>"/);
  assert.match(text, /\{"wait": true/);
  assert.match(text, /If nothing on the list fits, wait\./);
});

test('planInstruction carries what she last did and what last failed', () => {
  const text = planInstruction(online(), {
    identity: 'id', ownerName: 'Tommy',
    lastDecision: 'collectBlock {"type":"spruce_log"}',
    lastFailure: 'no spruce_log within 48 blocks',
  });
  assert.match(text, /You last decided: collectBlock/);
  assert.match(text, /That did not work: no spruce_log within 48 blocks\. Do something different\./);
});

test('planInstruction has no Minecraft personality of its own', () => {
  // She is one Haru. The only voice in the instruction is her identity block.
  const text = planInstruction(online(), { identity: 'id', ownerName: 'Tommy' });
  assert.ok(!/you are a (minecraft )?bot/i.test(text));
  assert.ok(!/your personality/i.test(text));
  assert.ok(!/cheerful|helpful assistant/i.test(text));
});

test('planInstruction puts his company above the project', () => {
  assert.match(planInstruction(online(), { identity: 'id', ownerName: 'Tommy' }), /If your person is here, being with them beats any project/);
});

// -- the line in her own-life block ---------------------------------------------

test('minecraftNote is one line when she is in the world', () => {
  const note = minecraftNote(online({
    where: 'at home',
    nearby: { players: ['Tommy'] },
    intent: { kind: 'following', player: 'Tommy' },
    currentProject: 'Build home (in progress, 1/3 done)',
  }), true);
  assert.match(note, /^- In Minecraft right now: at home, following Tommy, Tommy is there\. Working on: Build home/);
  assert.equal(note.split('\n').length, 1);
});

test('minecraftNote keeps the project in front of her while she is off the server', () => {
  // Or she answers "what are you building" from nothing.
  assert.match(minecraftNote(offline({ currentProject: 'Build home (paused)' }), false), /^- Your Minecraft project is waiting for you: Build home/);
});

test('minecraftNote says nothing when there is nothing to say', () => {
  assert.equal(minecraftNote(null, false), '');
  assert.equal(minecraftNote(offline(), true), '');
  assert.equal(minecraftNote(offline(), false), '');
});

// -- the log line ---------------------------------------------------------------

test('describePlan reads as one line', () => {
  assert.equal(describePlan({ kind: 'wait', why: 'night' }), 'wait — night');
  assert.equal(describePlan({ kind: 'do', skill: 'eat', args: {}, why: 'hungry' }), 'eat — hungry');
  assert.equal(describePlan({ kind: 'do', skill: 'followPlayer', args: { name: 'Tommy' }, why: '' }), 'followPlayer {"name":"Tommy"}');
});
