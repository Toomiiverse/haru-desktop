import test from 'node:test';
import assert from 'node:assert/strict';
import { addAside, readAsides } from '../electron/asides';
import { pickToBringUp } from '../electron/bored';
import { interestTopic, NUDGE_TOPIC_COOLDOWN_MS, nudgeContinuity, nudgePrompt, publishNudge, readNudge, readNudgeReview, recentNudgeTopics, taskTopic } from '../electron/nudges';

const now = Date.parse('2026-09-27T12:00:00Z');

test('an accepted topic stays out of the draw after saving, restarting and reading the asides', () => {
  const written = addAside([], 'How is the shop going?', 'idle', new Date(now - 60_000), '2026-09-27', '', 'shop').asides;
  const restored = readAsides(JSON.parse(JSON.stringify(written)));
  const memories = [
    { id: 'shop', text: 'Runs a computer shop with a friend.', importance: 1 },
    { id: 'music', text: 'Has been learning to play the bass.', importance: 0.5 },
  ];
  const topics = recentNudgeTopics(restored, now);
  assert.deepEqual([...topics], ['shop']);
  assert.equal(pickToBringUp(memories, [], [], '2026-09-27', () => 0, topics)?.id, 'music');
  assert.equal(pickToBringUp(memories.slice(0, 1), [], [], '2026-09-27', () => 0, topics), null,
    'running out of material does not reopen a topic still cooling down');
  assert.equal(recentNudgeTopics(restored, now + NUDGE_TOPIC_COOLDOWN_MS).size, 0);
});

test('legacy, future-dated and unrelated asides do not create topic exclusions', () => {
  const make = (at: number, source: 'idle' | 'reminder', topic: string) => addAside([], 'A line.', source, new Date(at), '2026-09-27', '', topic).aside;
  assert.equal(recentNudgeTopics([
    make(now + 1, 'idle', 'future'), make(now, 'reminder', 'errand'), make(now, 'idle', ''),
  ], now).size, 0);
  const legacy = readAsides([{ text: 'A line.', source: 'idle', at: new Date(now).toISOString() }]);
  assert.equal(recentNudgeTopics(legacy, now).size, 0);
});

test('a newly finished or restarted task is a fresh subject', () => {
  const underway = taskTopic({ id: 'build', underway: '2026-09-27T09:00:00Z' });
  const done = taskTopic({ id: 'build', done: true, completedAt: '2026-09-27T10:00:00Z' });
  const restarted = taskTopic({ id: 'build', underway: '2026-09-27T11:00:00Z' });
  assert.equal(new Set([underway, done, restarted]).size, 3);
  assert.equal(interestTopic('Odd Taxi'), interestTopic('ODD—TAXI'), 'one subject across sharing and recommendation');
});

test('rejected or failed publication does not consume a check-in, recommendation or ask', () => {
  let accepted = 0;
  const draft = { line: 'How did the build go?', topic: 'build', asked: 'the build', accepted: () => { accepted++; } };
  assert.equal(publishNudge(draft, () => false), false);
  assert.equal(accepted, 0);
  assert.throws(() => publishNudge(draft, () => { throw new Error('write failed'); }));
  assert.equal(accepted, 0);
  assert.equal(publishNudge(draft, value => value.asked === 'the build'), true);
  assert.equal(accepted, 1);
});

test('continuity carries the conversation and recent remarks without manufacturing an obligation', () => {
  const old = addAside([], 'An old complaint.', 'idle', new Date(now - NUDGE_TOPIC_COOLDOWN_MS - 1), '2026-09-26').aside;
  const recent = addAside([], 'Eight hours. You have time for everyone but me.', 'idle', new Date(now - 60_000), '2026-09-27').aside;
  const context = nudgeContinuity({ conversation: 'Them: I finished the build.', whereabouts: 'They said they were going to eat.', slate: '', asides: [old, recent], now });
  assert.match(context, /Them: I finished the build/);
  assert.match(context, /They said they were going to eat/);
  assert.match(context, /for avoiding repetition only/);
  assert.match(context, /not fresh evidence/);
  assert.doesNotMatch(context, /An old complaint|Take that up with them|silence is yours to hold over them/);
});

test('the composer grounds her own-life nudge in the actual record and preserves her voice', () => {
  const prompt = nudgePrompt({
    identity: 'You are Haru.', style: 'Blunt, expressive, specific. Never the same complaint twice.',
    mood: 'Prickly today.', clock: 'It is Sunday evening.', continuity: 'Them: I have already read it.',
    subject: { key: 'interest:odd taxi', kind: 'own', material: 'Read an analysis of Odd Taxi. The casual dialogue made the clues work.', instruction: 'Share one specific observation from that reading.' },
  });
  assert.match(prompt, /Read an analysis of Odd Taxi/);
  assert.match(prompt, /Blunt, expressive, specific/);
  assert.match(prompt, /reading about something is not watching it/i);
  assert.match(prompt, /A statement can stand on its own/);
  assert.match(prompt, /return exactly PASS/);
  assert.doesNotMatch(prompt, /The point is to get them to message you back|Needle them with it: a dig, a guilt-trip/);
});

test('a deliberate pass is never published as a nudge', () => {
  for (const line of ['', 'PASS', ' pass. ', 'Pass!']) assert.equal(readNudge(line), null);
  assert.equal(readNudge('That pass was ridiculous.'), 'That pass was ridiculous.');
  assert.equal(readNudge('"How did the build go?"'), 'How did the build go?');
  assert.equal(readNudge('x'.repeat(221)), null, 'an overlong draft is retried, never cut before its point');
});

test('a malformed or negative review never approves publication', () => {
  for (const raw of ['', 'send', '{}', 'null', '{"verdict":"send"}', '{"verdict":true,"reason":"fine"}', '{"verdict":"send","reason":"fine"}', '{"premises":[null],"verdict":"send","reason":"fine"}']) {
    assert.equal(readNudgeReview(raw).send, false, raw);
  }
  for (const verdict of ['unsupported', 'repeat', 'off_topic']) {
    assert.equal(readNudgeReview(JSON.stringify({ premises: [], verdict, reason: 'Draft failed this check.' })).send, false);
  }
  assert.equal(readNudgeReview('{"premises":[],"verdict":"send","reason":"A genuine question about the supplied fact."}').send, true);
});

test('a positive verdict cannot override an unsupported factual premise', () => {
  const review = { premises: [{ claim: 'The user removed form fields.', supported: false }], verdict: 'send', reason: 'A design question.' };
  assert.equal(readNudgeReview(JSON.stringify(review)).send, false);
  assert.equal(readNudgeReview(JSON.stringify({ ...review, premises: [{ claim: 'The user is building a booking form.', supported: true }] })).send, true);
  assert.equal(readNudgeReview(JSON.stringify({ ...review, premises: [{ claim: 'A fact.', supported: 'yes' }] })).send, false);
});
