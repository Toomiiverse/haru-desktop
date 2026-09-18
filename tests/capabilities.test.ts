import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityLines, defaultSupport, describeCapabilities, seesItsOwnScreen, type PlatformSupport } from '../electron/capabilities';

const ALL: PlatformSupport = { backgroundHelper: true, activeWindow: true, desktopControl: true, location: true, gameDetection: true };
const NONE: PlatformSupport = { backgroundHelper: false, activeWindow: false, desktopControl: false, location: false, gameDetection: false };

test('everything present says so in one line', () => {
  const capabilities = describeCapabilities('win32', ALL);
  assert.equal(capabilities.length, 5);
  assert.equal(capabilities.every(capability => capability.on), true);
  assert.deepEqual(capabilityLines(capabilities, 'win32'), ['[capabilities] all 5 platform features available on win32']);
});

test('missing features are named, with what this platform would have needed', () => {
  const lines = capabilityLines(describeCapabilities('linux', NONE), 'linux');
  assert.equal(lines[0], '[capabilities] 5 of 5 platform features are off on linux:');
  assert.equal(lines.length, 6);
  assert.equal(lines.every(line => line.startsWith('[capabilities]')), true);
  assert.equal(lines.slice(1).every(line => line.includes(' — needs ')), true);
  assert.match(lines.join('\n'), /seeing which program you are in/);
  // The Linux gap names Linux tools, not PowerShell.
  assert.match(lines.join('\n'), /hyprctl/);
  assert.doesNotMatch(lines.join('\n'), /PowerShell/);
});

test('the report is never silent — a working platform still says so', () => {
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    assert.ok(capabilityLines(describeCapabilities(platform, NONE), platform).length >= 1);
  }
});

test('a game is only ever running on a machine that can see its own screen', () => {
  assert.equal(seesItsOwnScreen('win32', ALL), true);
  // Linux with a compositor can see, so it is no longer a Windows question.
  assert.equal(seesItsOwnScreen('linux', ALL), true);
  assert.equal(seesItsOwnScreen('linux', NONE), false);
  assert.equal(seesItsOwnScreen('darwin', NONE), false);
});

test('with no detection in hand, a platform is assumed by name', () => {
  assert.deepEqual(defaultSupport('win32'), ALL);
  // Not Windows and not Linux: the old answer, honestly reported.
  assert.deepEqual(defaultSupport('darwin'), NONE);
});
