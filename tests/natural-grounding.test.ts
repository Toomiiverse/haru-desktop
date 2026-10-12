import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNaturalConversation, groundedNaturalTurns, answerLocalNaturalConversation, checkNaturalReply } from '../electron/natural-conversation';
import { needsGroundedConversationReview, readGroundedReply } from '../electron/local-reply';
import { forOllama } from '../electron/ollamaturns';
import { ReplyGate } from '../electron/reply-gate';

const character = { identity: 'Haru has her own interests.', style: 'Dry and direct.' };
const result = (reply: string) => ({ role: 'assistant', content: JSON.stringify({
  kind: 'ordinary', basis: 'The latest user report.', previous_claim: '', correction: '', reply,
}) });

test('grounded fallback retains bounded source history, preferences, corrections and voice evidence', () => {
  const latest = "I'm excited, not angry.";
  const original = [
    { role: 'system', content: 'An unrelated archive must never become evidence.' },
    { role: 'user', content: 'I prefer quiet conversation without unasked advice.', at: '2026-09-30T10:00:00Z' },
    { role: 'assistant', content: '[annoyed] You are angry.' },
    { role: 'user', content: latest },
  ];
  const context = { continuity: [{ text: 'No pet names.', source_kind: 'recorded_preference', sourceId: 'preference:1' }], voice: { userAudio: null },
    learnedLessons: 'An inferred lesson is not evidence of an event.' };
  const prepared = prepareNaturalConversation(original, latest, character, context);
  original[1].content = 'This mutation is not part of the prepared snapshot.';
  const turns = forOllama(groundedNaturalTurns(prepared.sources, latest));
  assert.equal(turns.length, 2);
  assert.equal(turns.at(-1)?.role, 'user');
  const evidence = JSON.parse(turns[1].content!);
  assert.equal(evidence.latest_user, latest);
  assert.equal(evidence.transcript[0].content, 'I prefer quiet conversation without unasked advice.');
  assert.equal(evidence.transcript[0].at, '2026-09-30T10:00:00Z');
  assert.equal(evidence.transcript[1].source_kind, 'assistant_claim');
  assert.equal(evidence.context.continuity[0].text, 'No pet names.');
  assert.equal(evidence.context.voice.userAudio, null);
  assert.equal(evidence.character.identity, character.identity);
  assert.equal(evidence.character.source_kind, 'character_notes_not_event_evidence');
  assert.doesNotMatch(JSON.stringify(evidence.transcript), /Haru has her own interests/);
  assert.doesNotMatch(turns[1].content!, /archive|inferred lesson|mutation/);
});

test('local repair keeps the same actual request last and publishes neither JSON nor basis', async () => {
  const latest = 'This coffee tastes good.';
  const prepared = prepareNaturalConversation([{ role: 'user', content: latest }], latest, character, {});
  let calls = 0;
  const visible: string[] = [], gate = new ReplyGate(text => visible.push(text));
  const answer = await answerLocalNaturalConversation(prepared.sources, latest, {}, async input => {
    const turns = forOllama(input);
    assert.equal(turns.length, 2);
    assert.equal(JSON.parse(turns.at(-1)!.content!).latest_user, latest);
    const draft = ++calls === 1 ? { role: 'assistant', content: '{"reply":"incomplete schema"}' } : { role: 'assistant', content: JSON.stringify({ basis: 'The user likes the coffee.', reply: '[happy] Glad you like it.' }) };
    gate.chunk(draft.content);
    return draft;
  });
  assert.equal(calls, 2);
  assert.deepEqual(visible, []);
  gate.commit(answer.content!);
  assert.deepEqual(visible, ['[happy] Glad you like it.']);
});

test('both composers exclude whole old turns at the same compact-context cutoff', () => {
  const latest = 'Thanks!';
  const history = [{ role: 'user', content: 'Old: ' + 'x'.repeat(3000) },
    { role: 'assistant', content: 'Recent: ' + 'y'.repeat(1900) }, { role: 'user', content: latest }];
  const prepared = prepareNaturalConversation(history, latest, character, {});
  assert.doesNotMatch(JSON.stringify(prepared), /Old:/);
  assert.match(JSON.stringify(prepared.sources), /Recent:/);
  const fiction = prepareNaturalConversation([{ role: 'user', content: 'In my story, Mira has a cat named Miso.' },
    { role: 'user', content: latest }], latest, character, {});
  const payload = JSON.parse(groundedNaturalTurns(fiction.sources, latest)[1].content!);
  assert.equal(payload.transcript[0].source_kind, 'quoted_or_fictional');
});

test('local stable instructions and the complete character prefix are reusable across turn kinds', () => {
  const prompts = ['Hello there.', 'Tell me a joke.', 'Please be less formal.'].map(latest => {
    const prepared = prepareNaturalConversation([{ role: 'user', content: latest }], latest, character, {});
    return groundedNaturalTurns(prepared.sources, latest);
  });
  assert.equal(new Set(prompts.map(turns => turns[0].content)).size, 1);
  assert.equal(new Set(prompts.map(turns => turns[1].content!.split(',"turn_guidance":')[0])).size, 1);
});

test('personal recall and corrections request grounded composition without broadening the fast route', () => {
  for (const latest of ['What feeling did I report?', 'What reply length do I prefer?', 'Did I say who made it?',
    'What did I ask you to call me?', 'What two preferences have I just stated?', 'Who made the cup, according to my correction?', 'My real cat is named Nori.',
    'Actually, Nori is my dog, not my cat.']) assert.equal(needsGroundedConversationReview(latest), true, latest);
  for (const latest of ['Tell me a joke.', 'Hello there.', 'I had a nice walk.']) assert.equal(needsGroundedConversationReview(latest), false, latest);
});

test('a user correction or recall question cannot manufacture an earlier assistant mistake', () => {
  const answer = { role: 'assistant', content: JSON.stringify({ kind: 'correct_error', basis: 'The user corrected their report.',
    previous_claim: 'Your sister made it.', correction: 'Your brother made the coffee.', reply: '' }) };
  for (const latest of ['Actually, my brother made it. I was mistaken.', 'Who made the cup, according to my correction?']) {
    assert.equal(readGroundedReply(answer, ['Your sister made it.'], latest).content, '[neutral] Your brother made the coffee.');
  }
  assert.match(readGroundedReply(answer, ['Your sister made it.'], 'Your answer was wrong.').content!, /I got that wrong/);
  assert.throws(() => readGroundedReply(result("[neutral] I misread your mood earlier."), [], 'What feeling did I report?'), /unsupported claim/);
});

test('advice on a report is rejected across rest and consumption instructions', () => {
  for (const reply of ['[neutral] Get some rest.', '[neutral] Have a nap.', '[neutral] Take a little break.'])
    assert.throws(() => checkNaturalReply({ role: 'assistant', content: reply }, "I'm tired."), /unasked advice/);
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: '[happy] Drink it slowly.' }, 'This coffee tastes good.'), /unasked advice/);
  assert.doesNotThrow(() => checkNaturalReply({ role: 'assistant', content: '[neutral] That sounds tiring.' }, "I'm tired."));
});

test('tone requests keep their turn-specific guidance and reject defensive denials', () => {
  const latest = 'Please be less formal.';
  const prepared = prepareNaturalConversation([{ role: 'user', content: latest }], latest, character, {});
  const turns = groundedNaturalTurns(prepared.sources, latest);
  assert.match(JSON.parse(turns[1].content!).turn_guidance, /Acknowledge their impression/);
  assert.match(turns[0].content!, /\[neutral\], \[happy\]/);
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: "[neutral] I'm not formal. I'm direct." }, latest), /without blame or denial/);
  assert.doesNotThrow(() => checkNaturalReply({ role: 'assistant', content: "[neutral] Sure, I'll keep it casual." }, latest));
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: "[neutral] I don't sound annoyed, but I can see why you'd think that." }, 'You sound annoyed.'), /without blame or denial/);
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: "[neutral] I'll speak softer. I wasn't annoyed." }, 'Please speak softer.'), /without blame or denial/);
  const audioQuestion = 'How do I sound?';
  const noAudio = prepareNaturalConversation([{ role: 'user', content: audioQuestion }], audioQuestion, character, {});
  assert.match(JSON.parse(groundedNaturalTurns(noAudio.sources, audioQuestion)[1].content!).turn_guidance, /text but no audio/);
});
