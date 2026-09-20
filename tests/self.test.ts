// How she describes herself, and what of herself she may change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMyself, describeSettings, planChange, readSelfSnapshot, SETTING_NAMES, shortModelName } from '../electron/self';

const config: Record<string, unknown> = {
  'ai.conversation': { provider: 'venice', model: 'kimi-k2-5', endpoint: 'https://api.venice.ai/api/v1' },
  'ai.nudge': { provider: 'venice', model: 'qwen3-6-35b-a3b' },
  'ai.config': { model: 'hf.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF:Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q4_K_M.gguf', endpoint: 'http://127.0.0.1:11436' },
  'ai.numCtx': 20480,
  'ai.historyChars': 6000,
  'ai.summaryDays': 14,
  escalate: { enabled: true, minWords: 25, provider: { model: 'gpt-5.6-terra' } },
  voice: { engine: 'breeze', voiceId: 'haru', webEnabled: true, desktopEnabled: false },
  call: { engine: 'local' },
  listen: { engine: 'local', endpoint: 'http://127.0.0.1:9881' },
  'her.sleep': { enabled: true, fallbackBedtime: '23:30', fallbackWake: '08:00' },
  'her.sleepState': { day: '2026-09-06', bedtime: 1350, wake: 420, decidedAt: '', wakeHandled: false, announced: true },
  push: { prefs: { random: true, events: true, weather: false, quietFrom: '23:00', quietTo: '06:00', upBy: '09:00' } },
  search: { provider: 'brave', place: 'Perth, Australia' },
  whereabouts: { enabled: true },
  body: { enabled: true },
  system: { config: { enabled: true, level: 2 } },
};
const get = (key: string) => config[key];

test('the snapshot reads the facts that answer "what is your system"', () => {
  const s = readSelfSnapshot(get);
  assert.deepEqual(s.conversation, { provider: 'venice', model: 'kimi-k2-5' });
  assert.deepEqual(s.nudges, { provider: 'venice', model: 'qwen3-6-35b-a3b' });
  assert.equal(s.local.endpoint, 'http://127.0.0.1:11436');
  assert.equal(s.local.numCtx, 20480);
  assert.equal(s.escalation.model, 'gpt-5.6-terra');
  assert.equal(s.escalation.researchStaysHome, true, 'a conversation route keeps research home (escalate.ts)');
  assert.deepEqual(s.voice, { engine: 'breeze', voiceId: 'haru', onThePhone: true, atTheDesk: false });
  assert.equal(s.call.engine, 'local');
  assert.deepEqual(s.sleep.tonight, { bedtime: '22:30', wake: '07:00' });
  assert.equal(s.pushes.weather, false);
  assert.equal(s.system.level, 2);
  // Missing keys fall to sane defaults rather than throwing.
  const bare = readSelfSnapshot(() => undefined);
  assert.equal(bare.conversation, null);
  assert.equal(bare.voice.engine, 'off');
  assert.equal(bare.sleep.tonight, null);
});

test('the description names the models and the engines, in her second person, and shortens the local id', () => {
  const text = describeMyself(readSelfSnapshot(get));
  assert.match(text, /Every reply you give comes from kimi-k2-5 \(venice, hosted\)/);
  assert.match(text, /nudges, the weather, your night — are written by qwen3-6-35b-a3b/);
  assert.match(text, /Pictures, files and code can go out to gpt-5\.6-terra; plain research stays with you/);
  assert.match(text, /breeze engine as the voice "haru" — on the phone, silent at the desk/);
  assert.match(text, /Calls run on the local engine/);
  assert.match(text, /tonight it is bed at 22:30, up at 07:00/);
  assert.match(text, /the weather off; quiet from 23:00 to 06:00/);
  assert.doesNotMatch(text, /hf\.co\/DavidAU/, 'the long id is not something she would say');
  assert.equal(shortModelName('hf.co/DavidAU/X:Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q4_K_M.gguf').length <= 48, true);
  const local = describeMyself(readSelfSnapshot(() => undefined));
  assert.match(local, /comes from the local model on the server — no hosted conversation model is set/);
});

test('every setting she may change has a path and a current value to show', () => {
  const listed = describeSettings(get);
  assert.equal(listed.length, SETTING_NAMES.length);
  assert.deepEqual(listed.find(item => item.name === 'conversation_model'), { name: 'conversation_model', what: 'the hosted model that answers as you', current: undefined });
  assert.ok(SETTING_NAMES.includes('quiet_from'));
});

test('a change is checked by shape: on/off words, HH:MM in its window, whole numbers in range, an engine from the list', () => {
  assert.deepEqual(planChange('random_pushes', 'off', true), { ok: true, unchanged: false, plan: { name: 'random_pushes', path: 'push.prefs.random', what: 'whether your own unprompted thoughts reach their phone', from: true, to: false } });
  assert.equal(planChange('random_pushes', 'sometimes', true).ok, false);
  assert.equal((planChange('quiet_from', '22:30', '23:00') as { ok: true; plan: { to: unknown } }).plan.to, '22:30');
  assert.equal((planChange('quiet_from', '7:05', '23:00') as { ok: true; plan: { to: unknown } }).plan.to, '07:05');
  assert.equal(planChange('quiet_from', 'ten', '23:00').ok, false);
  assert.equal(planChange('bedtime', '01:30', '23:30').ok, true, 'a bedtime past midnight is inside the window');
  assert.equal(planChange('bedtime', '03:00', '23:30').ok, false, 'three in the morning is not a bedtime');
  assert.equal(planChange('bedtime', '20:00', '23:30').ok, false);
  assert.equal(planChange('wake_time', '13:00', '08:00').ok, false);
  assert.equal(planChange('wake_time', '06:45', '08:00').ok, true);
  assert.equal((planChange('up_by', 'none', '09:00') as { ok: true; plan: { to: unknown } }).plan.to, '', 'up_by may be cleared');
  assert.equal(planChange('quiet_to', 'none', '06:00').ok, false, 'quiet_to may not');
  assert.equal(planChange('history_budget', '8000', 6000).ok, true);
  assert.equal(planChange('history_budget', '100', 6000).ok, false);
  assert.equal(planChange('history_budget', '8000.5', 6000).ok, false);
  assert.equal((planChange('voice_engine', 'Hume', 'breeze') as { ok: true; plan: { to: unknown } }).plan.to, 'hume');
  assert.equal(planChange('voice_engine', 'elevenlabs', 'breeze').ok, false);
  assert.equal(planChange('call_engine', 'local', 'local').ok && (planChange('call_engine', 'local', 'local') as { unchanged: boolean }).unchanged, true, 'the same value is a no-op, not an error');
  assert.match((planChange('api_key', 'x', '') as { error: string }).error, /not a setting you can change/);
});

test('a model must be one its endpoint lists, and a near miss is named', () => {
  const models = ['kimi-k2-5', 'kimi-k2-6', 'deepseek-v4-pro-0813', 'grok-4-20'];
  assert.equal(planChange('conversation_model', 'deepseek-v4-pro-0813', 'kimi-k2-5', { models }).ok, true);
  const miss = planChange('conversation_model', 'deepseek v4', 'kimi-k2-5', { models }) as { ok: false; error: string };
  assert.equal(miss.ok, false);
  assert.match(miss.error, /Close: deepseek-v4-pro-0813/);
  // With no list to check against (the endpoint could not be asked), the id is taken as given.
  assert.equal(planChange('nudge_model', 'anything-at-all', 'x', { models: null }).ok, true);
  assert.equal(planChange('nudge_model', '', 'x').ok, false);
});
