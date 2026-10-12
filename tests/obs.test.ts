import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIN_FRAME_BYTES, authToken, imageBase64, looksBlank, readObsServer } from '../electron/obs';

test('the auth answer matches the obs-websocket recipe', () => {
  assert.equal(authToken('supersecret', 'salty', 'challengeme'), 'TQE+IShFmKT0GyYSlshotQDOm+fGBGXZ+yzDQGziGy0=');
});

test('the picture is unwrapped from its data URI, and left alone otherwise', () => {
  assert.equal(imageBase64('data:image/png;base64,AAAA'), 'AAAA');
  assert.equal(imageBase64('AAAA'), 'AAAA');
});

test('a blank canvas reads as no frame, a real one does not', () => {
  assert.equal(looksBlank('A'.repeat(8000)), true);
  assert.equal(looksBlank('A'.repeat(MIN_FRAME_BYTES * 2)), false);
});

test("OBS's own config is read, and its absence is null rather than a throw", () => {
  const appData = mkdtempSync(path.join(tmpdir(), 'haru-obs-'));
  try {
    assert.equal(readObsServer(appData), null);
    const dir = path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ server_enabled: true, server_port: 4455, server_password: 'hunter2' }));
    assert.deepEqual(readObsServer(appData), { enabled: true, port: 4455, password: 'hunter2' });
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});
