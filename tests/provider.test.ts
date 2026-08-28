// The body, per model, as the endpoint actually accepts it.
//
// Every row here is a refusal that was seen from the live endpoint, not read
// in a document: OpenAI's reasoning models reject max_tokens, reject any
// temperature but the default, and from gpt-5.1 on reject function tools
// unless reasoning is switched off. The phone's every message went out as
// max_tokens to gpt-5.6-terra and came back a 400. The last test is the one
// that matters most: nothing else that speaks this dialect may change shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openAIQuirks, toOpenAIBody } from '../electron/provider';

const conversation = [{ role: 'user', content: 'hi' }];
const tools = [{ type: 'function', function: { name: 'noop', description: '', parameters: { type: 'object', properties: {}, required: [] } } }];
const body = (model: string) => toOpenAIBody({ model, conversation, tools, temperature: 0.7, maxTokens: 160, json: true, stream: true }) as Record<string, unknown>;

test('gpt-5.1 and later: max_completion_tokens, reasoning off, temperature kept, tools kept', () => {
  for (const model of ['gpt-5.6-terra', 'gpt-5.1', 'gpt-5.4-mini', 'gpt-5.5-pro']) {
    const out = body(model);
    assert.equal(out.max_completion_tokens, 160, model);
    assert.equal('max_tokens' in out, false, model);
    assert.equal(out.reasoning_effort, 'none', model);
    assert.equal(out.temperature, 0.7, model);
    assert.ok(Array.isArray(out.tools), model);
    assert.deepEqual(out.response_format, { type: 'json_object' }, model);
    assert.equal(out.stream, true, model);
  }
});

test('the original gpt-5 line: minimal reasoning, and no temperature at all', () => {
  for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano']) {
    const out = body(model);
    assert.equal(out.max_completion_tokens, 160, model);
    assert.equal(out.reasoning_effort, 'minimal', model);
    assert.equal('temperature' in out, false, model);
  }
});

test('the o-series: max_completion_tokens, left to its own reasoning default, no temperature', () => {
  for (const model of ['o1', 'o3', 'o4-mini']) {
    const out = body(model);
    assert.equal(out.max_completion_tokens, 160, model);
    assert.equal('reasoning_effort' in out, false, model);
    assert.equal('temperature' in out, false, model);
  }
});

test('everything else keeps exactly the body it always had', () => {
  for (const model of ['grok-4.20-0309-non-reasoning', 'grok-4.6', 'gpt-4.1', 'gpt-4o-mini', 'llama-3.3-70b', 'qwen2.5:7b-instruct-q4_K_M']) {
    const out = body(model);
    assert.equal(out.max_tokens, 160, model);
    assert.equal('max_completion_tokens' in out, false, model);
    assert.equal('reasoning_effort' in out, false, model);
    assert.equal(out.temperature, 0.7, model);
  }
});

test('a model name is matched by family, not by accident', () => {
  // gpt-4o is not the o-series, and gpt-oss is neither gpt-5 nor an o-model.
  assert.equal(openAIQuirks('gpt-4o').maxTokensKey, 'max_tokens');
  assert.equal(openAIQuirks('gpt-oss:20b').maxTokensKey, 'max_tokens');
  assert.equal(openAIQuirks('o1-pro').maxTokensKey, 'max_completion_tokens');
  // Whitespace and case from a Setup field do not change the answer.
  assert.equal(openAIQuirks('  GPT-5.6-Terra ').reasoningEffort, 'none');
});

test('no max tokens asked for means no max tokens sent, whichever the key would have been', () => {
  const out = toOpenAIBody({ model: 'gpt-5.6-terra', conversation, temperature: 1 }) as Record<string, unknown>;
  assert.equal('max_tokens' in out, false);
  assert.equal('max_completion_tokens' in out, false);
});
