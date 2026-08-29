// The Windows-only half of the app, seen from somewhere that is not Windows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESKTOP, desktopSupported, listRunning, supportedDesktop } from '../electron/desktop';

test('the machine controls are Windows only', () => {
  assert.equal(desktopSupported('win32'), true);
  assert.equal(desktopSupported('linux'), false);
  assert.equal(desktopSupported('darwin'), false);
});

test('what is offered is the platform\'s answer as well as the user\'s', () => {
  const on = { launch: true, power: true };
  assert.deepEqual(supportedDesktop(on, 'win32'), on);
  assert.deepEqual(supportedDesktop(on, 'linux'), DEFAULT_DESKTOP);
  // The saved settings themselves are untouched — the object handed in is not
  // the one edited, so a Windows choice survives being read on a server.
  assert.deepEqual(on, { launch: true, power: true });
});

test('listing windows off Windows answers at once instead of waiting to fail', async () => {
  if (process.platform === 'win32') return;
  const started = Date.now();
  assert.deepEqual(await listRunning(), []);
  // The spawn path waits up to eight seconds for PowerShell before giving up.
  assert.ok(Date.now() - started < 500, 'listRunning tried to spawn something');
});
