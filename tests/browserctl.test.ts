// Driving the browser on this machine — the pure half worth pinning down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BROWSER_CONTROL, DEFAULT_BROWSER_PORT, readBrowserControlConfig } from '../electron/browserctl';

test('readBrowserControlConfig defaults off on the standard port', () => {
  assert.deepEqual(readBrowserControlConfig(undefined), { enabled: false, port: 9222 });
  assert.equal(DEFAULT_BROWSER_PORT, 9222);
});

test('readBrowserControlConfig keeps an explicit on and a sane port', () => {
  assert.deepEqual(readBrowserControlConfig({ enabled: true, port: 9333 }), { enabled: true, port: 9333 });
  assert.equal(readBrowserControlConfig({ enabled: true, port: 0 }).port, 9222, 'a nonsense port falls back');
  assert.equal(readBrowserControlConfig({ enabled: true, port: -5 }).port, 9222);
});