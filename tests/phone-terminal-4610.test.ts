// 4610: the PTY helper behind the Code tab's shell — a real terminal, bytes both ways, and resize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PTY } from '../electron/terminal';

function helper(command: string) {
  const child = spawn('python3', ['-c', PTY, '30', '100', 'sh', '-c', command], { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (b: Buffer) => { out += b.toString(); });
  const done = new Promise<string>(resolve => child.on('exit', () => resolve(out)));
  return { child, done, seen: () => out };
}

test('the shell sees a terminal of the phone\'s size, and a resize reaches it', async () => {
  const { child, done, seen } = helper('stty size; read line; stty size; echo "got $line"');
  for (let i = 0; i < 100 && !seen().includes('30 100'); i++) await new Promise(r => setTimeout(r, 20));
  (child.stdio[3] as NodeJS.WritableStream).write('40 120\n');
  await new Promise(r => setTimeout(r, 100));
  child.stdin!.write('hello\r');
  const out = await done;
  assert.match(out, /30 100/);
  assert.match(out, /40 120/);
  assert.match(out, /got hello/);
});

test('the phone hanging up ends the shell', async () => {
  const { child, done } = helper('sleep 30');
  child.stdin!.end();
  const started = Date.now();
  await done;
  assert.ok(Date.now() - started < 5000);
});
