import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DIRECT_MODELS, directCatalogEntry, parseDirectPricing, refreshDirectEntries } from '../electron/direct-catalog';
import { directCredentialName, parseProviderEnv, isAllowedTaskProvider } from '../electron/direct-providers';
import { taskIntent, selectTaskModel, nextTaskRole, routingTextHistory } from '../electron/task-router';
import { readModelRegistry, estimateReservation, readTaskPolicy, type ModelRole } from '../electron/model-registry';
import { toOpenAIBody, fromOpenAIReply, type ChatMessage } from '../electron/provider';
import { toAnthropicBody, fromAnthropicReply, streamAnthropic } from '../electron/anthropic-provider';
import { readOpenAIStream } from '../electron/openai-stream';
import { TaskController } from '../electron/task-controller';
import { TaskBridge } from '../electron/task-bridge';
import { assertOutboundSafe } from '../electron/outbound';
import { fromResponsesReply, toResponsesBody, streamResponses } from '../electron/responses-provider';
import { describeAttached } from '../electron/attachments';
import { makeToolReceipt } from '../electron/tool-receipt';

test('only application-generated receipt UUID metadata avoids a false payment-card match', t => {
  const id = '43572773-3516-4609-b51e-23f833301471';
  t.mock.method(require('node:crypto'), 'randomUUID', () => id);
  const receipt = makeToolReceipt('vault_read', {path:'Fixture.md'}, '{"ok":true,"text":"fictional content"}', 1790889551078, 1790889551078);
  assert.equal(receipt.executionId, id);
  assert.throws(() => assertOutboundSafe([{role:'user',content:id}]), /privacy_blocked/);
  assert.doesNotThrow(() => assertOutboundSafe([{role:'tool',content:JSON.stringify(receipt)}]));
  assert.throws(() => assertOutboundSafe([{role:'tool',content:JSON.stringify({...receipt,data:{card:'4111111111111111'}})}]), /privacy_blocked/);
  assert.throws(() => assertOutboundSafe([{role:'tool',content:JSON.stringify({...receipt,scope:{path:'4111111111111111.md'}})}]), /privacy_blocked/);
  assert.throws(() => assertOutboundSafe([{role:'tool',content:JSON.stringify({...receipt,executionId:'not-created-here'})}]), /privacy_blocked/);
});

const fixtures = JSON.parse(readFileSync(path.join(__dirname, '../../tests/fixtures/direct-pricing.json'), 'utf8'));
const local = { provider: 'ollama', model: 'qwen-local', endpoint: 'http://127.0.0.1:11436', temperature: 0.7 };
const direct = DIRECT_MODELS.map(model => directCatalogEntry(model, fixtures[model.model])!);
const entries = readModelRegistry({ entries: direct }, { local, vision: { model: local.model, enabled: true } });
const request = { cloudAllowed: true, budgetMicros: 500_000, conversation: [{ role: 'user', content: 'A synthetic task.' }], available: (entry: typeof entries[number]) => entry.config.provider !== 'anthropic' };

test('preliminary phone routing excludes UI attachment metadata but keeps outgoing content private', () => {
  const history = [{ role: 'assistant', content: 'Here is the picture.', attachments: [{ saved: '/tmp/sk-syntheticattachmentidentifier1234.png', id: 'private UI metadata' }] },
    { role: 'user', content: 'Tell me a joke.' }];
  assert.throws(() => assertOutboundSafe(history), /outbound_privacy_blocked/);
  const text = routingTextHistory(history);
  assert.equal(selectTaskModel(entries, 'conversation', { ...request, conversation: text })?.config.model, 'mimo-v2.6-pro');
  assert.ok(history[0].attachments, 'routing must not mutate stored history');
  assert.equal(selectTaskModel(entries, 'conversation', { ...request, conversation: routingTextHistory([{role: 'user', content: 'password: synthetic-private-value'}]) }), undefined);
  const expanded = [...text, { role: 'user', content: 'Read attachment contents: password: synthetic-private-value' }];
  assert.equal(selectTaskModel(entries, 'conversation', { ...request, conversation: expanded }), undefined);
  assert.throws(() => assertOutboundSafe(expanded), /outbound_privacy_blocked/);
});

test('MiMo conversation, local errands, and each explicit task role are distinct', () => {
  const cases: [string, ModelRole][] = [
    ['Hello Haru, how are you?', 'conversation'], ['I had a very long day '.repeat(12), 'conversation'],
    ['Remind me to debug the server tomorrow', 'everyday'], ['Compare these GPU specs', 'affordable-cloud'],
    ['Hey, implement a function for this', 'specialist'], ['Write a report about this', 'specialist'],
    ['Plan the migration of this entire system', 'complex'], ['Give me an independent review', 'premium'],
    ['Ask Kimi about this', 'complex'], ['Use Astra for this', 'premium'],
  ];
  for (const [text, role] of cases) assert.equal(taskIntent(text).role, role, text);
  assert.equal(taskIntent('Describe this', { pictures: true }).role, 'affordable-cloud');
  assert.equal(taskIntent('What happened?', { perception: true }).role, 'local-perception');
  assert.equal(taskIntent('Continue', { history: [{ role: 'user', content: 'Debug this code' }] }).role, 'specialist');
  assert.equal(selectTaskModel(entries, 'conversation', request)?.config.model, 'mimo-v2.6-pro');
  assert.equal(selectTaskModel(entries, 'complex', request)?.config.model, 'kimi-k3');
});

test('missing Sonnet key substitutes Kimi, while privacy, price and direct-origin rules hold', () => {
  assert.equal(selectTaskModel(entries, 'specialist', request)?.config.model, 'kimi-k3');
  assert.equal(selectTaskModel(entries, 'specialist', { ...request, available: () => true })?.config.model, 'claude-sonnet-5');
  for (const role of ['conversation', 'affordable-cloud', 'specialist', 'complex', 'premium'] as ModelRole[]) {
    assert.equal(selectTaskModel(entries, role, { ...request, cloudAllowed: false }), undefined);
    assert.equal(selectTaskModel(entries, role, { ...request, budgetMicros: 0 }), undefined);
    assert.equal(selectTaskModel(entries, role, { ...request, conversation: [{ role: 'user', content: 'password: synthetic-private-value' }] }), undefined);
  }
  const venice = { ...entries.find(e => e.role === 'complex')!, config: { ...local, provider: 'venice', endpoint: 'https://api.venice.ai/api/v1' } };
  assert.equal(selectTaskModel([venice], 'complex', { ...request, available: () => true }), undefined);
  assert.equal(selectTaskModel(entries, 'premium', { ...request, conversation: [{ role: 'user', content: 'x'.repeat(40_000) }] }), undefined);
});

test('quality handoff chooses the next suitable role and terminates at premium', () => {
  const intent = taskIntent('Hello');
  assert.equal(nextTaskRole('conversation', intent), 'affordable-cloud');
  assert.equal(nextTaskRole('affordable-cloud', intent), 'complex');
  assert.equal(nextTaskRole('complex', intent), 'premium');
  assert.equal(nextTaskRole('specialist', intent), 'premium');
  assert.equal(nextTaskRole('premium', intent), undefined);
});

test('official pricing rows parse, detect changes, and reject unknown formats', () => {
  assert.deepEqual(direct.map(e => [e.pricing.inputUsdPerMillion, e.pricing.outputUsdPerMillion]), [[0.435, 0.87], [0.3, 1.2], [4, 10], [6, 15], [12.5, 50]]);
  for (const model of DIRECT_MODELS) assert.equal(parseDirectPricing(model.model, '<html>unavailable</html>'), null);
  assert.equal(parseDirectPricing('deepseek-flash', fixtures['deepseek-flash'].replace('PEAK $0.3 ', 'PEAK $0.4 '))?.inputUsdPerMillion, 0.4);
  assert.equal(parseDirectPricing('kimi-k3', fixtures['kimi-k3'].replace('`15.00`', '`16.00`'))?.outputUsdPerMillion, 16);
  assert.equal(parseDirectPricing('gpt-6-astra', fixtures['gpt-6-astra'].replace('$50', '$55'))?.extended?.outputUsdPerMillion, 82.5);
  assert.equal(parseDirectPricing('mimo-v2.6-pro', fixtures['mimo-v2.6-pro'].replace('$0.87', '$0.9'))?.outputUsdPerMillion, 0.9);
  assert.equal(parseDirectPricing('claude-sonnet-5', fixtures['claude-sonnet-5'].replace('$10', '$11'))?.outputUsdPerMillion, 11);
});

test('refresh preserves disabled settings, counters, and concurrent deployment changes; stale rates expire', () => {
  const saved = { entries: direct.map(e => ({ ...e, enabled: false, observed: { attempts: 9, successes: 7 } })) };
  const fresh = refreshDirectEntries(saved, direct);
  assert.equal(fresh.entries[0].enabled, false); assert.equal(fresh.entries[0].observed.attempts, 9);
  saved.entries[0].config = { ...saved.entries[0].config, model: 'different-model' };
  const refreshed = refreshDirectEntries(saved, direct);
  assert.equal(refreshed.entries[0].config.model, 'different-model');
  const stale = readModelRegistry({ entries: direct.map(e => ({ ...e, pricingVerifiedAt: Date.now() - 86_401_000 })) }, { local });
  assert.equal(selectTaskModel(stale, 'conversation', request), undefined);
  const astra = entries.find(e => e.role === 'premium')!;
  const estimate = estimateReservation(astra, [{ role: 'user', content: 'x'.repeat(273_000) }], 100)!;
  assert.equal(estimate.costMicros, Math.ceil(estimate.inputTokens * 25 + 100 * 75));
});

test('credential lookup is exact-origin and dotenv is parsed without execution', () => {
  assert.equal(directCredentialName('https://api.moonshot.ai/v1'), 'MOONSHOT_API_KEY');
  for (const endpoint of ['http://api.openai.com/v1', 'https://api.openai.com.evil.test', 'https://api.openai.com:444', 'https://user@api.openai.com', 'https://api.openai.com/?key=a', 'https://api.venice.ai/api/v1']) assert.equal(directCredentialName(endpoint), undefined);
  assert.deepEqual(parseProviderEnv('export OPENAI_API_KEY="sample"\nANTHROPIC_API_KEY=\nMIMO_API_KEY=$(printf unsafe)\n# ignored'), { OPENAI_API_KEY: 'sample', ANTHROPIC_API_KEY: '', MIMO_API_KEY: '$(printf unsafe)' });
});

test('reasoning caps and tool continuation survive without leaking state to another model', () => {
  const conversation: ChatMessage[] = [{ role: 'user', content: 'Check this' }, { role: 'assistant', content: '', reasoning_content: 'internal test state', reasoning_model: 'kimi-k3', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', tool_name: 'read', content: 'result' }];
  const kimi: any = toOpenAIBody({ model: 'kimi-k3', conversation, maxTokens: 512, temperature: 0.8 });
  assert.equal(kimi.max_completion_tokens, 512); assert.equal(kimi.max_tokens, undefined); assert.equal(kimi.temperature, undefined); assert.equal(kimi.reasoning_effort, 'low');
  assert.equal(kimi.messages[1].reasoning_content, 'internal test state'); assert.equal(kimi.messages[2].tool_call_id, 'c1');
  const mimo: any = toOpenAIBody({ model: 'mimo-v2.6-pro', conversation, maxTokens: 512, temperature: 0.8 });
  assert.equal(mimo.max_completion_tokens, 512); assert.equal(mimo.thinking.type, 'disabled'); assert.equal(mimo.messages[1].reasoning_content, undefined);
  assert.equal((toOpenAIBody({ model: 'deepseek-flash', conversation, temperature: 0.7 }) as any).thinking.type, 'disabled');
  assert.equal(fromOpenAIReply({ choices: [{ message: { role: 'assistant', content: 'ok', reasoning_content: 'state' } }] }, 'kimi-k3').reasoning_model, 'kimi-k3');
});

const sse = (events: unknown[], end = '') => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + end);
test('OpenAI streams hide reasoning, preserve tool IDs, accept final lines and reject truncation', async () => {
  let visible = '';
  const reply = await readOpenAIStream(sse([
    { choices: [{ delta: { reasoning_content: 'private test state' } }] },
    { choices: [{ delta: { content: 'Done', tool_calls: [{ index: 0, id: 'id1', function: { name: 'read', arguments: '{' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
  ], 'data: [DONE]'), text => visible += text, 'kimi-k3');
  assert.equal(visible, 'Done'); assert.equal(reply.reasoning_content, 'private test state'); assert.equal(reply.tool_calls?.[0].function?.arguments, '{}');
  await assert.rejects(readOpenAIStream(sse([{ choices: [{ delta: { content: 'partial' } }] }]), () => {}), /incomplete_stream/);
});

test('Anthropic native messages preserve tool results, images and signed reasoning blocks', async () => {
  const model = 'claude-sonnet-5';
  const assistant = fromAnthropicReply({ content: [{ type: 'thinking', thinking: 'state', signature: 'signed' }, { type: 'tool_use', id: 'c1', name: 'read', input: {} }] }, model);
  const body = toAnthropicBody({ model, maxTokens: 512, conversation: [{ role: 'system', content: 'Haru' }, { role: 'user', content: 'Look', images: ['iVBORw0KGgo='] }, assistant, { role: 'tool', tool_call_id: 'c1', tool_name: 'read', content: 'result' }] });
  assert.equal(body.system, 'Haru'); assert.equal(body.messages[0].content[1].type, 'image');
  assert.equal(body.messages[1].content[0].signature, 'signed'); assert.equal(body.messages[2].content[0].tool_use_id, 'c1');
  let text = '';
  const reply = await streamAnthropic(sse([{ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'state' } }, { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } }, { type: 'message_stop' }]), model, chunk => text += chunk);
  assert.equal(text, 'Hello'); assert.equal(reply.content, 'Hello');
  await assert.rejects(streamAnthropic(sse([]), model, () => {}), /incomplete_stream/);
});

test('received protocol IDs avoid false positives without exempting fabricated IDs or tool data', () => {
  const id = 'call_00_YtUDyIF6PXctlZrGitgX9795';
  const fabricated: ChatMessage = { role: 'assistant', tool_calls: [{ id, function: { name: 'read', arguments: '{}' } }] };
  assert.throws(() => assertOutboundSafe([fabricated]), /privacy_blocked/);
  const received = fromOpenAIReply({ choices: [{ message: { role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }] } }] }, 'deepseek-flash');
  assert.doesNotThrow(() => assertOutboundSafe([received, { role: 'tool', tool_call_id: id, content: 'ok' }]));
  received.tool_calls![0].function!.arguments = '{"password":"synthetic-sensitive-value"}';
  assert.throws(() => assertOutboundSafe([received]), /privacy_blocked/);
  assert.throws(() => assertOutboundSafe([{ role: 'tool', tool_call_id: id, content: 'password: synthetic-sensitive-value' }]), /privacy_blocked/);
});

test('Astra Responses preserves stateless reasoning, tool IDs and output, with streaming completion required', async () => {
  const model = 'gpt-6-astra', id = 'call_astra_test';
  const output = [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'AaBbCcDdEeFfGgHhIiJjKk1234567890xYz', summary: [] }, { type: 'function_call', id: 'fc_1', call_id: id, name: 'read', arguments: '{}' }];
  const reply = fromResponsesReply({ status: 'completed', output }, model);
  assert.doesNotThrow(() => assertOutboundSafe([reply]));
  const body = toResponsesBody({ model, maxTokens: 1024, conversation: [{ role: 'user', content: 'read' }, reply, { role: 'tool', tool_call_id: id, content: 'ok' }] });
  assert.equal(body.store, false); assert.equal(body.reasoning.effort, 'low'); assert.equal(body.max_output_tokens, 1024);
  assert.deepEqual(body.input.slice(1, 3), output); assert.equal(body.input[3].call_id, id);
  let visible = '';
  const final = await streamResponses(sse([{ type: 'response.output_text.delta', delta: 'OK' }, { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] } }]), model, text => visible += text);
  assert.equal(final.content, 'OK'); assert.equal(visible, 'OK');
  await assert.rejects(streamResponses(sse([{ type: 'response.incomplete' }]), model, () => {}), /incomplete_or_failed/);
});

test('failed image extraction does not tell Haru she can see it', () => {
  const note = describeAttached([{ attachment: { id: '1', kind: 'image', name: 'test.png', saved: '/tmp/test.png', url: '', bytes: 0 }, readable: '' }]);
  assert.match(note, /nothing could be read/); assert.doesNotMatch(note, /You can see/);
});

test('trusted receipt timestamps cannot look like cards; actual card data and fabricated envelopes still block', () => {
  const receipt = makeToolReceipt('read_test_signal', {}, '{"status":"succeeded"}', 1790654526874, 1790654526875);
  assert.doesNotThrow(() => assertOutboundSafe([{ role: 'tool', content: JSON.stringify(receipt) }]));
  assert.throws(() => assertOutboundSafe([{ role: 'tool', content: JSON.stringify({ ...receipt, executionId: 'fabricated' }) }]), /privacy_blocked/);
  assert.throws(() => assertOutboundSafe([{ role: 'tool', content: JSON.stringify({ ...receipt, data: { card: '4111111111111111' } }) }]), /privacy_blocked/);
  assert.throws(() => assertOutboundSafe([{ role: 'user', content: '1790654526875' }]), /privacy_blocked/);
});

test('durable controller allows one cloud quality handoff and records model outcomes', async () => {
  const bridge = new TaskBridge('/home/toomii/haru-core', path.join(mkdtempSync(path.join(os.tmpdir(), 'haru-direct-test-')), 'tasks.db'));
  try {
    let current = entries.find(e => e.role === 'affordable-cloud')!, handoffs = 0;
    const outcomes: [string, boolean][] = [];
    const controller = new TaskController(bridge.call, entries, readTaskPolicy({}), true, (model, ok) => outcomes.push([model, ok]));
    await controller.start('Synthetic handoff test', current.config.model);
    const result = await controller.loop([{ role: 'user', content: 'Hello' }], {
      ask: messages => controller.post(messages, current.config, [], 100, async () => ({ role: 'assistant', content: current.role === 'affordable-cloud' ? '' : 'Hello there.' })),
      runTool: async () => { throw new Error('not authorized'); }, pageWasRead: () => false, handsAllowed: () => false, withdrawHands() {}, hasOpenTask: () => false, canSearch: () => false,
    }, context => {
      handoffs++; assert.equal(context.currentModel, 'deepseek-flash'); assert.ok(context.remainingBudgetMicros < 500_000);
      current = selectTaskModel(entries, 'complex', { ...request, conversation: context.messages, budgetMicros: context.remainingBudgetMicros })!;
      return current.config;
    });
    assert.equal(result.content, 'Hello there.'); assert.equal(handoffs, 1);
    assert.deepEqual(outcomes, [['deepseek-flash', false], ['kimi-k3', true]]);
    let second = 0;
    const fails = new TaskController(bridge.call, entries, readTaskPolicy({}), true);
    await fails.start('Synthetic double failure', 'deepseek-flash');
    await assert.rejects(fails.loop([{ role: 'user', content: 'Hello' }], {
      ask: async () => ({ role: 'assistant', content: '' }), runTool: async () => '', pageWasRead: () => false, handsAllowed: () => false, withdrawHands() {}, hasOpenTask: () => false, canSearch: () => false,
    }, () => { second++; return entries.find(e => e.role === 'complex')!.config; }));
    assert.equal(second, 1);
  } finally { bridge.close(); }
});


test('Sonnet 5.5 on Venice is eligible only at the exact approved endpoint and within privacy and budget gates', () => {
  const config = { provider: 'venice', model: 'claude-sonnet-5-5', endpoint: 'https://api.venice.ai/api/v1', temperature: 0.7 };
  const specialist = { ...entries.find(e => e.role === 'specialist')!, config };
  const available = { ...request, available: () => true };
  assert.equal(selectTaskModel([specialist], 'specialist', available)?.config.model, config.model);
  assert.equal(selectTaskModel([specialist], 'specialist', { ...available, cloudAllowed: false }), undefined);
  assert.equal(selectTaskModel([specialist], 'specialist', { ...available, budgetMicros: 0 }), undefined);
  assert.equal(selectTaskModel([specialist], 'specialist', { ...available, conversation: [{ role: 'user', content: 'password: synthetic-private-value' }] }), undefined);
  for (const endpoint of ['http://api.venice.ai/api/v1', 'https://api.venice.ai.evil.test/api/v1', 'https://api.venice.ai/api/v1?x=1']) assert.equal(isAllowedTaskProvider({ ...config, endpoint }), false);
  assert.equal(isAllowedTaskProvider({ ...config, model: 'unrequested-model' }), false);
});


test('Sonnet 5.5 empty tool arguments normalize in ordinary and streaming responses', async () => {
  const payload = { choices: [{ message: { role: 'assistant' as const, content: '', tool_calls: [{ id: 'call1', type: 'function' as const, function: { name: 'read_test_signal', arguments: '' } }] } }] };
  assert.equal(fromOpenAIReply(payload, 'claude-sonnet-5-5').tool_calls?.[0].function?.arguments, '{}');
  payload.choices[0].message.tool_calls[0].function.arguments = '{broken';
  assert.equal(fromOpenAIReply(payload, 'claude-sonnet-5-5').tool_calls?.[0].function?.arguments, '{broken');
  const reply = await readOpenAIStream(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'read_test_signal', arguments: '' } }] } }] }, { choices: [{ finish_reason: 'tool_calls' }] }]), () => {}, 'claude-sonnet-5-5');
  assert.equal(reply.tool_calls?.[0].function?.arguments, '{}');
});
