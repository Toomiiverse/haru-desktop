// 4140: coding jobs go to OpenCode's haru-coder agent over its API; she relays each permission ask once,
// approves only the one she asked him about, and tells him when the job is done or stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as policy from '../electron/core-policy-sync';
import { codeJobs, codeLink, CODE_AGENT, CODE_MODEL } from '../electron/codetask';

function rig() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'haru-code-'));
  mkdirSync(path.join(home, 'repo', '.git'), { recursive: true }); mkdirSync(path.join(home, 'plain'));
  (policy as any).corePolicySync = (op: string, args: any[]) => op === 'final-sessions.candidate' ? path.join(args[2], args[0])
    : op === 'final-sessions.resolved' ? (args[2].isDir ? { dir: args[2].real } : { error: 'no folder' }) : null;
  const calls: any[] = [], state: any = { active: {}, permission: [], message: [] };
  const api = async (method: string, route: string, body?: any) => {
    calls.push([method, route, body]);
    if (route === '/api/session') return { id: 'ses_1' };
    if (route === '/api/session/active') return state.active;
    if (route.endsWith('/permission')) return state.permission;
    if (route.endsWith('/message')) return state.message;
    return {};
  };
  const jobs = codeJobs(path.join(home, 'jobs.json'));
  return { home, calls, state, jobs, link: codeLink({ api, jobs, home, changed: () => ['calc.py'] }) };
}

test('a job starts only in a git repository in his home, on the haru-coder agent and MiMo', async () => {
  const { link, calls, jobs } = rig();
  assert.equal((await link.run({ action: 'start', folder: 'plain', task: 'x' })).notDispatched, true);
  assert.equal((await link.run({ action: 'start', folder: '~', task: 'x' })).notDispatched, true);
  assert.equal(calls.length, 0);
  const out = await link.run({ action: 'start', folder: 'repo', task: 'Fix add() in calc.py' });
  assert.equal(out.started, true);
  assert.equal(calls[0][2].agent, CODE_AGENT); assert.deepEqual(calls[0][2].model, CODE_MODEL);
  assert.deepEqual(calls[1], ['POST', '/api/session/ses_1/prompt', { text: 'Fix add() in calc.py' }]);
  assert.equal(jobs.read()[0].done, undefined);
});

test('a permission ask is relayed once, and only the one he was asked about can be approved', async () => {
  const { link, calls, state, jobs } = rig(); const said: string[] = [];
  await link.run({ action: 'start', folder: 'repo', task: 'Fix it' });
  state.active = { ses_1: { type: 'running' } }; state.permission = [{ id: 'per_1', resources: ['python3 -m pytest -q'] }];
  assert.equal((await link.run({ action: 'approve' })).notDispatched, true);   // not asked yet
  await link.watch(line => said.push(line)); await link.watch(line => said.push(line));
  assert.equal(said.length, 1); assert.match(said[0], /wants to run `python3 -m pytest -q` in repo .*okay\?$/);
  assert.equal(link.waiting(), true);
  state.permission = [{ id: 'per_2', resources: ['rm -rf build'] }];   // a newer ask he has not heard
  assert.equal((await link.run({ action: 'approve' })).notDispatched, true);
  state.permission = [{ id: 'per_1', resources: ['python3 -m pytest -q'] }];
  assert.deepEqual(await link.run({ action: 'approve' }), { approved: ['python3 -m pytest -q'], folder: 'repo' });
  assert.deepEqual(calls.at(-1), ['POST', '/api/session/ses_1/permission/per_1/reply', { decision: 'once' }]);
  assert.equal(jobs.read()[0].told, undefined);
});

test('a finished job is reported with what changed; a failed one says why', async () => {
  const { link, state, jobs } = rig(); const said: string[] = [];
  await link.run({ action: 'start', folder: 'repo', task: 'Fix it' });
  const later = Date.now() + 60_000;
  state.message = [{ type: 'assistant', time: { created: 2, completed: 3 }, content: [{ type: 'text', text: 'Fixed add().' }] }, { type: 'user', time: { created: 1 } }];
  await link.watch(line => said.push(line), later); await link.watch(line => said.push(line), later);
  assert.deepEqual(said, ['The coding job in repo is done (changed calc.py). It says: Fixed add().']);
  assert.equal(jobs.read()[0].done, true);
  const other = rig(); const told: string[] = [];
  await other.link.run({ action: 'start', folder: 'repo', task: 'Fix it' });
  other.state.message = [{ type: 'assistant', time: { created: 2 }, error: { type: 'provider.quota', message: 'budget exceeded' }, content: [] }];
  await other.link.watch(line => told.push(line), later);
  assert.deepEqual(told, ['The coding job in repo stopped: budget exceeded']);
});
