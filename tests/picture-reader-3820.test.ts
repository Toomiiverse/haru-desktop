// 3820: in hosted mode Baseten DeepSeek reads a picture for the chat model; the picture crosses the Core only as a reference,
// a reading that can't leave as text sends the picture itself, and a message's pictures are read together.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../electron/core-policy-sync';
import { TaskController } from '../electron/task-controller';
import { coreHostedLook } from '../electron/core-perception';
import { foldCoreAttachments, readingUsable } from '../electron/core-attachments';
import { withImageBytes } from '../electron/core-harness-media';
import { assertOutboundSafe } from '../electron/outbound';

const READER = { id: 'picture-reader', role: 'affordable-cloud', local: false, enabled: true,
  config: { provider: 'openai', model: 'deepseek-ai/DeepSeek-V4.1-Flash-Fast', endpoint: 'https://inference.baseten.co/v1', temperature: .2 },
  capabilities: { text: true, image: true, tools: false, contextWindow: 131072, maxOutputTokens: 1024 },
  pricing: { inputUsdPerMillion: .6, outputUsdPerMillion: 2.4 } } as any;

test('the hosted reader sends the Core a reference, gives the provider the bytes back, and runs one attempt without tools', async () => {
  const shot = 'iVBOR' + 'z'.repeat(400_000), core: string[] = [];
  (policy as any).corePolicySync = (op: string, args: unknown[]) => { core.push(JSON.stringify(args)); return op === 'attachments.conversation' ? [{ role: 'user', content: 'READ', images: true }] : null; };
  const proto = TaskController.prototype as any, start = proto.start, compose = proto.compose;
  let seen: any = {};
  proto.start = async function (request: string, model: string, priority: string) { seen = { request, model, priority, policy: this.policy, entries: this.entries }; };
  proto.compose = async function (ask: () => Promise<any>, messages: any[]) { core.push(JSON.stringify(messages)); return (await ask()).content; };
  try {
    let sent: any[] = [];
    const out = await coreHostedLook(shot, READER, { ask: 'READ', numPredict: 450, timeoutMs: 15000 },
      { rpc: (async () => ({})) as any, policy: () => ({ enabled: true, taskBudgetMicros: 5e5, dailyBudgetMicros: 5e6, maxAttempts: 4 } as any),
        send: async (messages, config, options) => { sent = messages; assert.equal(config.model, READER.config.model); assert.deepEqual(options, { tools: false, table: [], maxTokens: 450 }); return { role: 'assistant', content: 'A red bike.' }; } });
    assert.deepEqual(out, { description: 'A red bike.', model: READER.config.model });
    assert.ok(core.every(c => c.length < 1000), 'no Core call carries the picture');
    assert.equal(withImageBytes(sent)[0].images![0], shot);   // the provider boundary restores it
    assert.deepEqual([seen.request, seen.priority, seen.entries], ['Picture reading (no actions)', 'foreground', [READER]]);
    assert.deepEqual([seen.policy.maxAttempts, seen.policy.maxToolCalls, seen.policy.deadlineMs], [1, 0, 15000]);
  } finally { proto.start = start; proto.compose = compose; }
});

test('a reading folds as text; an empty, secret-naming, local-only or failed reading sends the picture itself', async () => {
  (policy as any).corePolicySync = (op: string, args: any[]) => op === 'attachments.fold'
    ? [{ index: 0, files: args[1][0][1].map((a: any) => ({ attachment: a, action: 'read', fallback: 'image' })) }]
    : { opened: args[1], images: args[2] };
  const fold = async (reading: () => Promise<string>) => (await foldCoreAttachments([{ role: 'user', content: 'x' }],
    new Map([[0, [{ id: 'a', kind: 'image', name: 'p.png', saved: '/p.png' }]]]) as any, false, reading, f => 'bytes:' + f))[0];
  assert.deepEqual(await fold(async () => 'A red bike.'), { opened: [{ attachment: { id: 'a', kind: 'image', name: 'p.png', saved: '/p.png' }, readable: 'A red bike.' }], images: [] });
  for (const reading of [async () => '', async () => 'Sign in. Forgot password?', async () => 'Note: keep this local please', async () => { throw Error('402'); }])
    assert.deepEqual((await fold(reading)).images, ['bytes:/p.png']);
});

test("a message's pictures are read at once", async () => {
  (policy as any).corePolicySync = (op: string, args: any[]) => op === 'attachments.fold'
    ? [{ index: 0, files: args[1][0][1].map((a: any) => ({ attachment: a, action: 'read' })) }] : { opened: args[1], images: args[2] };
  const files = [1, 2, 3, 4].map(n => ({ id: String(n), kind: 'image', name: n + '.png', saved: '/' + n }));
  const started = Date.now();
  const [out] = await foldCoreAttachments([{ role: 'user', content: 'x' }], new Map([[0, files]]) as any, false,
    async a => { await new Promise(r => setTimeout(r, 100)); return 'read ' + a.name; }, f => f);
  assert.ok(Date.now() - started < 300, 'four 100 ms reads overlap');
  assert.deepEqual(out.opened.map((o: any) => o.readable), ['read 1.png', 'read 2.png', 'read 3.png', 'read 4.png']);   // order kept
});

test('the note a reading becomes passes the outbound privacy check', () => {
  const note = 'They have shown you a picture, "Screenshot 2026-10-14 000239.png". You looked at it, and this is everything you saw in it:\n'
    + 'A phone screen: Telstra bill $87.45 due 21 Oct; Dentist Thu 16 Oct 2:30 pm.\nTalk about it as something you saw yourself and do not recite it back unless they ask. '
    + 'If they ask about something that is not in it, say you cannot make it out.\n\nAnswer what they asked about it using only the available image or extracted content. Be clear when a detail could not be read or verified.';
  assert.ok(readingUsable(note));
  assert.doesNotThrow(() => assertOutboundSafe([{ role: 'user', content: 'what does this say?\n\n' + note, picturesRead: 1 } as any]));
});

test('main.ts sends hosted reads to the reader and drops the local-model notice on hosted turns', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(src.includes("look:(images:string|string[],command:any)=>command.entry?coreHostedLook(images,command.entry,{...command.options,timeoutMs:command.timeoutMs},{rpc:taskBridge.call,policy:()=>readTaskPolicy(store.get('ai.taskPolicy')),send:sendToProviderAdmitted})"));
  assert.ok(src.includes('if (pictures && !brain.sees && !brain.hosted && vetted.at(-1)?.attachments'));
});
