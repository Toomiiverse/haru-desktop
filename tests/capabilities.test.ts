import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityLines, describeCapabilities, seesItsOwnScreen } from '../electron/capabilities';

test('on Windows every platform feature is available', () => {
  const capabilities = describeCapabilities('win32');
  assert.equal(capabilities.length, 5);
  assert.equal(capabilities.every(capability => capability.on), true);
  assert.deepEqual(capabilityLines(capabilities, 'win32'), ['[capabilities] all 5 platform features available on win32']);
});

test('anywhere else they are off, and say what they needed', () => {
  const capabilities = describeCapabilities('linux');
  assert.equal(capabilities.some(capability => capability.on), false);
  const lines = capabilityLines(capabilities, 'linux');
  assert.equal(lines[0], '[capabilities] 5 of 5 platform features are off on linux:');
  assert.equal(lines.length, 6);
  assert.equal(lines.every(line => line.startsWith('[capabilities]')), true);
  assert.equal(lines.slice(1).every(line => line.includes(' — needs ')), true);
  assert.match(lines.join('\n'), /seeing which program you are in/);
});

test('the report is never silent — a working platform still says so', () => {
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    assert.ok(capabilityLines(describeCapabilities(platform), platform).length >= 1);
  }
});

test('a game is only ever running on the machine that can see its own screen', () => {
  assert.equal(seesItsOwnScreen('win32'), true);
  assert.equal(seesItsOwnScreen('linux'), false);
  assert.equal(seesItsOwnScreen('darwin'), false);
});
