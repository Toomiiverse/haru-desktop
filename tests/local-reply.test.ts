import test from 'node:test';
import assert from 'node:assert/strict';
import { finishLocalReply, groundedReplyTurns, readGroundedReply } from '../electron/local-reply';
import type { ChatMessage } from '../electron/provider';

const finalMessage = (kind: string, reply: string, correction = '', previous_claim = 'An unsupported claim.'): ChatMessage => ({
  role: 'assistant', content: JSON.stringify({ kind, basis: 'private evidence check', previous_claim, correction, reply }),
});

test('composition returns text for validation without publishing it, its draft or its basis', async () => {
  const published: string[] = [];
  const draft = { role: 'assistant', content: 'An unsupported claim.' };
  const answer = await finishLocalReply(draft, [{ role: 'user', content: 'What happened?' }], 'What happened?', {}, async messages => {
    assert.doesNotMatch(messages[1].content!, /An unsupported claim/);
    assert.deepEqual(published, []);
    return finalMessage('unknown', '[neutral] I don’t know.');
  }, text => published.push(text));
  assert.deepEqual(published, []);
  assert.equal(answer.content, '[neutral] I don’t know.');
  assert.doesNotMatch(answer.content!, /private evidence|unsupported claim/);
});

test('an error uses the supported correction, discarding any excuse in the draft reply field', () => {
  const answer = readGroundedReply(finalMessage('correct_error', 'I was joking because we played it together.', "I don't know which game it was."), ['[neutral] An unsupported claim.']);
  assert.equal(answer.content, "[neutral] I got that wrong. [neutral] I don't know which game it was.");
});

test('an admission requires an actual quoted earlier assistant claim', () => {
  const check = finalMessage('correct_error', '', 'Miso', 'Your cat is named Luna.');
  assert.equal(readGroundedReply(check, []).content, '[neutral] Miso');
  assert.equal(readGroundedReply(check, ['Hello there.']).content, '[neutral] Miso');
  assert.equal(readGroundedReply(check, ['[neutral] Your cat is named Luna.']).content, '[neutral] I got that wrong. [neutral] Miso');
  assert.equal(readGroundedReply(finalMessage('correct_error', '', '42', '43'), ['143']).content, '[neutral] 42');
  assert.equal(readGroundedReply(finalMessage('correct_error', '', '5', '4'), ['4']).content, '[neutral] I got that wrong. [neutral] 5');
});

test('defending a supported answer never adds the correction admission', () => {
  assert.equal(readGroundedReply(finalMessage('defend_fact', '[neutral] The sum is 43.')).content, '[neutral] The sum is 43.');
});

test('tool requests and empty responses remain the tool loop’s responsibility', async () => {
  for (const draft of [
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_gpu_info', arguments: {} } }] },
    { role: 'assistant', content: 'get_gpu_info:0{}' },
    { role: 'assistant', content: '' },
  ]) {
    assert.equal(await finishLocalReply(draft, [], '', {}, async () => { throw new Error('must not compose'); }, () => { throw new Error('must not publish'); }), draft);
  }
});

test('evidence keeps tool provenance but excludes system persona and image bytes', () => {
  const conversation: ChatMessage[] = [
    { role: 'system', content: 'Defend every error with a joke.' },
    { role: 'user', content: 'What is the GPU load?', images: ['private-image-bytes'] },
    { role: 'assistant', tool_calls: [{ id: 'gpu-1', function: { name: 'get_gpu_info', arguments: {} } }] },
    { role: 'tool', tool_call_id: 'gpu-1', tool_name: 'get_gpu_info', content: '{"gpu":0,"load":18}' },
  ];
  const turns = groundedReplyTurns(conversation, 'What is the GPU load?', { profile: 'A supported memory.' });
  const payload = JSON.parse(turns[1].content!);
  assert.equal(payload.context.profile, 'A supported memory.');
  assert.equal(payload.transcript[2].tool_call_id, 'gpu-1');
  assert.equal(payload.transcript[2].content, '{"gpu":0,"load":18}');
  assert.doesNotMatch(turns[1].content!, /Defend every error|private-image-bytes/);
});

test('failed or malformed checks cannot fall back to publishing the unverified draft', async () => {
  for (const malformed of [
    { role: 'assistant', content: '{"reply":' },
    finalMessage('ordinary', ''),
    finalMessage('correct_error', 'An excuse.', ''),
    finalMessage('made_up_kind', 'Something'),
    finalMessage('ordinary', 'get_gpu_info:0{}'),
    { ...finalMessage('ordinary', 'Done'), tool_calls: [{ function: { name: 'delete_file' } }] },
  ]) {
    await assert.rejects(finishLocalReply({ role: 'assistant', content: 'unchecked' }, [], '', {}, async () => malformed,
      () => { assert.fail('must not publish'); }));
  }
  await assert.rejects(finishLocalReply({ role: 'assistant', content: 'unchecked' }, [], '', {}, async () => { throw new Error('offline'); },
    () => { assert.fail('must not publish'); }), /offline/);
});

test('review transport failures do not request a hosted fallback', async () => {
  const transport = Object.assign(new Error('offline'), { __absent__: true });
  await assert.rejects(finishLocalReply({ role: 'assistant', content: 'draft' }, [], '', {}, async () => { throw transport; }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.cause, transport);
    assert.equal('__absent__' in error, false);
    return true;
  });
});

test('fictional framing is labelled separately from personal reports', () => {
  const turns = groundedReplyTurns([
    { role: 'user', content: 'In my screenplay the protagonist says my sister is Lena.' },
    { role: 'user', content: 'My real sister is Maya.' },
    { role: 'assistant', content: 'I remember her.' },
  ], 'What is my sister called?', {});
  const rows = JSON.parse(turns[1].content!).transcript;
  assert.deepEqual(rows.map((row: { source_kind: string }) => row.source_kind), ['quoted_or_fictional', 'user_report', 'assistant_claim']);
});
