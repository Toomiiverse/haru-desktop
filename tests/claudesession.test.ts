// Claude Code sessions she opens for his phone.
//
// The fixtures are what the CLI actually printed on this machine (2.1.273,
// 2026-09-16): the `--bg` banner, a stretch of the `claude logs` terminal
// recording with the link in it, and a row shape from `claude agents --json`.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  backgroundedId, launchCommand, listSessions, liveSessions, openSession, plainText, readClaudeCodeConfig,
  readOpenedSessions, resolveSessionDir, sessionName, sessionUrl, SESSIONS_KEPT, stopSession, type Run, type SessionHost,
} from '../electron/claudesession';

const BANNER = `Starting background service…
backgrounded · 2c4feebf (idle — send a prompt to start)
  claude agents             list sessions
  claude attach 2c4feebf    open in this terminal
`;

const LOG = '\x1b[2J\x1b[H\x1b[38;2;255;204;0m/rc connecting…\x1b[2B\x1b[39m\x1b[4B/remote-control\x1b[19Gis\x1b[22Gactive\x1b[38;2;153;153;153m · Continue here, on your phone, or at https://claude.ai/code/session_01H1usFw5c7MuHKkdSX6EHmK\x1b[2C\x1b[40B\x1b[39m\x1b[K';

const AGENTS = JSON.stringify([
  { pid: 24190, cwd: '/home/toomii', kind: 'interactive', sessionId: '678345d7', name: 'toomii-ec', status: 'busy' },
  { id: 'df484dec', cwd: '/home/toomii/haru-desktop', kind: 'background', name: 'Set up Haru', state: 'blocked' },
  { pid: 43257, id: '2c4feebf', cwd: '/home/toomii', kind: 'background', name: '2c4feebf', status: 'idle', state: 'blocked' },
]);

const HOME = '/home/toomii';

test('switched off unless it says otherwise, and never with his prompts skipped', () => {
  assert.deepEqual(readClaudeCodeConfig(undefined, HOME), { enabled: false, binary: '/home/toomii/.local/bin/claude', dir: HOME, permissionMode: null });
  const on = readClaudeCodeConfig({ enabled: true, dir: '/home/toomii/haru-desktop', permissionMode: 'acceptEdits' }, HOME);
  assert.equal(on.enabled, true);
  assert.equal(on.dir, '/home/toomii/haru-desktop');
  assert.equal(on.permissionMode, 'acceptEdits');
  assert.equal(readClaudeCodeConfig({ enabled: true, permissionMode: 'bypassPermissions' }, HOME).permissionMode, null);
  assert.equal(readClaudeCodeConfig({ enabled: 'yes' }, HOME).enabled, false);
});

test('the id comes from the banner and the link from the terminal recording', () => {
  assert.equal(backgroundedId(BANNER), '2c4feebf');
  assert.equal(backgroundedId('Starting background service…\n'), null);
  assert.equal(sessionUrl(LOG), 'https://claude.ai/code/session_01H1usFw5c7MuHKkdSX6EHmK');
  assert.equal(sessionUrl('\x1b[38;2;255;204;0m/rc connecting…'), null);
  // A reconnect prints a fresh link; the newest is the one that works.
  assert.equal(sessionUrl(`${LOG} https://claude.ai/code/session_02Newer`), 'https://claude.ai/code/session_02Newer');
  assert.ok(!plainText(LOG).includes('\x1b'));
});

test('only background sessions count as alive, whichever status field they carry', () => {
  const live = liveSessions(AGENTS);
  assert.deepEqual([...live.keys()], ['df484dec', '2c4feebf']);
  assert.equal(live.get('2c4feebf')!.status, 'idle');
  assert.equal(live.get('df484dec')!.status, 'blocked');
  assert.equal(liveSessions('not json').size, 0);
});

test('a folder is found inside his home and nowhere else', () => {
  const dirs = new Set([HOME, '/home/toomii/haru-desktop', '/home/toomii/escape', '/etc']);
  const fs = {
    isDir: (p: string) => dirs.has(path.normalize(p)),
    real: (p: string) => (path.normalize(p) === '/home/toomii/escape' ? '/etc' : path.normalize(p)),
  };
  const config = { dir: HOME };
  assert.deepEqual(resolveSessionDir('', config, HOME, fs), { dir: HOME });
  assert.deepEqual(resolveSessionDir('haru-desktop', config, HOME, fs), { dir: '/home/toomii/haru-desktop' });
  assert.deepEqual(resolveSessionDir('~/haru-desktop', config, HOME, fs), { dir: '/home/toomii/haru-desktop' });
  assert.deepEqual(resolveSessionDir('/home/toomii/haru-desktop', config, HOME, fs), { dir: '/home/toomii/haru-desktop' });
  assert.deepEqual(resolveSessionDir('~', config, HOME, fs), { dir: HOME });
  assert.match((resolveSessionDir('/etc', config, HOME, fs) as { error: string }).error, /outside their home/);
  assert.match((resolveSessionDir('../../etc', config, HOME, fs) as { error: string }).error, /outside their home/);
  // A symlink that points out is out.
  assert.match((resolveSessionDir('escape', config, HOME, fs) as { error: string }).error, /outside their home/);
  assert.match((resolveSessionDir('nope', config, HOME, fs) as { error: string }).error, /no folder "nope"/);
  // A sibling whose name merely starts with home's is not inside it.
  const sibling = { isDir: () => true, real: (p: string) => path.normalize(p) };
  assert.match((resolveSessionDir('/home/toomiiX', config, HOME, sibling) as { error: string }).error, /outside their home/);
});

test('a session is named in one short line, or after its folder', () => {
  assert.equal(sessionName('', '/home/toomii/haru-desktop'), 'Haru · haru-desktop');
  assert.equal(sessionName('Fix the\nlogin', HOME), 'Fix the login');
  assert.equal(sessionName('x'.repeat(100), HOME).length, 60);
});

test('the launch runs in a scope of its own, so restarting Haru does not end it', () => {
  const config = readClaudeCodeConfig({ enabled: true }, HOME);
  const scoped = launchCommand(config, 'Haru · home', '/usr/bin/systemd-run');
  assert.equal(scoped.file, '/usr/bin/systemd-run');
  assert.deepEqual(scoped.args, ['--user', '--scope', '--collect', '--quiet', '--', '/home/toomii/.local/bin/claude', '--bg', '--remote-control', 'Haru · home', '--name', 'Haru · home']);
  const bare = launchCommand({ ...config, permissionMode: 'plan' }, 'x', null);
  assert.equal(bare.file, '/home/toomii/.local/bin/claude');
  assert.deepEqual(bare.args, ['--bg', '--remote-control', 'x', '--name', 'x', '--permission-mode', 'plan']);
  // Never a prompt: nothing after the flags for the session to start working on.
  assert.ok(!scoped.args.includes('-p') && !scoped.args.includes('--print'));
});

function host(answers: (file: string, args: string[]) => { ok: boolean; stdout: string; stderr?: string }, calls: { file: string; args: string[]; cwd?: string }[]): SessionHost {
  const run: Run = async (file, args, options) => {
    calls.push({ file, args, cwd: options.cwd });
    const answer = answers(file, args);
    return { ok: answer.ok, stdout: answer.stdout, stderr: answer.stderr ?? '' };
  };
  return { config: readClaudeCodeConfig({ enabled: true }, HOME), run, systemdRun: '/usr/bin/systemd-run', sleep: async () => {}, linkWaitMs: 60_000 };
}

test('opening waits for the link, in the folder it was asked for', async () => {
  const calls: { file: string; args: string[]; cwd?: string }[] = [];
  let looks = 0;
  const opened = await openSession(host((file, args) => {
    if (file === '/usr/bin/systemd-run') return { ok: true, stdout: BANNER };
    if (args[0] === 'logs') return { ok: true, stdout: ++looks < 3 ? '/rc connecting…' : LOG };
    return { ok: false, stdout: '' };
  }, calls), '/home/toomii/haru-desktop', 'Haru · haru-desktop', '2026-09-16T10:00:00.000Z');
  assert.deepEqual(opened, { session: { id: '2c4feebf', name: 'Haru · haru-desktop', dir: '/home/toomii/haru-desktop', url: 'https://claude.ai/code/session_01H1usFw5c7MuHKkdSX6EHmK', at: '2026-09-16T10:00:00.000Z' } });
  assert.equal(calls[0].cwd, '/home/toomii/haru-desktop');
  assert.equal(looks, 3);
});

test('a launch that prints no id is an error with its reason, not a session', async () => {
  const opened = await openSession(host(() => ({ ok: false, stdout: '', stderr: '\x1b[31mNot logged in\x1b[0m' }), []), HOME, 'x', '2026-09-16T10:00:00.000Z');
  assert.deepEqual(opened, { error: 'Claude did not start: Not logged in' });
});

test('the link is given up on in time rather than holding the reply forever', async () => {
  const quick = { ...host((file) => (file === '/usr/bin/systemd-run' ? { ok: true, stdout: BANNER } : { ok: true, stdout: '' }), []), linkWaitMs: 0 };
  const opened = await openSession(quick, HOME, 'x', '2026-09-16T10:00:00.000Z');
  assert.equal((opened as { session: { url: string | null } }).session.url, null);
});

test('listing shows only hers that are still running, and stop reports what Claude said', async () => {
  const mine = readOpenedSessions([
    { id: '2c4feebf', name: 'Haru · home', dir: HOME, url: null, at: '2026-09-16T10:00:00.000Z' },
    { id: 'deadbeef', name: 'gone', dir: HOME, url: 'https://claude.ai/code/session_old', at: '2026-09-15T10:00:00.000Z' },
    { id: 'not-an-id', dir: HOME, at: 'x' },
  ]);
  assert.equal(mine.length, 2);
  const listed = await listSessions(host((_file, args) => (args[0] === 'agents' ? { ok: true, stdout: AGENTS } : { ok: true, stdout: LOG }), []), mine);
  assert.deepEqual(listed, { sessions: [{ id: '2c4feebf', name: 'Haru · home', dir: HOME, url: 'https://claude.ai/code/session_01H1usFw5c7MuHKkdSX6EHmK', at: '2026-09-16T10:00:00.000Z', status: 'idle' }] });
  assert.deepEqual(await stopSession(host(() => ({ ok: true, stdout: 'stopped 2c4feebf' }), []), '2c4feebf'), { stopped: true });
  assert.deepEqual(await stopSession(host(() => ({ ok: false, stdout: '', stderr: 'no session 2c4feebf' }), []), '2c4feebf'), { stopped: false, error: 'no session 2c4feebf' });
  assert.equal(readOpenedSessions(Array.from({ length: 30 }, (_, i) => ({ id: `0000000${i % 10}`, dir: HOME, at: 'x' }))).length, SESSIONS_KEPT);
});
