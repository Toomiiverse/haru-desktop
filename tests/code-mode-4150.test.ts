// 4150: coding mode. Real OpenCode frames and messages (recorded 10-16 on a throwaway repo) become the phone's
// cards; his session lives beside her jobs without becoming one; news of it reaches him only when he is not watching.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as policy from '../electron/core-policy-sync';
import { codeMode, gitDiff, phoneEvent, phoneItems, CODE_MODELS, type CodeEvent } from '../electron/codemode';
import { codeJobs, codeLink, errorText } from '../electron/codetask';

const DIR = '/home/toomii/haru-code-check';
const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, '../../tests/fixtures', name), 'utf8'));

/** What the phone does with events: upsert by kind+id, append said deltas. */
function apply(items: CodeEvent[], event: CodeEvent) {
  if (event.kind === 'run' || event.kind === 'usage') return items;
  const at = items.findIndex(i => i.kind === event.kind && i.id === event.id);
  if (at < 0) return [...items, { ...event, ...(event.delta !== undefined ? { text: event.delta } : {}) }];
  const merged = { ...items[at], ...Object.fromEntries(Object.entries(event).filter(([k, v]) => v !== '' && k !== 'delta')) };
  if (event.delta !== undefined) merged.text = String(items[at].text ?? '') + event.delta;
  return items.map((i, n) => n === at ? merged : i);
}

test('recorded frames become tool cards, an ask he answered, and her final text', () => {
  const names = new Map<string, string>();
  const events = fixture('opencode-events-4150.json').map((f: any) => phoneEvent(f, names, DIR)).filter(Boolean) as CodeEvent[];
  const items = events.reduce(apply, [] as CodeEvent[]);
  const tools = items.filter(i => i.kind === 'tool');
  assert.deepEqual(tools.map(t => [t.name, t.status, t.title]), [['glob', 'done', '**/calc.py'], ['read', 'done', 'calc.py'], ['edit', 'done', 'calc.py'],
    ['shell', 'done', 'python3 -c "from calc import add; print(add(2,3))"']]);
  assert.match(String(tools[2].patch), /\+    return a \+ b/);
  assert.deepEqual([tools[3].output, tools[3].exit], ['5\n', 0]);
  assert.deepEqual(items.find(i => i.kind === 'ask'), { kind: 'ask', id: 'per_144440a2d001dZ5JuwzBmoVZ9d', resources: ['python3 -c "from calc import add; print(add(2,3))"'], reply: 'once' });
  assert.match(String(items.find(i => i.kind === 'said')?.text), /^\*\*What changed:\*\*/);
  assert.deepEqual(events.filter(e => e.kind === 'run').map(e => e.running), [true, false]);
});

test('the recorded history draws the same session, oldest first', () => {
  const items = phoneItems(fixture('opencode-messages-4150.json'), DIR);
  assert.deepEqual(items.map(i => i.kind === 'tool' ? i.name : i.kind), ['you', 'glob', 'read', 'edit', 'shell', 'said']);
  assert.match(String(items[0].text), /^Fix the bug in calc.py/);
  assert.equal(items[4].output, '5\n');
});

test("OpenRouter's 402 reads as one line", () => {
  assert.equal(errorText({ message: 'litellm.APIError: APIError: OpenrouterException - {"error":{"message":"This request requires more credits, or fewer max_tokens.","code":402}}' }),
    'This request requires more credits, or fewer max_tokens.');
});

function rig() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'haru-codemode-'));
  mkdirSync(path.join(home, 'repo', '.git'), { recursive: true }); mkdirSync(path.join(home, 'plain'));
  (policy as any).corePolicySync = (op: string, args: any[]) => op === 'final-sessions.candidate' ? path.join(args[2], args[0])
    : op === 'final-sessions.resolved' ? (args[2].isDir ? { dir: args[2].real } : { error: 'no folder' }) : null;
  const calls: any[] = [], state: any = { permission: [], active: {}, message: [] }, heard = new Map<string, (f: any) => void>();
  const api = async (method: string, route: string, body?: any) => {
    calls.push([method, route, body]);
    if (route === '/api/session') return { id: 'ses_' + calls.length };
    if (route.endsWith('/permission')) return state.permission;
    if (route === '/api/session/active') return state.active;
    if (route.includes('/message')) return state.message;
    return { cost: 0.01 };
  };
  const hub = { listen: (id: string, fn: (f: any) => void) => { heard.set(id, fn); return () => heard.delete(id); }, listening: (id: string) => heard.has(id) };
  const jobs = codeJobs(path.join(home, 'jobs.json'));
  const mode = codeMode({ api, hub, jobs, home, file: path.join(home, 'mode.json'), diff: () => ({ files: [], untracked: [] }) });
  return { home, calls, state, heard, jobs, mode, link: codeLink({ api, jobs, home, listening: hub.listening }) };
}

test('a session starts only in a repo and on a listed model; leaving notes it once per stretch of work', async () => {
  const { mode, calls, jobs, home } = rig();
  await assert.rejects(mode.start('plain'), /not a git repository/);
  await assert.rejects(mode.start('repo', 'litellm/claude-opus-5'), /not on the list/);
  await assert.rejects(mode.prompt('hi'), /Pick a project folder first/);
  const s = await mode.start('repo');
  assert.deepEqual(calls[0][2], { location: { directory: path.join(home, 'repo') }, agent: 'haru-coder', model: { providerID: 'haru', id: 'mimo-v2.6-pro' }, title: 'Code · repo' });
  assert.deepEqual(s.projects, ['repo']);
  assert.equal(jobs.read()[0].direct, true);
  assert.equal(mode.leave(), null);   // nothing asked yet
  await mode.prompt('Fix add()'); await mode.prompt('and test it');
  assert.deepEqual(mode.leave(), { folder: 'repo', task: 'Fix add()' });
  assert.equal(mode.leave(), null);
  await mode.model(CODE_MODELS[1].id);
  assert.deepEqual(calls.at(-1), ['POST', `/api/session/${s.sessionId}/model`, { model: { providerID: 'haru', id: 'claude-opus-5-5' } }]);
});

test('an answer only goes to an ask the session is waiting on', async () => {
  const { mode, state, calls } = rig();
  const s = await mode.start('repo');
  await assert.rejects(mode.permission('per_x', 'once'), /not waiting on that/);
  state.permission = [{ id: 'per_x', resources: ['npm test'] }];
  await assert.rejects(mode.permission('per_x', 'sure'), /Unknown answer/);
  await mode.permission('per_x', 'always');
  assert.deepEqual(calls.at(-1), ['POST', `/api/session/${s.sessionId}/permission/per_x/reply`, { decision: 'always' }]);
});

test('a stream sends the whole state first, then only its own session, and a reconnect re-sends the state', async () => {
  const { mode, heard } = rig();
  const s = await mode.start('repo');
  const sent: CodeEvent[] = [];
  const stop = await mode.subscribe(e => sent.push(e));
  assert.equal(sent[0].kind, 'state');
  heard.get(s.sessionId!)!({ type: 'session.execution.started', data: { sessionID: s.sessionId } });
  assert.deepEqual(sent[1], { kind: 'run', running: true });
  heard.get(s.sessionId!)!({ type: 'haru.reload' });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(sent[2].kind, 'state');
  stop!(); assert.equal(heard.size, 0);
});

test("his session is not one of her jobs, and it pushes to him only while he is not watching", async () => {
  const { mode, link, state, heard } = rig();
  const s = await mode.start('repo');
  assert.equal((await link.run({ action: 'status' })).notDispatched, true);   // Haru's code_task cannot see it
  const told: [string, boolean][] = [];
  const notify = (line: string, _: string, direct: boolean) => told.push([line, direct]);
  state.permission = [{ id: 'per_1', resources: ['npm test'] }];
  heard.set(s.sessionId!, () => {}); await link.watch(notify); assert.equal(told.length, 0);   // watching: the screen shows it
  heard.clear(); await link.watch(notify); await link.watch(notify);
  assert.deepEqual(told, [['The coder wants to run `npm test` in repo. Open coding mode to allow it.', true]]);
  assert.equal(link.waiting(), false);   // her menu does not offer approval for his ask
  state.permission = []; state.active = { [s.sessionId!]: { type: 'running' } }; await link.watch(notify);
  state.active = {}; state.message = [{ type: 'assistant', time: { created: 1, completed: 2 }, content: [{ type: 'text', text: 'All green.' }] }];
  await link.watch(notify); await link.watch(notify);
  assert.deepEqual(told.at(-1), ['The coder finished in repo: All green.', true]);
  assert.equal(told.length, 2);
});

test('git diff splits per file and counts lines', () => {
  const out = gitDiff('/x', args => args[0] === 'diff'
    ? 'diff --git a/calc.py b/calc.py\nindex 1..2\n--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -0,0 +1 @@\n+hi\n'
    : 'new.txt\n');
  assert.deepEqual(out.files.map(f => [f.file, f.additions, f.deletions]), [['calc.py', 1, 1], ['b.txt', 1, 0]]);
  assert.deepEqual(out.untracked, ['new.txt']);
});
