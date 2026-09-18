// The machine controls, seen from the platforms that have them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESKTOP, desktopSupported, listRunning, powerDelaySeconds, supportedDesktop } from '../electron/desktop';

test('the machine controls are Windows and Linux, and nothing else', () => {
  assert.equal(desktopSupported('win32'), true);
  assert.equal(desktopSupported('linux'), true);
  assert.equal(desktopSupported('darwin'), false);
});

test('what is offered is the platform\'s answer as well as the user\'s', () => {
  const on = { launch: true, power: true };
  assert.deepEqual(supportedDesktop(on, 'win32'), on);
  assert.deepEqual(supportedDesktop(on, 'linux'), on);
  assert.deepEqual(supportedDesktop(on, 'darwin'), DEFAULT_DESKTOP);
  // The saved settings themselves are untouched — the object handed in is not
  // the one edited, so a Windows choice survives being read on a server.
  assert.deepEqual(on, { launch: true, power: true });
});

test('the countdown is the platform\'s own', () => {
  // Windows owns a twenty-second timer; systemd only speaks in minutes.
  assert.equal(powerDelaySeconds('win32'), 20);
  assert.equal(powerDelaySeconds('linux'), 60);
});

test('listing windows answers rather than waiting on a shell that is not there', async () => {
  // On a machine with a compositor this returns its windows; on one without it
  // returns nothing. Both are answers, and neither may be an eight-second wait.
  const started = Date.now();
  const running = await listRunning();
  assert.ok(Array.isArray(running));
  assert.ok(Date.now() - started < 4000, 'listRunning waited on a spawn that should have answered');
});
