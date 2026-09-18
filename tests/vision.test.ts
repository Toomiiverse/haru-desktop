import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VISION, look, readShotDescription, readVisionConfig } from '../electron/vision';

test('the same picture travels in the dialect its endpoint speaks', async () => {
  const calls: { url: string; body: { messages: { images?: string[]; content?: { type: string; image_url?: { url: string } }[] }[] } }[] = [];
  const reply = (payload: unknown) => (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as never;

  // A local Ollama: base64 straight in the message.
  const local = readVisionConfig({ enabled: true, model: 'gemma4:12b' });
  const near = await look('AAA', local, 'http://localhost:11434', {}, reply({ message: { content: 'a cat' } }));
  assert.equal(near.description, 'a cat');
  assert.equal(calls[0].url, 'http://localhost:11434/api/chat');
  assert.deepEqual(calls[0].body.messages.at(-1)?.images, ['AAA']);

  // A hosted, OpenAI-shaped model: a data URL in a content part, no keep_alive.
  const hosted = readVisionConfig({ enabled: true, model: 'grok-vision', provider: 'xai', endpoint: 'https://api.x.ai/v1' });
  const far = await look('BBB', hosted, 'https://api.x.ai/v1', {}, reply({ choices: [{ message: { content: 'a dog' } }] }));
  assert.equal(far.description, 'a dog');
  assert.equal(calls[1].url, 'https://api.x.ai/v1/chat/completions');
  const part = calls[1].body.messages.at(-1)?.content?.[1];
  assert.equal(part?.type, 'image_url');
  assert.equal(part?.image_url?.url, 'data:image/jpeg;base64,BBB');
  assert.equal('keep_alive' in calls[1].body, false);
});

test('the eyes remember where they were pointed', () => {
  const config = readVisionConfig({ enabled: true, model: 'm', endpoint: 'https://api.x.ai/v1', provider: 'xai' });
  assert.equal(config.endpoint, 'https://api.x.ai/v1');
  assert.equal(config.provider, 'xai');
  // Nothing configured is a local Ollama, as before.
  assert.equal(DEFAULT_VISION.provider, '');
  assert.equal(DEFAULT_VISION.endpoint, '');
});

// ---- readShotDescription: the answer, or nothing ----
//
// Every one of these came back from the vision model on 2026-09-07 and was
// stored as what he had been looking at.

test('the template copied back as the answer is not a description', () => {
  assert.equal(readShotDescription('Text: <everything you read>\nDoing: <one sentence>'), '');
  assert.equal(readShotDescription('Text: everything you read\nDoing: one sentence'), '');
});

test('a real answer keeps its content and loses the template brackets', () => {
  assert.equal(
    readShotDescription('Text: <August 2026>\nDoing: <Checking the calendar and tasks in a calendar application>'),
    'Text: August 2026\nDoing: Checking the calendar and tasks in a calendar application',
  );
});

test('a field the model had nothing for is dropped, not stored as the word none', () => {
  assert.equal(readShotDescription('Text: None\nDoing: The image is of a character from a game.'), 'Doing: The image is of a character from a game.');
  assert.equal(readShotDescription('Text: None\nDoing: None'), '');
  assert.equal(readShotDescription('Text: <nothing>\nDoing: An animated character on a black background.'), 'Doing: An animated character on a black background.');
});

test('an ordinary two-line read is left exactly as it was', () => {
  const said = 'Text: No VM guests are running outdated hypervisor (qemu) binaries on this host.\nDoing: Running a command in a terminal.';
  assert.equal(readShotDescription(said), said);
});

test('a model that answers in prose instead of labels is still heard', () => {
  assert.equal(readShotDescription('A terminal window with a build running in it.'), 'A terminal window with a build running in it.');
});
