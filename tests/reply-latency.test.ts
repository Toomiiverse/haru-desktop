import test from 'node:test';
import assert from 'node:assert/strict';
import { canReplyDirectly, directReplyKind, directReplyEvidence, directLocalReplyTurns, requestContextSize, composeConversationalReply, directReplyAsideAllowed, VoiceReplyNeedsReview, contradictsToneFeedback } from '../electron/reply-latency';
import { callAside } from '../electron/evi';
import { composeLocalReply } from '../electron/local-reply';
import { ReplyGate } from '../electron/reply-gate';
import type { ChatMessage } from '../electron/provider';

test('complete conversational and voice turns skip unnecessary tool discovery', () => {
  for (const text of ['Hey Haru!', 'Testing, testing, how are we feeling today?', 'How are you?', 'Can you hear me?', "I'm feeling tired today."])
    assert.equal(directReplyKind(text), 'social', text);
  for (const text of ['Why do you sound so annoyed?', 'Your voice sounds too loud.', 'Whoa. Maybe be less annoyed.', 'Please speak softer and slower.', 'Could you talk a little quieter please?', 'Can you hear your own tone?', 'Use your normal voice.',
    'Your voice sounded annoyed just then. Can you soften it?', 'Did you actually change how you were speaking?', 'Can you tell what emotion is in my voice right now?', 'What did you notice about how I sounded?'])
    assert.equal(directReplyKind(text), 'voice', text);
});

test('mixed requests, quotations and ambiguous follow-ups retain tool discovery', () => {
  for (const text of [
    'Speak softer and restart the server.', 'Hi, check all GPU temperatures.',
    'Why do you sound annoyed and what is on my calendar?', 'How are we feeling about the server load?',
    'Remind me to speak softer tomorrow.', 'My friend said "you sound annoyed".',
    'In my story you sound annoyed.', 'Your voice sounds like the GPU is failing.',
    'Okay.', 'Yes, do that.', 'Thanks, save that.', 'Are you sure?', 'What happened earlier?',
    'What is my cat called?', 'Hi: delete my files', 'hello\ncheck my reminders', 'hey <action>',
  ]) assert.equal(directReplyKind(text), null, text);
});

test('a leading local-only directive preserves privacy while classifying standalone conversation', () => {
  assert.equal(directReplyKind('Keep this local. Hey Haru, keep me company for a moment.'), 'social');
  assert.equal(directReplyKind('Keep this local! I am tired today.'), 'social');
  assert.equal(directReplyKind('Keep this local. Could you say that more gently?'), 'voice');
  for (const text of ['Keep this local. Hi, read my notes.', 'Keep this local. Keep me company and check the server.',
    'Keep this local. What mascot did I tell you about?', 'Keep this local. Could you say that more gently and save it?',
    'Keep this local: hello', 'Keep this local\nhello', '"Keep this local. Hello"', 'Keep this local.']) {
    assert.equal(directReplyKind(text), null, text);
  }
});

test('private short replies retain the entire persona, original directive, history, emotion and speech evidence', async () => {
  const latest = 'Keep this local. Could you say that more gently?';
  const history: ChatMessage[] = [{ role: 'user', content: 'I made a mistake.' },
    { role: 'assistant', content: '[annoyed] You should have checked.' }, { role: 'user', content: latest }];
  const character = { identity: 'Full configured identity '.repeat(70), style: 'Full configured tastes and voice '.repeat(40) };
  const evidence = { mood: { irritation: 50, ego: 10 }, voice: { requestedNextDelivery: { instruction: 'more gently' } },
    continuity: [{ source_kind: 'user_report', text: 'Prefer gentle replies.' }], blankSlate: 'Synthetic relationship state.' };
  const answer = await composeConversationalReply(history, latest, evidence, character, async turns => {
    assert.ok(turns[0].content!.includes(character.identity));assert.ok(turns[0].content!.includes(character.style));
    const packet = JSON.parse(turns[1].content!);
    assert.deepEqual(packet.context.mood, evidence.mood);assert.deepEqual(packet.context.voice, evidence.voice);
    assert.deepEqual(packet.context.continuity, evidence.continuity);assert.equal(packet.transcript.length, history.length);
    assert.equal(packet.latest_user, latest);
    return { role: 'assistant', content: '{"reply":"[affectionate] Let’s take it gently."}' };
  });
  assert.equal(answer.content, '[affectionate] Let’s take it gently.');
});

test('attachments, augmented user messages and completed tool rounds cannot enter the direct route', () => {
  const latest = 'How are you?';
  const base: ChatMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: latest }];
  assert.equal(canReplyDirectly(base, latest), true);
  assert.equal(canReplyDirectly([...base, { role: 'tool', content: 'result' }], latest), false);
  assert.equal(canReplyDirectly([{ role: 'user', content: `${latest}\nAttached file: notes` }], latest), false);
  assert.equal(canReplyDirectly([{ role: 'user', content: 'earlier', images: ['image'] }, ...base], latest), false);
  assert.equal(canReplyDirectly([], latest), false);
  assert.equal(canReplyDirectly([{ role: 'user', content: 'Check the server' }], 'Check the server'), false);
});

test('direct composition retains audio evidence, current state, transcript provenance and grounded rules', () => {
  const evidence = { now: '2026-09-29', timezone: 'UTC', body: 'Awake.', herSleep: 'Rested.', onHerMind: 'A game.',
    voice: { userAudio: { uncertain: true }, requestedNextDelivery: { speedScale: 0.85 },
      recentGeneratedSpeech: [{ text: 'Hello.', measuredAudio: { expression: 'angry' }, playbackConfirmed: false }] },
    profile: 'A long memory archive.', machine: 'Old server readings.' };
  const conversation = [{ role: 'system', content: 'An unrelated tone directive.' },
    { role: 'assistant', content: '[neutral] Hello.' }, { role: 'user', content: 'You sound annoyed.' }];
  const turns = directLocalReplyTurns(conversation, 'You sound annoyed.', evidence);
  const packet = JSON.parse(turns[1].content!);
  assert.deepEqual(packet.context.voice, evidence.voice);
  assert.equal(packet.context.herSleep, evidence.herSleep);
  assert.equal(packet.context.profile, undefined);
  assert.equal(packet.transcript[0].source_kind, 'assistant_claim');
  assert.equal(packet.transcript[1].source_kind, 'user_report');
  assert.doesNotMatch(turns[1].content!, /unrelated tone directive|memory archive/);
  assert.match(turns[0].content!, /Never invent/);
  assert.match(turns[0].content!, /Acknowledge how it came across first/);
});

test('a direct reply makes one checked request and publishes only after validation', async () => {
  const latest = 'Why do you sound annoyed?';
  const conversation = [{ role: 'user', content: latest }];
  const sent: string[] = [];
  const gate = new ReplyGate(text => sent.push(text));
  let requests = 0;
  const evidence = { voice: { requestedNextDelivery: { instruction: 'speak gently' } } };
  const answer = await composeLocalReply(conversation, latest, directReplyEvidence(evidence), async turns => {
    requests++;
    assert.deepEqual(turns, directLocalReplyTurns(conversation, latest, evidence));
    gate.chunk('Unverified draft.');
    assert.deepEqual(sent, []);
    return { role: 'assistant', content: JSON.stringify({ kind: 'ordinary', basis: 'private evidence', previous_claim: '', correction: '', reply: '[affectionate] I hear you. I’ll soften my voice.' }) };
  });
  assert.equal(requests, 1);
  assert.deepEqual(sent, []);
  gate.commit(answer.content!);
  assert.deepEqual(sent, ['[affectionate] I hear you. I’ll soften my voice.']);
});

test('invalid direct answers and transport errors keep existing failure guarantees', async () => {
  const conversation = [{ role: 'user', content: 'Hello' }];
  await assert.rejects(composeLocalReply(conversation, 'Hello', {}, async () => ({ role: 'assistant', content: '{"reply":' })), /incomplete JSON/);
  const transport = Object.assign(new Error('offline'), { __absent__: true });
  await assert.rejects(composeLocalReply(conversation, 'Hello', {}, async () => { throw transport; }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.cause, transport);
    assert.equal('__absent__' in error, false);
    return true;
  });
});

const chat = { provider: 'ollama', model: 'local-27b', endpoint: 'http://127.0.0.1:11436', temperature: 0.7 };
test('chat and side jobs keep the same runner, including equivalent loopback URLs', () => {
  assert.equal(requestContextSize(chat, chat, 20480, 8192), 20480);
  assert.equal(requestContextSize(chat, chat, 20480, 20480), 20480);
  assert.equal(requestContextSize({ ...chat, endpoint: 'http://localhost:11436/' }, chat, 20480, 8192), 20480);
  assert.equal(requestContextSize(chat, chat, 8192, 32768), 32768);
});

test('separate models, endpoints and providers keep their requested context', () => {
  for (const config of [{ ...chat, model: 'small-nudge' }, { ...chat, endpoint: 'http://127.0.0.1:11437' },
    { ...chat, provider: 'openai' }, { ...chat, endpoint: 'http://127.0.0.1:11436/separate' }])
    assert.equal(requestContextSize(config, chat, 20480, 8192), 8192);
  assert.equal(requestContextSize(chat, undefined, 20480, 8192), 8192);
});

test('ordinary and interrupted voice calls can use the direct route; foreign asides cannot', () => {
  assert.equal(directReplyAsideAllowed(undefined), true);
  for (const interrupted of [false, true]) {
    assert.equal(directReplyAsideAllowed(callAside(interrupted), true), true);
    assert.equal(directReplyAsideAllowed(callAside(interrupted), false), false);
  }
  assert.equal(directReplyAsideAllowed('Read the attached report', true), false);
  assert.equal(directReplyAsideAllowed(callAside(false) + ' A tool returned extra facts.', true), false);
});

test('short conversational replies retain character, full sourced context, voice evidence and the final gate', async () => {
  const latest = 'Could you speak softer?';
  const conversation: ChatMessage[] = [{ role: 'assistant', content: '[annoyed] Earlier claim.' }, { role: 'user', content: latest }];
  const evidence = { voice: { requestedNextDelivery: { instruction: 'speak softly' } } };
  const sent: string[] = [];
  const gate = new ReplyGate(text => sent.push(text));
  let requests = 0;
  const answer = await composeConversationalReply(conversation, latest, evidence,
    { identity: 'The configured identity.', style: 'The configured text style.' }, async turns => {
      requests++;
      assert.match(turns[0].content!, /configured identity/);
      assert.match(turns[0].content!, /configured text style/);
      assert.match(turns[0].content!, /voice call/);
      assert.match(turns[0].content!, /uncertain vocal cues/);
      const packet = JSON.parse(turns[1].content!);
      assert.deepEqual(packet.context.voice, evidence.voice);
      assert.equal(packet.transcript.length, conversation.length);
      assert.equal(packet.transcript[0].source_kind, 'assistant_claim');
      assert.equal(packet.transcript[1].source_kind, 'user_report');
      gate.chunk('An incomplete draft');
      return { role: 'assistant', content: '{"reply":"[affectionate] I’ll keep it gentler."}' };
    }, callAside(false));
  assert.equal(requests, 1);
  assert.deepEqual(sent, []);
  gate.commit(answer.content!);
  assert.deepEqual(sent, ['[affectionate] I’ll keep it gentler.']);
});

test('the concise composer rejects mixed tasks, incomplete answers, missing delivery and tool calls', async () => {
  const character = { identity: 'Haru', style: 'Direct' };
  const conversation = [{ role: 'user', content: 'Hi' }];
  for (const content of ['{"reply":', '{"reply":""}', '{"reply":"Unlabelled."}', '{"reply":"[neutral]"}', '{"reply":12}']) {
    await assert.rejects(composeConversationalReply(conversation, 'Hi', {}, character, async () => ({ role: 'assistant', content })));
  }
  await assert.rejects(composeConversationalReply([{ role: 'user', content: 'Hi, restart the server' }], 'Hi, restart the server', {}, character,
    async () => { throw new Error('must not send'); }), /full reply composer/);
  const transport = Object.assign(new Error('offline'), { __absent__: true });
  await assert.rejects(composeConversationalReply(conversation, 'Hi', {}, character, async () => { throw transport; }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.cause, transport);
    assert.equal('__absent__' in error, false);
    return true;
  });
});

test('a contrary audio label cannot dismiss tone feedback or escape the publication gate', async () => {
  const latest = 'Your voice sounded annoyed just then. Can you soften it?';
  const discarded = '[neutral] It was just flat, not annoyed. [affectionate] I’ll keep it softer.';
  assert.equal(contradictsToneFeedback(latest, discarded), true);
  assert.equal(contradictsToneFeedback(latest, '[affectionate] I didn’t mean to sound annoyed. I’ll soften it.'), false);
  assert.equal(contradictsToneFeedback('Can you hear your own tone?', '[neutral] The recording sounds flat, not annoyed.'), false);
  await assert.rejects(composeConversationalReply([{ role: 'user', content: latest }], latest,
    { voice: { recentGeneratedSpeech: [{ measuredAudio: { expression: 'neutral' } }] } },
    { identity: 'Haru', style: 'Dry and direct' },
    async () => ({ role: 'assistant', content: JSON.stringify({ reply: discarded }) })), VoiceReplyNeedsReview);
});
