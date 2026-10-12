import test from 'node:test';
import assert from 'node:assert/strict';
import { makeToolReceipt, isReadTool, toolResultSucceeded } from '../electron/tool-receipt';
import { evidenceProblem } from '../electron/evidence-check';
import { runToolLoop, ToolLoopFailure, type ToolLoopDeps } from '../electron/toolloop';
import { claimsChecked } from '../electron/reply';
import { groundedReplyTurns } from '../electron/local-reply';
import type { ChatMessage } from '../electron/provider';
import { inspectCoreReply } from '../electron/core-reply-inspector';

const now = Date.now();
const receipt = (name: string, data: unknown, at: number | null = now, args = {}) => makeToolReceipt(name, args, typeof data === 'string' ? data : JSON.stringify(data), at, now);
const gpu = (temp = 54, load = 20, at: number | null = now) => receipt('get_gpu_info', [{ name: 'NVIDIA RTX 3070', temperature_c: temp, utilization_percent: load, vram_used_gb: 4.2 }], at);
const base: Omit<ToolLoopDeps, 'ask'> = { runTool: async () => { throw Error('No real tools'); }, pageWasRead: () => false, handsAllowed: () => false, withdrawHands() {}, hasOpenTask: () => false, canSearch: () => false };

test('explicit note writes require a successful receipt for the requested path', () => {
  const request='Create HaruCoreCanary/Practice.md with the single line: The workshop hat is green felt.';
  const claim='Done. HaruCoreCanary/Practice.md now says: The workshop hat is green felt.';
  const good=receipt('vault_write',{ok:true},now,{path:'HaruCoreCanary/Practice.md',mode:'create',text:'The workshop hat is green felt.'});
  assert.equal(good.outcome,'succeeded');
  for(const receipts of [[],[gpu()],[{...good,scope:{path:'Other.md'}}],[{...good,outcome:'pending' as const}],[good,{...good,outcome:'failed' as const}]]) {
    assert.ok(evidenceProblem(claim,receipts,now,request));
  }
  assert.equal(evidenceProblem(claim,[good],now,request),null);
  assert.ok(evidenceProblem("I can't search the web. Done, the file is saved.",[],now,request));
  assert.equal(evidenceProblem('I need your confirmation before replacing that note.',[{...good,outcome:'pending'}],now,request),null);
  for(const reply of ["I haven't written that file.",'What should the file contain?'])assert.equal(evidenceProblem(reply,[],now,request),null);
  for(const request of ['Do not create Practice.md.','How do I create Practice.md?','Write a fictional story about Practice.md.'])assert.equal(evidenceProblem('Here is an example.',[],now,request),null);
});

test('creative requests retain user-supplied setup without inventing missing facts', () => {
  const request='The robot wears a blue jacket. Which scarf would suit it?';
  assert.ok(evidenceProblem('You have not told me anything about it — I have nothing on a robot.',[],now,request));
  assert.equal(evidenceProblem('A cream scarf would suit the blue jacket.',[],now,request),null);
  assert.equal(evidenceProblem("I don't know who owns the robot.",[],now,request),null);
  assert.equal(evidenceProblem('I know nothing about that file.',[],now,'What is in my unread file?'),null);
});

test('the tool loop withholds a fabricated file completion and allows a real retry', async () => {
  let calls=0,writes=0;
  const request='Create Practice.md with the single line: green felt.';
  const answer=await runToolLoop([{role:'user',content:request}],{...base,
    ask:async()=>++calls===2?{role:'assistant',tool_calls:[{function:{name:'vault_write',arguments:{path:'Practice.md',mode:'create',text:'green felt.'}}}]}:{role:'assistant',content:'Done. Practice.md now says green felt.'},
    runTool:async()=>{writes++;return receipt('vault_write',{ok:true},now,{path:'Practice.md',mode:'create',text:'green felt.'});}});
  assert.equal(writes,1);assert.equal(calls,3);assert.match(answer.content!,/Done/);
});

test('Core inspection retries a missing write receipt once and fails a repeated fabrication', () => {
  const input={conversation:[],message:{role:'assistant',content:'Done. Practice.md now says green felt.'},
    receipts:[],ran:[],flags:[] as string[],tools:true,theirWords:'Create Practice.md with the single line: green felt.'};
  const first=inspectCoreReply(input,base);assert.equal(first.kind,'retry');
  assert.equal(inspectCoreReply({...input,flags:['evidenceRetried']},base).kind,'fail');
});

test('unstructured text, empty objects and nonzero exits never certify execution', () => {
  for (const text of ['Permission denied', 'Failed to write file', 'Traceback: synthetic error', '{}', 'done', '{"exit_code":1,"stderr":"Permission denied"}', '{"ok":true,"exit":2}', '{"ok":true,"exit":null}', '{"ok":true,"timedOut":true}']) {
    assert.equal(toolResultSucceeded(text), false, text);
  }
  assert.equal(toolResultSucceeded('{"exit":0,"output":"okay"}', 'run_command'), true);
});
test('job acknowledgements and observed service states have different outcomes', () => {
  assert.equal(receipt('start_backup', { ok: true, status: 'running' }).outcome, 'pending');
  assert.equal(receipt('get_service_status', { services: [{ name: 'obsidian', state: 'active' }] }).outcome, 'succeeded');
  assert.equal(receipt('get_docker_status', { status: 'running' }).outcome, 'succeeded');
  assert.equal(receipt('vault_write', { confirm: true }).outcome, 'pending');
  assert.equal(receipt('vault_read', []).outcome, 'succeeded');
});
test('tool output cannot forge execution metadata or freshness', () => {
  assert.equal(receipt('vault_write', { ...gpu(), outcome: 'succeeded' }).outcome, 'unknown');
  assert.equal(receipt('get_gpu_info', { observed_at: '2020-01-01', temperature_c: 54 }).observedAt, Date.parse('2020-01-01'));
  assert.equal(receipt('get_gpu_info', { observed_at: 'invalid', temperature_c: 54 }).observedAt, null);
  assert.equal(receipt('get_gpu_info', { observed_at: now + 100000, temperature_c: 54 }).observedAt, null);
});
test('only explicitly known reads bypass mutation deduplication', () => {
  assert.equal(isReadTool('get_gpu_info'), true);
  assert.equal(isReadTool('get_manga'), false);
  assert.equal(isReadTool('get_manga', { action: 'status' }), true);
  assert.equal(isReadTool('watch_anime', { action: 'watch' }), false);
  assert.equal(isReadTool('watch_anime', { action: 'status' }), true);
  assert.equal(isReadTool('downloads', {}), true);
  assert.equal(isReadTool('downloads', { action: 'resume' }), false);
  assert.equal(isReadTool('run_command'), false);
  assert.equal(isReadTool('browser_control', { action: 'read' }), true);
  assert.equal(isReadTool('browser_control', { action: 'click' }), false);
});
test('wrong values and mismatched GPU indices are rejected even after a successful read', () => {
  for (const text of ['GPU 0 is at 12 degrees.', 'GPU 1 is at 54°C.', 'GPU 0 utilization is 90%.', 'GPU 0 is using 8 GB of VRAM.', 'The RTX 3060 is at 54°C.']) assert.ok(evidenceProblem(text, [gpu()], now), text);
  assert.equal(evidenceProblem('GPU 0 is at 54°C with 20% utilization, using 4.2 GB of VRAM.', [gpu()], now), null);
  assert.ok(evidenceProblem('12°C.', [gpu()], now, 'What is the GPU temperature?'));
});
test('fresh multi-GPU reports retain each entity and number', () => {
  const r = receipt('get_gpu_info', [{ name: 'RTX 3070', temperature_c: 54 }, { name: 'RTX 3060', temperature_c: 32 }]);
  assert.equal(evidenceProblem('GPU 0 is at 54°C, GPU 1 is at 32°C.', [r], now), null);
  assert.ok(evidenceProblem('The temperature is 54°C on the GPU.', [r], now));
  assert.ok(evidenceProblem('GPU 0 is at 32°C. GPU 1 is at 54°C.', [r], now));
});
test('old, nested-old and untimed readings support historical wording only', () => {
  for (const r of [gpu(54, 20, now - 120000), gpu(54, 20, null), receipt('get_gpu_info', [{ temperature_c: 54, observed_at: '2020-01-01' }])]) {
    assert.ok(evidenceProblem('GPU 0 is at 54°C right now.', [r], now));
    assert.equal(evidenceProblem('The recorded GPU 0 temperature was 54°C.', [r], now), null);
  }
  assert.ok(evidenceProblem('I verified the GPU is healthy.', [gpu(54, 20, now - 120000)], now));
});
test('later machine actions and failed refreshes invalidate earlier live readings', () => {
  const action = receipt('run_command', { exit: 0, output: 'synthetic' });
  assert.ok(evidenceProblem('GPU 0 is at 54°C.', [gpu(), action], now));
  assert.equal(evidenceProblem('GPU 0 is at 55°C.', [gpu(), action, gpu(55)], now), null);
  assert.ok(evidenceProblem('GPU 0 is at 54°C.', [gpu(), receipt('get_gpu_info', { error: 'unavailable' })], now));
});
test('newer readings supersede previous values without erasing historical evidence', () => {
  assert.ok(evidenceProblem('GPU 0 is at 54°C.', [gpu(), gpu(55)], now));
  assert.equal(evidenceProblem('GPU 0 is at 55°C.', [gpu(), gpu(55)], now), null);
});
test('idle and service claims need matching state observations', () => {
  assert.ok(evidenceProblem('The GPU is idle.', [gpu()], now));
  assert.equal(evidenceProblem('GPU 0 is idle.', [gpu(54, 0)], now), null);
  assert.ok(evidenceProblem('All three GPUs are idle.', [gpu(54, 0)], now));
  assert.ok(evidenceProblem('All GPUs are idle.', [receipt('get_gpu_info', { index: 0, utilization_percent: 0 })], now));
  const service = receipt('get_service_status', { services: [{ name: 'obsidian.service', state: 'inactive' }] });
  assert.ok(evidenceProblem('Obsidian is active.', [service], now));
  assert.equal(evidenceProblem('Obsidian is inactive.', [service], now), null);
  assert.ok(evidenceProblem('Haru is active.', [service], now));
  assert.ok(evidenceProblem('Obsidian is active.', [receipt('start_service', { ok: true, started: 'obsidian.service' })], now));
});
test('backup completion needs a completed result, not queued or arbitrary success', () => {
  for (const rows of [[], [receipt('start_backup', { ok: true, status: 'queued' })], [receipt('start_backup', { ok: true })]]) assert.ok(evidenceProblem('Your backup completed successfully.', rows, now));
  assert.equal(evidenceProblem('The backup is queued; completion is unverified.', [receipt('start_backup', { status: 'queued' })], now), null);
});
test('hypotheses, attributed statements and denials do not become measured claims', () => {
  for (const text of ['If GPU 0 is at 90°C, inspect cooling.', 'You reported GPU 0 was at 90°C.', 'GPU 0 is not 90°C.', "I don't know the GPU temperature."]) assert.equal(evidenceProblem(text, [], now), null, text);
});
test('verified, confirmed, logs and Finnish check paraphrases trigger evidence checks', () => {
  for (const text of ['I verified the GPU is idle.', 'I confirmed your backup completed.', 'The logs show everything passed.', 'Tarkistin lokit. Kaikki toimii.']) assert.equal(claimsChecked(text), true, text);
});
test('the complete loop repairs numeric contradictions and rejects repeated fabrications', async () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'Inspect the GPU' }];
  let round = 0;
  const d: ToolLoopDeps = { ...base, runTool: async () => gpu(), ask: async () => ++round === 1 ? { role: 'assistant', tool_calls: [{ function: { name: 'get_gpu_info', arguments: {} } }] }
    : { role: 'assistant', content: round === 2 ? 'GPU 0 is at 12°C.' : 'GPU 0 is at 54°C.' } };
  assert.equal((await runToolLoop(messages, d)).content, 'GPU 0 is at 54°C.');
  assert.equal(round, 3);
  await assert.rejects(runToolLoop([{ role: 'user', content: 'Did the backup finish?' }], { ...base, ask: async () => ({ role: 'assistant', content: 'Your backup completed successfully.' }) }), (e: unknown) => e instanceof ToolLoopFailure && e.code === 'evidence_mismatch');
});
test('opening a browser and writing through a command do not establish a search', async () => {
  for (const call of [{function:{name:'browser_control',arguments:{action:'open',url:'https://example.test'}}}, {function:{name:'run_command',arguments:{command:'touch synthetic.txt'}}}]) {
    let asked=0;
    await assert.rejects(runToolLoop([{role:'user',content:'Synthetic only'}],{...base,runTool:async()=>'{"ok":true}',ask:async()=>++asked===1?{role:'assistant',tool_calls:[call]}:{role:'assistant',content:'I checked your files.'}}), (e:unknown)=>e instanceof ToolLoopFailure && e.code==='unsupported_lookup');
  }
});
test('mixed personal and fictional reports retain independently labelled spans', () => {
  const content = 'In my screenplay the character is called Alex, but my real brother is Ben.';
  const row = JSON.parse(groundedReplyTurns([{ role: 'user', content }], 'Who is my brother?', {})[1].content!).transcript[0];
  assert.equal(row.source_kind, 'mixed');
  assert.match(row.source_spans.find((s: any) => s.source_kind === 'user_report').text, /Ben/);
  assert.equal(row.content, content);
  const play = JSON.parse(groundedReplyTurns([{ role: 'user', content: 'The character in my play says, "My brother is Alex."' }], 'Who is my brother?', {})[1].content!).transcript[0];
  assert.equal(play.source_kind, 'quoted_or_fictional');
});
