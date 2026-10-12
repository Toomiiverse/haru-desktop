// Exercise the actual phone/call adapter without launching Electron or writing
// production state. The old interruption branch mutates these mood sinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { callAside } from '../electron/evi';
import { INTERRUPTED_ASIDE } from '../electron/wake';
import { cleaningChunks, stripDelivery } from '../electron/delivery';

const source = readFileSync(resolve('electron/main.ts'), 'utf8');
const start = source.indexOf('    async sayStream(');
const end = source.indexOf('\n    },', start) + '\n    },'.length;
assert.ok(start > 0 && end > start, 'the real phone adapter must be present');
const scratch = mkdtempSync(join(tmpdir(), 'haru-interruption-adapter-'));
let adapter: string;
try {
  const input = join(scratch, 'adapter.ts');
  writeFileSync(input, 'const deps = {\n' + source.slice(start, end) + '\n};');
  execFileSync(resolve('node_modules/.bin/tsc'), ['--target', 'ES2022', '--noCheck', '--noResolve', input], { cwd: scratch });
  adapter = readFileSync(join(scratch, 'adapter.js'), 'utf8');
} finally { rmSync(scratch, { recursive: true, force: true }); }

for (const call of [false, true]) {
  test(`${call ? 'a call' : 'phone talk mode'} interruption alone never changes feelings or vitals`, async () => {
    const changes: string[] = [];
    const prompts: any[] = [];
    const delivered: string[] = [];
    const context: any = {
      console: { log() {} }, Date, callAside, INTERRUPTED_ASIDE, cleaningChunks, stripDelivery,
      store: { get: (key: string) => key === 'ai.config' ? { model: 'test' } : key === 'chat.messages' ? [] : '2026-09-30' },
      readAttachments: () => [], settingSaid: async () => null, herAsleepNow: () => false,
      quickHit: () => null, newTrace: () => ({ id: 'test', mark() {}, done() {}, unmark() {} }),
      sentenceStreamer: () => ({ feed: (s: string) => delivered.push(s), flush() {}, reset() {} }),
      sendToWindows() {},
      nudgeVitals: (event: string) => changes.push('vitals:' + event),
      feelNow: (event: string) => changes.push('feelings:' + event),
      ollamaChat: async (messages: any[], _config: unknown, options: any) => {
        prompts.push({ messages, options });
        options.onChunk('[affectionate] The blue one, got it.');
        return { content: '[affectionate] The blue one, got it.' };
      },
    };
    vm.createContext(context); vm.runInContext(adapter + '\nglobalThis.sayStream = deps.sayStream;', context);
    for (const interrupted of [false, true, true]) {
      const result = await context.sayStream('Wait, the blue one.', () => {}, [], { call, interrupted });
      assert.equal(result.reply, 'The blue one, got it.');
    }
    assert.deepEqual(changes, [], 'repeated barge-ins must not accumulate emotional penalties');
    assert.equal(prompts[1].messages.at(-1).content, 'Wait, the blue one.');
    assert.equal(prompts[1].options.aside, call ? callAside(true) : INTERRUPTED_ASIDE);
    assert.equal(delivered.length, 3, 'each new turn still reaches the speech streamer');
  });
}
