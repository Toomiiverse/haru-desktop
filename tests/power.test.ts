import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorPollDelay, KEEP_ALIVE_BATTERY, KEEP_ALIVE_MAINS, powerSourceFrom, readLinuxPowerSource, resolveKeepAlive } from '../electron/power';

test('the power source is read from the kernel, not guessed', () => {
  assert.equal(powerSourceFrom([{ type: 'Battery', status: 'Discharging' }, { type: 'Mains', online: '0' }]), 'battery');
  assert.equal(powerSourceFrom([{ type: 'Battery', status: 'Charging' }, { type: 'Mains', online: '1' }]), 'mains');
  assert.equal(powerSourceFrom([{ type: 'Battery', status: 'Full' }]), 'mains');
  // A desktop with no battery is mains, not unknown.
  assert.equal(powerSourceFrom([{ type: 'Mains', online: '1' }]), 'mains');
  assert.equal(powerSourceFrom([]), 'unknown');
});

test('the sysfs reader asks each supply and reads what it says', () => {
  const files: Record<string, string> = {
    '/ps/BAT1/type': 'Battery\n', '/ps/BAT1/status': 'Discharging\n',
    '/ps/ACAD/type': 'Mains\n', '/ps/ACAD/online': '0\n',
  };
  assert.equal(readLinuxPowerSource('/ps', () => ['BAT1', 'ACAD'], file => files[file] ?? ''), 'battery');
  // A machine with no sysfs directory at all is unknown, not a crash.
  assert.equal(readLinuxPowerSource('/nope', () => { throw new Error('no dir'); }), 'unknown');
});

test('the model is held forever on mains and five minutes on battery', () => {
  assert.equal(resolveKeepAlive(undefined, false), KEEP_ALIVE_MAINS);
  assert.equal(resolveKeepAlive('', false), -1);
  assert.equal(resolveKeepAlive(undefined, true), KEEP_ALIVE_BATTERY);
});

test('the override wins, as seconds or a duration', () => {
  assert.equal(resolveKeepAlive('0', true), 0);
  assert.equal(resolveKeepAlive('600', false), 600);
  assert.equal(resolveKeepAlive('10m', true), '10m');
  // Whitespace is trimmed rather than handed to Ollama as a model name.
  assert.equal(resolveKeepAlive('  30m  ', false), '30m');
});

test('the cursor poll slows once nobody is moving it, and comes straight back', () => {
  assert.equal(cursorPollDelay(0), 33);
  assert.equal(cursorPollDelay(29), 33);
  assert.equal(cursorPollDelay(30), 250);
  assert.equal(cursorPollDelay(300), 250);
});
