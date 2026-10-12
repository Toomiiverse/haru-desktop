import test from 'node:test';
import assert from 'node:assert/strict';
import { addAside, readAsides, type Aside } from '../electron/asides';
import { interestTopic, nudgeContentProblem, nudgeContinuity, ownNudgeCandidates, OWN_NUDGE_FRESH_MS, pickNudgeCandidate, repeatedNudgeQuestion, type NudgeCandidate } from '../electron/nudges';

const now = Date.parse('2026-09-27T12:00:00Z');
const at = (age: number) => new Date(now - age).toISOString();
const reading = (about: string, age = 60_000) => ({ about, at: at(age), day: at(age).slice(0, 10), note: `My recorded take on ${about}.`, sources: [] });
const empty = { nights: [], days: [], finished: [], interests: [], asides: [], now };
const candidate = (key: string, kind: NudgeCandidate['subject']['kind'], priority = 0): NudgeCandidate => ({
  subject: { key, kind, material: key, instruction: '' }, weight: 1, priority,
});
const aside = (key: string, kind: NudgeCandidate['subject']['kind'], age = 60_000) =>
  addAside([], `A remark about ${key}.`, 'idle', new Date(now - age), '2026-09-27', '', key, kind).aside;

test('daytime reading, nights and finished manga are fresh material; future and stale records are not', () => {
  const choices = ownNudgeCandidates({ ...empty,
    days: [reading('Camera lenses'), reading('Too old', OWN_NUDGE_FRESH_MS), reading('Future', -1), { ...reading('Invalid'), at: 'invalid' }],
    nights: [reading('Disco Elysium review'), { ...reading('Odd Taxi, chapter 12'), interest: 'Odd Taxi' }, { ...reading('Empty'), note: '' }],
    finished: [{ title: 'Odd Taxi', at: at(1), chapters: 12, seriesId: 'taxi' }],
    interests: [{ name: 'Disco Elysium' }],
  });
  assert.deepEqual(choices.map(c => c.subject.key).sort(), ['Camera lenses', 'Disco Elysium', 'Odd Taxi'].map(interestTopic).sort());
  assert.match(choices.find(c => c.subject.key === interestTopic('Camera lenses'))!.subject.material, /My recorded take/);
  assert.match(choices.find(c => c.subject.key === interestTopic('Odd Taxi'))!.subject.material, /end of the available chapters/);
});

test('a completion without a recorded take does not invite an invented opinion', () => {
  assert.equal(ownNudgeCandidates({ ...empty,
    finished: [{ title: 'The Side Street', at: at(1), chapters: 12, seriesId: 'street' }],
  }).length, 0);
});

test('one title is one subject across sources, and finishing retains the dated earlier take', () => {
  const choices = ownNudgeCandidates({ ...empty,
    nights: [{ ...reading('Odd Taxi, chapter 12'), interest: 'Odd Taxi' }],
    days: [reading('Odd Taxi review', 3_600_000)],
    finished: [{ title: 'Odd Taxi', at: at(1), chapters: 12, seriesId: 'taxi' }],
    interests: [{ name: 'Odd Taxi' }],
  });
  assert.equal(choices.length, 1);
  assert.match(choices[0].subject.material, /end of the available chapters/);
  assert.match(choices[0].subject.material, /My recorded take on Odd Taxi, chapter 12/);
  assert.doesNotMatch(choices[0].subject.material, /My recorded take on Odd Taxi review/);
});

test('a legacy or thought message can suppress a title, but a shared generic word cannot', () => {
  const previous = { ...aside('', 'own'), text: 'That character review was ridiculous.', source: 'thought' as const };
  const data = { ...empty, nights: [{ ...reading('Odd Taxi character review'), interest: 'Odd Taxi' }] };
  assert.equal(ownNudgeCandidates({ ...data, asides: [previous] }).length, 1);
  assert.equal(ownNudgeCandidates({ ...data, asides: [{ ...previous, text: 'ODD—TAXI has an excellent mystery.' }] }).length, 0);
  assert.equal(ownNudgeCandidates({ ...data, asides: [{ ...previous, text: 'Odd Taxi!', at: at(-1) }] }).length, 1);
});

test('the size of her reading library does not drown out other kinds of subject', () => {
  const library = Array.from({ length: 20 }, (_, i) => candidate(`book:${i}`, 'own'));
  const countOwn = (candidates: NudgeCandidate[], asides: Aside[] = []) => Array.from({ length: 1000 }, (_, i) =>
    pickNudgeCandidate(candidates, asides, now, () => (i + 0.5) / 1000)!.subject.kind).filter(k => k === 'own').length;
  const memory = candidate('work', 'memory');
  assert.equal(countOwn([library[0], memory]), 500);
  assert.equal(countOwn([...library, memory]), 500);
  const repeated = [aside('old-work', 'memory'), aside('old-day', 'day'), aside('old-study', 'memory')];
  assert.ok(countOwn([...library, memory], readAsides(JSON.parse(JSON.stringify(repeated)))) > 900,
    'her own activity gets more room after repeated callbacks about him, including after a restart');
  assert.ok(countOwn([...library, memory], [aside('old-rec', 'recommendation')]) < 300,
    'a recommendation counts as one of her own subjects, not a loophole in the rotation');
});

test('requested check-ins and fresh tasks take precedence, without consuming an unselected candidate', () => {
  let committed = 0;
  const requested = { ...candidate('morning', 'checkin', 2), accepted: () => { committed++; } };
  const task = candidate('task:build:done', 'task', 1);
  const own = candidate('book', 'own');
  assert.equal(pickNudgeCandidate([own, requested, task], [], now, () => 0.99), requested);
  assert.equal(committed, 0);
  assert.equal(pickNudgeCandidate([own, requested, task], [aside('morning', 'checkin')], now, () => 0.99), task);
  assert.equal(pickNudgeCandidate([own], [aside('book', 'own')], now), null, 'cooldowns hold even when the draw is empty');
  assert.equal(pickNudgeCandidate([{ ...own, weight: NaN }], [], now), null);
});

test('kind metadata survives persistence while missing and malformed legacy values stay harmless', () => {
  const saved = readAsides(JSON.parse(JSON.stringify([aside('book', 'own')])));
  assert.equal(saved[0].nudgeKind, 'own');
  assert.equal(readAsides([{ ...saved[0], nudgeKind: 'unknown' }])[0].nudgeKind, undefined);
  assert.equal(readAsides([{ text: 'Legacy line.' }])[0].nudgeKind, undefined);
});

test('two consecutive questions encourage a self-contained observation', () => {
  const context = (asides: Aside[]) => nudgeContinuity({ conversation: '', whereabouts: '', slate: '', asides, now });
  const question = { ...aside('work', 'memory'), text: 'How did the build go?' };
  assert.match(context([question, { ...question, text: 'What are you reading?' }]), /without tacking on another question/);
  assert.doesNotMatch(context([question, { ...question, text: 'The dialogue earned its clues.' }]), /without tacking on another question/);
});

test('a new opening cannot hide a repeated trailing question from the last day', () => {
  const history = [{ ...aside('reading', 'own'), text: 'What have you been reading?' }];
  assert.equal(repeatedNudgeQuestion('I finished that manga. What are you reading?', history, now), 'What have you been reading?');
  assert.equal(repeatedNudgeQuestion('I finished that manga. What are you reading next?', history, now), null, 'a different question stays open');
  assert.equal(repeatedNudgeQuestion('That reading was excellent.', history, now), null);
  assert.equal(repeatedNudgeQuestion('What are you reading?', [{ ...history[0], at: at(-1) }], now), null);
  assert.equal(repeatedNudgeQuestion('What are you reading?', [{ ...history[0], at: at(24 * 3_600_000) }], now), null);
  assert.equal(repeatedNudgeQuestion('What is your favourite?', [{ ...history[0], text: 'What’s your favourite?' }], now), 'What’s your favourite?');
});

test('her own updates stand alone while genuine check-ins and recommendations may ask questions', () => {
  const own = candidate('book', 'own').subject;
  assert.ok(nudgeContentProblem(own, 'Finished my book. You still reading that?', [], now));
  assert.equal(nudgeContentProblem(own, 'Finished my book. Leaving that argument unresolved worked.', [], now), null);
  assert.equal(nudgeContentProblem({ ...own, kind: 'checkin' }, 'How did the build go?', [], now), null);
  assert.equal(nudgeContentProblem({ ...own, kind: 'recommendation' }, 'Did you give that book a try?', [], now), null);
});
