// The terminal on the server: the config, the refuse list, his word checked in code, and a real command under bash.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DENY, DIAGNOSTIC_COMMANDS, ShellGate, affirmative, denied, ledgerEntry, normalise, readShellConfig, runCommand } from '../electron/shell';

test('the shell block reads forward', () => {
  const plain = readShellConfig(undefined);
  assert.equal(plain.enabled, true);
  assert.equal(plain.timeoutSeconds, 60);
  assert.equal(plain.maxOutputChars, 8000);
  assert.deepEqual(plain.deny, DEFAULT_DENY);
  const set = readShellConfig({ level: 3, shell: { enabled: false, timeoutSeconds: 5, maxOutputChars: 100, cwd: '/tmp', deny: ['x'] } });
  assert.deepEqual(set, { enabled: false, timeoutSeconds: 5, maxOutputChars: 200, cwd: '/tmp', deny: ['x'] });
});

test('the refuse list stops the foot-guns and nothing else', () => {
  for (const bad of ['rm -rf /', 'rm -rf ~', 'rm -rf /home/', 'sudo rm -rf / --no-preserve-root', 'rm -rf --no-preserve-root /', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'echo x > /dev/sda', ':(){ :|:& };:', 'sudo shutdown now', 'poweroff', 'cat ~/.config/haru-desktop/config.json', 'cat ~/.config/haru/qbittorrent-password']) {
    assert.ok(denied(bad), `should refuse: ${bad}`);
  }
  for (const fine of ['df -h', 'rm -rf ~/tmp/build', 'rm -r node_modules', 'systemctl reboot', 'sudo -n reboot', 'docker ps', 'du -sh ~/anime-server/data', 'ls /dev/sda', 'grep -r shutdown ~/notes']) {
    assert.equal(denied(fine), null, `should allow: ${fine}`);
  }
  assert.equal(denied('rm -rf /', ['[']), null, 'a bad pattern refuses nothing');
});

test('a yes is short and starts with one', () => {
  for (const yes of ['yes', 'Yes please', 'go ahead', 'do it', 'run it', 'ok', 'sure, go', 'yeah go for it']) assert.ok(affirmative(yes), yes);
  for (const no of ['no', 'not yet', 'what does that do?', 'yes but change the path to /data first because that is where it lives', '']) assert.ok(!affirmative(no), no);
});

test('a command runs when he wrote it, or on his yes to the one she proposed', () => {
  const gate = new ShellGate();
  const t = 1_000_000;
  assert.deepEqual(gate.consider({ command: 'df -h', said: 'run `df -h` for me', door: 'phone', now: t }), { run: true, because: 'they wrote it' });
  // Proposed: not yet, and it is parked.
  const parked = gate.consider({ command: 'systemctl reboot', said: 'reboot the system', door: 'phone', now: t });
  assert.equal(parked.run, false);
  assert.match((parked as { note: string }).note, /Do not run it yet/);
  assert.equal(gate.proposed('phone', t + 1000), 'systemctl reboot');
  // A yes at another door is not his word for this one.
  assert.equal(gate.consider({ command: 'systemctl reboot', said: 'yes', door: 'desk', now: t + 2000 }).run, false);
  // A different command on the yes is not what he agreed to.
  assert.equal(gate.consider({ command: 'rm -r build', said: 'yes', door: 'phone', now: t + 3000 }).run, false);
  // The one he agreed to, in time: runs, and is spent.
  const fresh = new ShellGate();
  fresh.consider({ command: 'systemctl reboot', said: 'reboot the system', door: 'phone', now: t });
  assert.deepEqual(fresh.consider({ command: 'systemctl  reboot', said: 'yes, go ahead', door: 'phone', now: t + 30_000 }), { run: true, because: 'their word' });
  assert.equal(fresh.consider({ command: 'systemctl reboot', said: 'yes', door: 'phone', now: t + 31_000 }).run, false, 'a yes is spent once');
  // Too late.
  const late = new ShellGate();
  late.consider({ command: 'df -h', said: 'check the disk', door: 'desk', now: t });
  assert.equal(late.consider({ command: 'df -h', said: 'yes', door: 'desk', now: t + ShellGate.WORD_MS + 1 }).run, false);
  assert.equal(normalise('`Df   -h`'), 'df -h');
});

test('a command runs under bash with its output, and a runaway one is killed at the timeout', async () => {
  const config = { ...readShellConfig(undefined), timeoutSeconds: 1, maxOutputChars: 200, cwd: '/tmp' };
  const ran = await runCommand('echo hello; echo oops >&2; pwd; exit 3', config);
  assert.equal(ran.exit, 3);
  assert.match(ran.output, /hello/);
  assert.match(ran.output, /oops/);
  assert.match(ran.output, /\/tmp/);
  assert.equal(ran.timedOut, false);
  const long = await runCommand('seq 1 500', config);
  assert.equal(long.truncated, true);
  assert.match(long.output, /characters left out/);
  assert.match(long.output, /500$/);
  const slow = await runCommand('sleep 5; echo late', config);
  assert.equal(slow.timedOut, true);
  assert.ok(slow.ms < 3000);
  assert.doesNotMatch(slow.output, /late/);
  const entry = ledgerEntry({ at: '2026-09-18T10:00:00Z', door: 'phone', command: 'df -h', ran });
  assert.match(entry, /^2026-09-18T10:00:00Z \[phone\] \$ df -h\n/);
  assert.match(entry, /-- exit 3 in \d+ms\n\n$/);
});


test('level 4 diagnostics run without exact-command approval; lower levels still ask', () => {
  const gate = new ShellGate();
  for (const command of DIAGNOSTIC_COMMANDS) {
    assert.deepEqual(gate.consider({ command, said: 'Run a live test', door: 'phone', now: 1, diagnostics: true }), { run: true, because: 'level 4 diagnostic' });
    assert.equal(gate.consider({ command, said: 'Run a live test', door: 'phone', now: 1, diagnostics: false }).run, false);
  }
});

test('diagnostic approval cannot be extended with shell syntax or arbitrary reads', () => {
  for (const command of ['df -h; touch /tmp/unauthorized', 'df -h > /tmp/out', 'df -h\nreboot', 'DF -h', '$(uptime)', 'env uptime', 'cat ~/.config/haru/openrouter-key', 'systemctl --user restart haru', 'curl https://example.com', 'tail -n 120 /home/toomii/haru.log | bash']) {
    const gate = new ShellGate();
    assert.equal(gate.consider({ command, said: 'Run a live test', door: 'phone', now: 1, diagnostics: true }).run, false, command);
  }
});
