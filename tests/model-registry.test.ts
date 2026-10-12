import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TASK_POLICY, estimateReservation, isLocalConfig, readModelRegistry,
  readTaskPolicy, selectModel, usageCost, type ModelEntry, type ProviderConfig,
} from '../electron/model-registry';

const local: ProviderConfig = { provider: 'ollama', model: 'configured-qwen', endpoint: 'http://127.0.0.1:11436', temperature: 0.8 };
const specialist: ProviderConfig = { provider: 'venice', model: 'configured-specialist', endpoint: 'https://example.test/v1', temperature: 0.6 };
const price = { inputUsdPerMillion: 3, outputUsdPerMillion: 15, cachedInputUsdPerMillion: 0.3 };
const caps = { text: true, image: false, tools: true, contextWindow: 32_768, maxOutputTokens: 4_096 };
const messages = [{ role: 'user', content: 'Explain this test failure.' }];
function cloud(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return { id: 'specialist', role: 'specialist', config: specialist, local: false, enabled: true, capabilities: caps, pricing: price, ...overrides };
}

test('reserved local planner remains dispatchable but cannot win automatic routing',()=>{
 const registry=readModelRegistry({entries:[{id:'local-planner',role:'everyday',config:{...local,model:'planner'},capabilities:caps}]},{local});
 assert.ok(registry.some(entry=>entry.id==='local-planner'&&entry.enabled));
 for(const cloudAllowed of [false,true])assert.equal(selectModel(registry,{cloudAllowed,conversation:messages})?.config.model,local.model);
 assert.equal(selectModel(registry.filter(entry=>entry.id==='local-planner'),{cloudAllowed:true}),undefined);
});

test('conversation has a separate role; everyday remains local', () => {
  const registry = readModelRegistry(undefined, { local, specialist, conversation: { ...specialist, model: 'conversation-model' } });
  assert.equal(registry.find(entry => entry.role === 'everyday')?.config.model, local.model);
  assert.equal(registry.find(entry => entry.role === 'conversation')?.config.model, 'conversation-model');
  assert.equal(registry.find(entry => entry.role === 'specialist')?.pricing, null);
  assert.equal(selectModel(registry, { cloudAllowed: true })?.role, 'everyday');
  assert.equal(estimateReservation(registry.find(entry => entry.role === 'specialist')!, messages), undefined);
});

test('configured metadata enables a cloud route without relying on model names', () => {
  const registry = readModelRegistry({ entries: [
    { id: 'specialist', pricing: price, capabilities: { image: true, imageTokens: 1_500 } },
    { id: 'budget-worker', role: 'affordable-cloud', config: { ...specialist, model: 'any-name' }, capabilities: caps, pricing: { inputUsdPerMillion: 0.5, outputUsdPerMillion: 1 } },
  ] }, { local, specialist });
  assert.equal(registry.find(entry => entry.id === 'specialist')?.capabilities.image, true);
  assert.equal(selectModel(registry, { cloudAllowed: true, roleHint: ['specialist', 'affordable-cloud'], budgetMicros: 500_000 })?.id, 'budget-worker');
});

test('changing a deployment never inherits its old price or capabilities', () => {
  const registry = readModelRegistry({ entries: [
    { id: 'specialist', config: { ...specialist, model: 'replacement' }, capabilities: caps },
  ] }, { local, specialist: { ...specialist, pricing: price, capabilities: { image: true } } });
  const changed = registry.find(entry => entry.id === 'specialist')!;
  assert.equal(changed.pricing, null);
  assert.equal(changed.capabilities.image, false);
  assert.equal(selectModel([changed], { cloudAllowed: true }), undefined);
});

test('registry validates endpoints and fields, strips credentials, and ignores claimed locality', () => {
  const registry = readModelRegistry({ entries: [
    { ...cloud(), config: { ...specialist, apiKey: 'not-retained' }, local: true },
    { ...cloud(), id: 'bad-context', capabilities: { ...caps, contextWindow: 1 } },
    { ...cloud(), id: 'secret-url', config: { ...specialist, endpoint: 'https://example.test/?api_key=secret' } },
    { ...cloud(), id: 'unknown-role', role: 'unrestricted' },
    { ...cloud(), id: 'remote-eyes', role: 'local-perception' },
  ] }, { local });
  assert.deepEqual(registry.map(entry => entry.id), ['everyday', 'specialist']);
  assert.equal(registry[1].local, false);
  assert.equal(JSON.stringify(registry).includes('not-retained'), false);
  for (const endpoint of ['http://evil.test', 'http://127.0.0.1.evil.test', 'file:///tmp/ollama', 'http://192.168.1.1:11434']) {
    assert.equal(isLocalConfig({ ...local, endpoint }), false, endpoint);
  }
  assert.equal(isLocalConfig({ ...local, endpoint: 'http://[::1]:11434' }), true);
  assert.equal(readModelRegistry(undefined, { local: specialist }).some(entry => entry.role === 'everyday'), false);
  const protectedEveryday = readModelRegistry({ entries: [{ ...cloud(), id: 'everyday' }] }, { local });
  assert.equal(protectedEveryday.find(entry => entry.id === 'everyday')?.role, 'everyday');
});

test('images need explicit capabilities; matching local vision can supply them', () => {
  const without = readModelRegistry(undefined, { local, specialist });
  assert.equal(selectModel(without, { cloudAllowed: true, inputs: ['image'] }), undefined);
  const withVision = readModelRegistry(undefined, { local, vision: { enabled: true, model: local.model } });
  assert.equal(selectModel(withVision, { cloudAllowed: false, inputs: ['text', 'image'], tools: true })?.id, 'everyday');
  const different = readModelRegistry(undefined, { local, vision: { enabled: true, model: 'different-vision' } });
  assert.equal(selectModel(different, { cloudAllowed: false, inputs: ['image'] })?.id, 'local-perception');
  assert.equal(selectModel(different, { cloudAllowed: false, inputs: ['image'], tools: true }), undefined);
  const off = readModelRegistry(undefined, { local, vision: { enabled: false, model: local.model } });
  assert.equal(off[0].capabilities.image, false);
});

test('cloud policy, availability, tools, exclusions and budget constrain role preferences', () => {
  const entry = cloud();
  const options = { cloudAllowed: true, roleHint: 'specialist' as const, conversation: messages, maxOutputTokens: 100 };
  const required = estimateReservation(entry, messages, 100)!.costMicros;
  assert.equal(selectModel([entry], { ...options, budgetMicros: required })?.id, entry.id);
  assert.equal(selectModel([entry], { ...options, budgetMicros: required - 1 }), undefined);
  assert.equal(selectModel([entry], { ...options, cloudAllowed: false }), undefined);
  assert.equal(selectModel([entry], { ...options, available: () => false }), undefined);
  assert.equal(selectModel([entry], { ...options, excludeIds: [entry.id] }), undefined);
  assert.equal(selectModel([cloud({ enabled: false })], options), undefined);
  assert.equal(selectModel([cloud({ capabilities: { ...caps, tools: false } })], { ...options, tools: true }), undefined);
});

test('routing uses observed successful completion cost among eligible hinted workers', () => {
  const cheapButFailing = cloud({ id: 'cheap', pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 }, observed: { attempts: 100, successes: 1 } });
  const reliable = cloud({ id: 'reliable', pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 2 }, observed: { attempts: 100, successes: 95 } });
  assert.equal(selectModel([cheapButFailing, reliable], { cloudAllowed: true, roleHint: 'specialist' })?.id, 'reliable');
});

test('reservation includes UTF-8 text, tools, maximum output, and conservative image input', () => {
  const entry = cloud();
  const ascii = estimateReservation(entry, [{ role: 'user', content: 'aaaa' }], 100)!;
  const unicode = estimateReservation(entry, [{ role: 'user', content: '猫猫猫猫' }], 100)!;
  assert.ok(unicode.inputTokens > ascii.inputTokens);
  const tools = estimateReservation(entry, messages, 100, [{ type: 'function', function: { name: 'run', parameters: { type: 'object' } } }])!;
  const plain = estimateReservation(entry, messages, 100)!;
  assert.ok(tools.inputTokens > plain.inputTokens);
  assert.equal(plain.costMicros, Math.ceil(plain.inputTokens * 3 + 100 * 15));
  const picture = [{ role: 'user', content: 'read', images: ['base64-picture'] }];
  assert.equal(estimateReservation(entry, picture), undefined);
  const vision = cloud({ capabilities: { ...caps, image: true } });
  assert.equal(estimateReservation(vision, picture, 100)!.inputTokens, caps.contextWindow - 100);
  const bounded = cloud({ capabilities: { ...caps, image: true, imageTokens: 1_000 } });
  assert.ok(estimateReservation(bounded, picture, 100)!.inputTokens < 2_000);
});

test('invalid and overflowing requests cannot buy a smaller reservation than the request', () => {
  const entry = cloud();
  assert.equal(estimateReservation(entry, [{ role: 'user', content: 'x'.repeat(caps.contextWindow) }]), undefined);
  assert.equal(estimateReservation(entry, messages, caps.maxOutputTokens + 1), undefined);
  assert.equal(estimateReservation(entry, messages, -1), undefined);
  assert.equal(estimateReservation(entry, messages, Infinity), undefined);
  assert.equal(estimateReservation(cloud({ pricing: null }), messages), undefined);
  assert.equal(estimateReservation(cloud({ capabilities: { ...caps, tools: false } }), messages, 10, [{}]), undefined);
});

test('actual usage rounds to microUSD, includes output and respects cached pricing', () => {
  const entry = cloud();
  assert.equal(usageCost(entry, { prompt_tokens: 1_000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } }), 3_960);
  assert.equal(usageCost(entry, { prompt_eval_count: 1_000, eval_count: 100 }), 4_500);
  assert.equal(usageCost(entry, { input_tokens: 1_000, output_tokens: 100 }), 4_500);
  assert.equal(usageCost(cloud({ pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.1 } }), { prompt_tokens: 1, completion_tokens: 1 }), 1);
  assert.equal(usageCost(readModelRegistry(undefined, { local })[0], undefined), 0);
});

test('missing, incomplete or invalid usage retains the reservation', () => {
  const entry = cloud();
  for (const value of [undefined, {}, { prompt_tokens: 1_000 }, { completion_tokens: 0 }, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: NaN }, { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 2 } }]) {
    assert.equal(usageCost(entry, value), undefined);
  }
  assert.equal(usageCost(cloud({ pricing: null }), { prompt_tokens: 1, completion_tokens: 1 }), undefined);
  assert.equal(usageCost(entry, { prompt_tokens: 0, completion_tokens: 0 }), 0);
});

test('approved default caps cover all attempts and accept explicit zero spending', () => {
  assert.deepEqual(readTaskPolicy(undefined), DEFAULT_TASK_POLICY);
  assert.equal(readTaskPolicy({ taskBudgetMicros: 0 }).taskBudgetMicros, 0);
  assert.equal(readTaskPolicy({ dailyBudgetMicros: 0 }).dailyBudgetMicros, 0);
  assert.equal(readTaskPolicy({ enabled: false }).enabled, false);
  assert.equal(readTaskPolicy({ maxEscalations: 0 }).maxEscalations, 0);
  assert.equal(readTaskPolicy({ maxEscalations: 2 }).maxEscalations, 1);
  assert.equal(readTaskPolicy({ taskBudgetMicros: Infinity, deadlineMs: -1 }).taskBudgetMicros, 500_000);
  assert.equal(readTaskPolicy({ maxAttempts: 0 }).maxAttempts, 12);
});
