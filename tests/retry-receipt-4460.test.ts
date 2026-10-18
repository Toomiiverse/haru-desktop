// 4460: a retry carries a request ID, so a phone whose stream dropped can ask how it ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startWebServer, type WebDeps } from '../electron/webserver';
import { fingerprint } from '../electron/web';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The durable intake knows nothing of retries: a stand-in core service that answers every lookup with no receipt.
const core = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{"receipt":null}'); }); });
test.before(async () => {
  await new Promise<void>(done => core.listen(0, '127.0.0.1', done));
  const dir = mkdtempSync(join(tmpdir(), 'retry-receipt-'));
  writeFileSync(join(dir, 'token'), 't'.repeat(40), { mode: 0o600 });   // the intake wants a 32+ character private token
  process.env.HARU_CORE_SERVICE_ENDPOINT = `http://127.0.0.1:${(core.address() as { port: number }).port}`;
  process.env.HARU_CORE_SERVICE_TOKEN_FILE = join(dir, 'token');
});
test.after(() => { core.close(); });

const TOKEN = 'retry-receipt-test-device';
function server(retryStream: () => Promise<{ reply: string; ignored?: boolean } | null>) {
  const now = new Date().toISOString();
  const deps = {
    readAccess: () => ({ enabled: true, username: 'u', salt: '00', hash: '00', devices: [{ id: 'phone', name: 'phone', seal: fingerprint(TOKEN), added: now, lastSeen: now }] }),
    slate: () => ({ at: 'slate-1' }),
    retryStream,
  } as unknown as WebDeps;
  return startWebServer(0, deps);
}
const headers = { cookie: `haru_device=${TOKEN}`, 'content-type': 'application/json' };

test('a retry with a request ID leaves a receipt with her reply, and asking again does not run it twice', async () => {
  let runs = 0;
  const web = await server(async () => { runs++; return { reply: 'Again, then.' }; });
  try {
    const base = `http://127.0.0.1:${web.port}`;
    const id = 'retry-1234567890abcdef';
    const first = await (await fetch(base + '/api/chat/retry', { method: 'POST', headers, body: JSON.stringify({ requestId: id }) })).text();
    assert.match(first, /"done":true/);
    const receipt = await (await fetch(`${base}/api/chat/receipt?id=${id}`, { headers })).json();
    assert.deepEqual(receipt, { state: 'done', reply: 'Again, then.', ignored: false });
    const second = await (await fetch(base + '/api/chat/retry', { method: 'POST', headers, body: JSON.stringify({ requestId: id }) })).text();
    assert.match(second, /Again, then\./);
    assert.equal(runs, 1);
    assert.equal((await fetch(base + '/api/chat/retry', { method: 'POST', headers, body: JSON.stringify({ requestId: 'x' }) })).status, 400);
  } finally { await web.stop(); }
});

test('a retry with nothing to redo records the error; a retry without an ID still works', async () => {
  const web = await server(async () => null);
  try {
    const base = `http://127.0.0.1:${web.port}`;
    const id = 'retry-nothing-1234567890';
    await (await fetch(base + '/api/chat/retry', { method: 'POST', headers, body: JSON.stringify({ requestId: id }) })).text();
    const receipt = await (await fetch(`${base}/api/chat/receipt?id=${id}`, { headers })).json();
    assert.equal(receipt.state, 'error');
    assert.match(await (await fetch(base + '/api/chat/retry', { method: 'POST', headers, body: '{}' })).text(), /nothing of hers/);
  } finally { await web.stop(); }
});
