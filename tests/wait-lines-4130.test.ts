// 4130: during a phone turn the "give me a sec" line goes into her reply bubble and is cleared when the real answer starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitSink, withWaitLine } from '../electron/core-attachments';
test('the wait line is shown and voiced, then cleared by the first real chunk', () => {
  const chunks: string[] = [], said: string[] = [];
  const w = withWaitLine(c => chunks.push(c), s => said.push(s));
  waitSink.run(w.sink, () => waitSink.getStore()!('Reading. Do not hover.'));
  w.onChunk('Okay, it is an invoice');
  w.onChunk(' from Telstra.');
  assert.deepEqual(chunks, ['Reading. Do not hover.', '�', 'Okay, it is an invoice', ' from Telstra.']);
  assert.deepEqual(said, ['Reading. Do not hover.']);
});
test('a turn with no wait line streams exactly as before', () => {
  const chunks: string[] = [];
  const w = withWaitLine(c => chunks.push(c));
  w.onChunk('Hi'); w.onChunk('�'); w.onChunk('Hello');
  assert.deepEqual(chunks, ['Hi', '�', 'Hello']);
});
test('main.ts: phone text turns use the sink, calls and the desktop keep the old path', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes("const waitLine = withWaitLine(onChunkRaw, options?.call ? undefined : onSentence), onChunk = waitLine.onChunk;"));
  assert.ok(main.includes('waitSink.run(waitLine.sink, f))(() => ollamaChat(messages, config, { affect,'));
  assert.ok(main.includes("waiting:(line:string)=>{const sink=waitSink.getStore();if(sink){sink(line);return;}sendToWindows('chat:interject',line);void speak(line);}"));
});
