// Driving the browser on this machine — the pure half worth pinning down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BROWSER_CONTROL, DEFAULT_BROWSER_PORT, asAddress, readBrowserControlConfig } from '../electron/browserctl';

test('readBrowserControlConfig defaults off, to her own browser, on the standard port', () => {
  assert.deepEqual(readBrowserControlConfig(undefined), { enabled: false, backend: 'playwright', port: 9222, executablePath: '' });
  assert.deepEqual(readBrowserControlConfig(undefined), DEFAULT_BROWSER_CONTROL);
  assert.equal(DEFAULT_BROWSER_PORT, 9222);
  assert.equal(readBrowserControlConfig({ enabled: true, backend: 'chrome' }).backend, 'chrome');
  assert.equal(readBrowserControlConfig({ enabled: true, backend: 'firefox' }).backend, 'playwright', 'an unknown backend is hers');
  assert.equal(readBrowserControlConfig({ enabled: true, executablePath: ' /usr/bin/chromium ' }).executablePath, '/usr/bin/chromium');
});

test('asAddress: an address is itself, a bare domain gets https, words become a search, other schemes are refused', () => {
  assert.equal(asAddress('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(asAddress('HTTP://example.com'), 'HTTP://example.com');
  assert.equal(asAddress('youtube.com'), 'https://youtube.com');
  assert.equal(asAddress('en.wikipedia.org/wiki/Cat'), 'https://en.wikipedia.org/wiki/Cat');
  assert.equal(asAddress('the weather in perth'), 'https://html.duckduckgo.com/html/?q=the%20weather%20in%20perth');
  assert.throws(() => asAddress('file:///etc/passwd'), /Only http and https/);
  assert.throws(() => asAddress('javascript:alert(1)'), /Only http and https/);
});

test('readBrowserControlConfig keeps an explicit on and a sane port', () => {
  assert.equal(readBrowserControlConfig({ enabled: true, port: 9333 }).port, 9333);
  assert.equal(readBrowserControlConfig({ enabled: true, port: 9333 }).enabled, true);
  assert.equal(readBrowserControlConfig({ enabled: true, port: 0 }).port, 9222, 'a nonsense port falls back');
  assert.equal(readBrowserControlConfig({ enabled: true, port: -5 }).port, 9222);
});