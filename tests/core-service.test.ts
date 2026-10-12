import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoreServiceClient, CoreServiceError, coreServiceOptions } from '../electron/core-service-client';

test('service configuration is explicit and loopback-only', () => {
  assert.equal(coreServiceOptions({}), undefined);
  assert.throws(() => coreServiceOptions({ HARU_CORE_SERVICE_ENDPOINT: 'http://127.0.0.1:8792' }), /token_required/);
  for (const endpoint of ['https://example.com', 'http://localhost:8792', 'http://127.0.0.1:8792/path', 'http://user@127.0.0.1:8792']) {
    assert.throws(() => new CoreServiceClient({ endpoint, tokenFile: '/nonexistent' }), /loopback_required/);
  }
});

test('unknown transport outcome makes one request with a recoverable request id', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-client-'));
  const tokenFile = path.join(root, 'token'); writeFileSync(tokenFile, 'test-token-'.repeat(5), { mode: 0o600 });
  let calls = 0;
  const server = createServer((req) => { calls++; req.socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const client = new CoreServiceClient({ endpoint: `http://127.0.0.1:${port}`, tokenFile });
    await assert.rejects(client.call('storage', 'commit', {}, 'known-request'), (error: any) => error instanceof CoreServiceError && error.code === 'core_service_outcome_unknown' && error.requestId === 'known-request');
    assert.equal(calls, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true }); }
});

test('response identity is checked and private error detail is not exposed', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-client-'));
  const tokenFile = path.join(root, 'token'); writeFileSync(tokenFile, 'test-token-'.repeat(5), { mode: 0o600 });
  let mode = 'mismatch';
  const server = createServer((req, res) => {
    if (mode === 'mismatch') res.end(JSON.stringify({ protocol: 1, id: 'wrong', ok: true, result: {} }));
    else { res.statusCode = 500; res.end(JSON.stringify({ detail: 'PRIVATE token=secret' })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new CoreServiceClient({ endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tokenFile });
    await assert.rejects(client.call('tasks', 'health', {}), /protocol_error/);
    mode = 'private';
    await assert.rejects(client.call('tasks', 'health', {}), (error: any) => error.message === 'core_service_unavailable');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true }); }
});
