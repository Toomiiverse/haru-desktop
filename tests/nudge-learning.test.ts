import test from 'node:test';
import assert from 'node:assert/strict';
import { addAside, readAsides, type Aside } from '../electron/asides';
import { learnNudgeResponse, nudgeAffinity, nudgeFingerprint, rateNudge, readNudgeLearning } from '../electron/nudge-learning';
import { chooseNudgeDelivery, connectNudgeCandidates, conversationNudgeCandidates, relationshipNudgeCandidate, TASK_NUDGE_FRESH_MS, taskNudgeCandidates } from '../electron/nudge-context';
import { interestTopic, ownNudgeCandidates, pickNudgeCandidate, type NudgeSubject } from '../electron/nudges';
import { pickToBringUp } from '../electron/bored';

const now = Date.parse('2026-09-27T12:00:00Z'), HOUR = 3_600_000;
const at = (age = 0) => new Date(now - age).toISOString();
const subject: NudgeSubject = { key: interestTopic('Odd Taxi'), kind: 'own', material: 'Odd Taxi dialogue earns its clues.', keywords: ['odd', 'taxi'], instruction: '' };
const makeAside = (age = HOUR): Aside => addAside([], 'Odd Taxi dialogue earns its clues.', 'idle', new Date(now - age), '2026-09-27', '', subject.key, 'own', { nudgeKeywords: subject.keywords }).aside;
const reading = (note: string, age = HOUR) => ({ day: '2026-09-27', at: at(age), about: 'Odd Taxi, chapter 12', interest: 'Odd Taxi', note, sources: [] });
const own = { nights: [], days: [], finished: [], interests: [{ name: 'Odd Taxi' }], asides: [], now };

test('feedback persists across restart, replaces prior votes and can be undone', () => {
  const aside = makeAside();
  const more = rateNudge([aside], [], aside.id, 'more', now)!;
  const saved = readNudgeLearning(JSON.parse(JSON.stringify(more.learning)), now);
  assert.ok(nudgeAffinity(subject, saved, more.asides, now) > 1);
  assert.equal(readAsides(JSON.parse(JSON.stringify(more.asides)))[0].nudgeFeedback, 'more');
  const duplicate = rateNudge(more.asides, saved, aside.id, 'more', now)!;
  assert.equal(duplicate.learning.length, 1);
  const less = rateNudge(duplicate.asides, duplicate.learning, aside.id, 'less', now)!;
  assert.equal(nudgeAffinity(subject, less.learning, less.asides, now), 0);
  const cleared = rateNudge(less.asides, less.learning, aside.id, null, now)!;
  assert.equal(cleared.learning.length, 0);
  assert.equal(cleared.aside.nudgeFeedback, undefined);
  assert.equal(rateNudge([aside], [], 'missing', 'more', now), null);
  assert.equal(rateNudge([{ ...aside, source: 'weather', nudgeTopic: undefined }], [], aside.id, 'less', now), null);
});

test('already discussed suppresses the topic for a month, while a later recorded milestone may reopen it', () => {
  const aside = makeAside();
  const result = rateNudge([aside], [], aside.id, 'discussed', now)!;
  assert.equal(nudgeAffinity(subject, result.learning, [], now + 14 * 24 * HOUR), 0);
  assert.equal(nudgeAffinity({ ...subject, key: 'another-id' }, result.learning, [], now), 0, 'same subject under a new id');
  const changed = { ...subject, development: { id: 'finish', at: at(-HOUR), kind: 'completion' as const } };
  assert.ok(nudgeAffinity(changed, result.learning, [], now + 2 * HOUR) > 0);
  assert.equal(readNudgeLearning(result.learning, now + 91 * 24 * HOUR).length, 0);
});

test('long named replies teach interest once; unrelated speech is never credited to a nudge', () => {
  const aside = makeAside();
  const messages = [{ role: 'user', at: at(), replyTo: { id: aside.id }, content: 'The way the dialogue carries the clues without announcing them is exactly what I like about this mystery.' }];
  const result = learnNudgeResponse([aside], [], messages, now)!;
  assert.equal(result.learning[0].engagement, 2);
  assert.equal(result.asides[0].answeredAt, at());
  assert.ok(nudgeAffinity(subject, result.learning, [], now) > 1);
  assert.equal(learnNudgeResponse(result.asides, result.learning, messages, now), null);
  assert.equal(learnNudgeResponse([aside], [], [{ role: 'user', content: 'The server has broken again and I need to investigate its logs.' }], now), null);
  const openAskMarked = learnNudgeResponse([{ ...aside, answeredAt: at() }], [], messages, now);
  assert.equal(openAskMarked?.learning[0].engagement, 2, 'existing ask acknowledgement does not lose engagement learning');
});

test('already told you is a strong correction only when its target is identifiable', () => {
  const aside = makeAside();
  const reply = { role: 'user', content: 'I already told you that.', replyTo: aside.id };
  const result = learnNudgeResponse([aside], [], [reply], now)!;
  assert.equal(result.learning[0].choice, 'discussed');
  assert.equal(result.asides[0].nudgeFeedback, 'discussed');
  assert.equal(learnNudgeResponse([aside], [], [{ role: 'assistant', content: 'A separate conversation.', at: at(1) }, { ...reply, replyTo: undefined }], now), null);
});

test('unanswered nudges gently reduce their topic weight; undelivered ones do not', () => {
  const aside = makeAside(5 * HOUR);
  assert.ok(nudgeAffinity(subject, [], [aside], now) < 1);
  assert.equal(nudgeAffinity(subject, [], [{ ...aside, reached: false }], now), 1);
  assert.equal(nudgeAffinity(subject, [], [{ ...aside, answeredAt: at() }], now), 1);
});

test('learned exclusions apply before drawing a memory, so another subject can win', () => {
  const memories = [{ id: 'taxi', text: 'They enjoy the mystery Odd Taxi.', importance: 1 }, { id: 'music', text: 'They have started learning the bass.', importance: 1 }];
  const aside = { ...makeAside(), nudgeTopic: 'taxi' };
  const learned = rateNudge([aside], [], aside.id, 'less', now)!;
  const picked = pickToBringUp(memories, [], [], '2026-09-27', () => 0, new Set(), thing => nudgeAffinity({ ...subject, key: thing.id, material: thing.text, keywords: undefined }, learned.learning, [], now));
  assert.equal(picked?.id, 'music');
});

test('callbacks use fresh human statements and connect her interests to those words', () => {
  const conversation = [
    { role: 'user', content: 'I enjoy how Odd Taxi trusts the audience to spot the clues.', at: at(HOUR) },
    { role: 'assistant', content: 'You are definitely applying for Honours.', at: at() },
    { role: 'user', content: 'A historical account about a forgotten university project.', at: at(40 * HOUR) },
    { role: 'user', content: 'A future dated statement should never become a callback.', at: at(-1) },
    { role: 'user', content: 'Stop asking about your nudges and notifications.', at: at() },
  ];
  const callbacks = conversationNudgeCandidates(conversation, now);
  assert.equal(callbacks.length, 1);
  assert.match(callbacks[0].subject.material, /trusts the audience/);
  const connected = connectNudgeCandidates([{ subject, weight: 1 }], conversation, now)[0];
  assert.ok(connected.weight > 1);
  assert.match(connected.subject.material, /Related words from him/);
  assert.doesNotMatch(connected.subject.material, /Honours/);
});

test('underway tasks expire after a workday; completions remain a distinct fresh event', () => {
  const base = { id: 'server', title: 'Reinstall server', kind: 'task' };
  assert.equal(taskNudgeCandidates([{ ...base, underway: at(TASK_NUDGE_FRESH_MS) }], now, HOUR).length, 0);
  assert.equal(taskNudgeCandidates([{ ...base, underway: at(-1) }], now, HOUR).length, 0);
  const started = taskNudgeCandidates([{ ...base, underway: at(HOUR) }], now, HOUR)[0];
  const done = taskNudgeCandidates([{ ...base, underway: at(48 * HOUR), done: true, completedAt: at(1) }], now, HOUR)[0];
  assert.notEqual(started.subject.key, done.subject.key);
  assert.match(started.subject.material, /current activity and progress are unknown/);
  assert.equal(taskNudgeCandidates([{ ...base, done: true, completedAt: at(-1) }], now, HOUR).length, 0);
});

test('completion and explicit changed opinion can reopen a topic, but repeated records cannot', () => {
  const aside = makeAside(3 * HOUR);
  const finish = { title: 'Odd Taxi', seriesId: 'taxi', chapters: 12, at: at(HOUR) };
  const choices = ownNudgeCandidates({ ...own, nights: [reading('I liked the unresolved argument.', 4 * HOUR)], finished: [finish], asides: [aside] });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].subject.development?.kind, 'completion');
  assert.ok(pickNudgeCandidate(choices, [aside], now));
  const published = { ...makeAside(1), nudgeEvent: choices[0].subject.revision };
  assert.equal(ownNudgeCandidates({ ...own, nights: [reading('I liked the unresolved argument.', 4 * HOUR)], finished: [finish], asides: [published] }).length, 0);
  const changed = ownNudgeCandidates({ ...own, nights: [reading('I changed my mind. The structure does earn its ending.')], asides: [aside] });
  assert.equal(changed[0].subject.development?.kind, 'opinion');
  const repeated = reading('I liked the dialogue.');
  const said = { ...makeAside(25 * HOUR), nudgeEvent: nudgeFingerprint(`${repeated.about}\n${repeated.note}`) };
  assert.equal(ownNudgeCandidates({ ...own, nights: [repeated], asides: [said] }).length, 0);
  assert.equal(ownNudgeCandidates({ ...own, nights: [reading('I changed my mind. The structure works.')], asides: [makeAside(HOUR)] }).length, 0, 'a milestone does not permit a burst');
});

test('tone rotation preserves wit and makes praise available only for a supported success', () => {
  const candidate = { ...subject, kind: 'task' as const, material: 'They completed the server reinstall.' };
  assert.equal(chooseNudgeDelivery(candidate, [], now, () => 0.99).tone, 'approving');
  assert.equal(chooseNudgeDelivery({ ...candidate, material: 'They finished the reinstall. They have not described how it went.' }, [], now, () => 0.99).tone, 'approving');
  assert.notEqual(chooseNudgeDelivery({ ...candidate, material: 'They have not finished the reinstall.' }, [], now, () => 0.99).tone, 'approving');
  const prior = [{ ...makeAside(), nudgeTone: 'amused' as const }];
  assert.notEqual(chooseNudgeDelivery(candidate, prior, now, () => 0).tone, 'amused');
  assert.equal(chooseNudgeDelivery(subject, [], now, () => 0.99).tone, 'opinionated');
});

test('relationship follow-ups require an actual offer, expire, and share a three-day cooldown', () => {
  const offer = { role: 'user', content: "I'll show you the finished design later.", at: at(14 * HOUR) };
  assert.ok(relationshipNudgeCandidate([offer], now));
  assert.equal(relationshipNudgeCandidate([{ ...offer, content: 'I was working on a design.' }], now), null);
  assert.equal(relationshipNudgeCandidate([{ ...offer, content: "I'll show you the design tomorrow." }], now), null);
  assert.equal(relationshipNudgeCandidate([offer], now, at(24 * HOUR)), null);
  assert.equal(relationshipNudgeCandidate([{ ...offer, at: at(40 * HOUR) }], now), null);
  assert.equal(relationshipNudgeCandidate([offer, { role: 'user', content: 'Here it is.', at: at(HOUR) }], now), null);
  assert.equal(relationshipNudgeCandidate([], now), null, 'a silent day is not a reason to complain');
});
