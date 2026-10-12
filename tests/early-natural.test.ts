import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import * as natural from '../electron/natural-conversation';
import { ConversationPreferenceCache } from '../electron/conversation-continuity';
import { finishLocalReply, GROUNDED_REPLY_SCHEMA } from '../electron/local-reply';
import { InferencePriority } from '../electron/inference-priority';

const build = mkdtempSync(path.join(tmpdir(), 'haru-early-route-'));
execFileSync(path.resolve('node_modules/.bin/tsc'), ['-p', 'electron/tsconfig.json', '--outDir', build]);
const source = readFileSync(path.join(build, 'main.js'), 'utf8').replace(/\b[a-z_]+_\d+\.default\./g, 'unusedDefault.').replace(/\b[a-z_]+_\d+\./g, '');
rmSync(build, { recursive: true, force: true });
const early = source.slice(source.indexOf('let compactConversation = null;'), source.indexOf("  prepMark('directions');", source.indexOf('let compactConversation = null;')));
const lazy = source.slice(source.indexOf('  const { conversation, evidence: replyEvidence } = naturalKind'), source.indexOf('  // This turn owns its tool state from entry', source.indexOf('  const { conversation, evidence: replyEvidence } = naturalKind')));
const route = { provider: 'openai', endpoint: 'https://api.abliteration.ai/v1', model: 'abliterated-model-large-v2' };
async function prepare(text: string, overrides: Record<string, unknown> = {}) {
  const history = [{ role: 'user', content: text, at: '2026-09-30T09:00:00Z' }];
  let inspected = 0;
  const context = {
    ...natural, Date, JSON, Error, console: { log() {} }, traceId: 'test', enteredAt: Date.now(),
    latest: text, messages: history, nudgeResponseMessages: history, voiceEvidence: { userAudio: null },
    fresh: null, irritation: 0, ego: 0, mood: { goodnight: 'none', shout: 'none' },
    brief: false, choices: false, answering: '', turnedUp: '', quiet: '', rantRoomNow: '', aside: '', call: false,
    directReplyAsideAllowed: () => true, conversationRoute: () => route, naturalPreferences: new ConversationPreferenceCache(),
    store: { get: (key: string) => key === 'ai.fastConversation' ? { ...route, enabled: true, calls: true } : route },
    conversationMayLeave: () => ({ safe: true }), getSlate: () => null, knownSinceSlate: () => 0,
    blankSlateInstruction: () => '', memoryStore: { getDeletions: () => [] }, getMemories: () => [],
    getActiveCharacter: () => ({ identity: 'Haru', style: 'Dry' }), learningNote: () => '',
    app: { getPath: () => '/tmp' }, CHAT_TIMEZONE: 'UTC', zonedNow: () => new Date('2026-09-30T09:00:00Z'),
    prepMark() {}, systemContextFor: async () => { inspected++; return ''; }, directionsFor: async () => { inspected++; return null; },
    ...overrides,
  };
  const code = `(async () => { ${early}; return { compactConversation, compactSources, compactReason }; })()`;
  const result = await vm.runInNewContext(code, context);
  return { ...result, inspected };
}

test('actual early preparation skips system inspection and directions for casual turns', async () => {
  const result = await prepare('This coffee tastes good.');
  assert.equal(result.inspected, 0);
  assert.match(result.compactReason, /standalone_social/);
  assert.ok(result.compactConversation.length);
});

test('private, attached, dependent and oversized turns enter full preparation', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['Check GPU utilization now.', {}], ['What did I tell you yesterday?', {}], ['Thanks, remind me tomorrow.', {}],
    ['Hello', { conversationMayLeave: () => ({ safe: false }) }],
    ['Hello', { messages: [{ role: 'user', content: 'Hello', attachments: [{}] }] }],
    ['Hello', { getActiveCharacter: () => ({ identity: 'x'.repeat(8000), style: '' }) }],
  ];
  for (const [text, options] of cases) {
    const result = await prepare(text, options);
    assert.equal(result.compactConversation, null, text);
    assert.equal(result.inspected, 2, text);
  }
});

test('deleted preferences cannot reappear through the compact recent transcript', async () => {
  const messages = [{ role: 'user', content: 'I prefer quiet conversation.', at: '2026-09-01' },
    { role: 'user', content: 'Hello', at: '2026-09-30T09:00:00Z' }];
  const result = await prepare('Hello', { messages, nudgeResponseMessages: messages,
    memoryStore: { getDeletions: () => [{ id: 'old', at: '2026-09-29' }] } });
  assert.doesNotMatch(JSON.stringify([result.compactConversation, result.compactSources]), /I prefer quiet conversation/);
});

test('actual lazy branch bypasses embeddings, archive, full prompt state and prompt dump', async () => {
  // Any access to a full-preparation dependency would throw ReferenceError.
  const code = `(async () => { const naturalKind = 'social', compactConversation = [{role:'user',content:'Hello'}], compactEvidence = {voice:{userAudio:null}}; ${lazy}; return conversation; })()`;
  const result = await vm.runInNewContext(code, {});
  assert.equal(result[0].content, 'Hello');
});


test('actual mood update clears legacy refusal flags at every irritation level', () => {
  const begin = source.indexOf('function advanceMood(');
  const code = source.slice(begin, source.indexOf('const ANILIST_TTL_MS', begin));
  for (const irritation of [0, 55, 78, 100]) {
    let saved: any;
    const none = () => {};
    const ctx = { Date, Math, console: { log: none },
      getMood: () => ({ irritation, ego: 30, awaitingApology: true, apologyRefused: true, grudge: 20 }),
      getTraits: () => ({}), fuseOf: () => 1, afterCooldown: (v: number) => v, afterEgoCooldown: (v: number) => v,
      currentChatDayKey: () => '2026-09-30', isGoodnight: () => false, shoutState: () => 'none',
      isRedo: () => false, isLowEffort: () => false, nextIrritation: (v: number) => v,
      feelNow: none, nudgeVitals: none, tallyMonth: none, setMood: (v: any) => { saved = v; },
      jealousOfScreenAt: Date.now(), reportsAttentionElsewhere: () => false,
      readsAsRough: () => ({ rough: false }), readsAsEnding: () => false, readsAsScare: () => false,
      readsAsBanter: () => false, IRRITATION: { voiced: 33 },
    };
    const answer = vm.runInNewContext(`${code}; advanceMood('What conversation do I prefer?', []);`, ctx);
    assert.equal(answer.irritation, irritation);
    assert.equal(saved.awaitingApology, false);
    assert.equal(saved.apologyRefused, false);
    assert.equal(saved.grudge, undefined, 'grudge is not erased by the partial update');
  }
});


test('actual local fallback uses one compact generation, or one private repair', async () => {
 const begin=source.indexOf('const answerLocally = (sending');
 const code=source.slice(begin,source.indexOf("prepMark('modelRegistry')",begin));
 for(const badFirst of [false,true]) {
  let calls=0;const latest='This coffee tastes good.';
  const prepared=natural.prepareNaturalConversation([{role:'user',content:latest}],latest,{identity:'Haru',style:'Dry'},{voice:{}});const turns=prepared.messages;
  const result=await vm.runInNewContext(`(async()=>{${code};return answerLocally(compactConversation,{},false);})()`,{
   ...natural,Date,console:{log(){}},inferencePriority:new InferencePriority(),replyEvidence:{},voiceEvidence:{},naturalKind:'social',compactConversation:turns,compactSources:prepared.sources,
   store:{get:()=>true},
   latest,herRecentReplies:[],NATURAL_GROUNDED_REPLY_SCHEMA:{required:['basis','reply']},chatNumCtx:()=>4096,
   sendToProvider:async (_turns:any, _config:any, options:any)=>{
    calls++;assert.equal(options.tools,false);assert.deepEqual(Array.from(options.table),[]);assert.equal(options.maxTokens,128);
    return {role:'assistant',content:JSON.stringify({basis:'The user likes the coffee.',reply:badFirst&&calls===1?"[annoyed] I'm still waiting for an apology.":'[happy] Glad you like it.'})};
   },
  });
  assert.equal(calls,badFirst?2:1);assert.equal(result.content,'[happy] Glad you like it.');
 }
});

test('single-pass stays off by default and the established fallback receives the actual evidence', async () => {
  const begin=source.indexOf('const answerLocally = (sending');
  const code=source.slice(begin,source.indexOf("prepMark('modelRegistry')",begin));
  const latest='This coffee tastes good.';
  const history=[{role:'user',content:'I prefer quiet conversation without unasked advice.'},{role:'user',content:latest}];
  const prepared=natural.prepareNaturalConversation(history,latest,{identity:'Haru',style:'Dry'},{voice:{}});
  let drafts=0,compositions=0;
  const result=await vm.runInNewContext(`(async()=>{${code};return answerLocally(compactConversation,{},false);})()`,{
    ...natural,Date,console:{log(){}},inferencePriority:new InferencePriority(),replyEvidence:{},voiceEvidence:{},naturalKind:'social',compactConversation:prepared.messages,compactSources:prepared.sources,
    store:{get:()=>undefined},latest,directKind:null,roundOptions:{},finishLocalReply,GROUNDED_REPLY_SCHEMA,chatNumCtx:()=>20480,
    ollamaPost:async()=>{drafts++;return {role:'assistant',content:'[neutral] A private draft.'};},
    sendToProvider:async(turns:any)=>{
      compositions++;const data=JSON.parse(turns[1].content);
      assert.match(JSON.stringify(data.transcript),/quiet conversation/);
      assert.match(JSON.stringify(data.context.continuity),/quiet/);
      return {role:'assistant',content:JSON.stringify({kind:'ordinary',basis:'The user likes the coffee.',previous_claim:'',correction:'',reply:'[neutral] Glad you like it.'})};
    },
  });
  assert.equal(drafts,1);assert.equal(compositions,1);assert.equal(result.content,'[neutral] Glad you like it.');
});
