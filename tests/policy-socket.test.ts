import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createServer as createNet, type Socket } from 'node:net';
import { createServer as createHttp } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 3720: the policy worker's socket transport, against a stand-in Core that speaks the frames (u32 length + bytes; answers
// u32 length + u16 status + body). One handshake per connection; a socket that cannot be opened sends that call over HTTP.
const TOKEN = 'socket-test-token-0123456789abcdef0123456789';
import { readFileSync } from 'node:fs';
// The tests' tsconfig compiles only what tests import, and importing the worker would run it: Node 22 strips the types of
// the source itself when it runs as an ES module (the worker imports node built-ins only).
const workerFile = (() => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'polw-')), 'core-policy-worker.mts');
  writeFileSync(out, readFileSync(path.join(__dirname, '../../electron/core-policy-worker.ts'), 'utf8'));
  return out;
})();
function call(w: Worker, encoded: string): Promise<any> {
  const buffer = new SharedArrayBuffer(65536 + 8); const header = new Int32Array(buffer, 0, 2);
  w.postMessage({ encoded, buffer });
  return (Atomics as any).waitAsync(header, 0, 0, 3000).value.then(() => {
    if (Atomics.load(header, 0) !== 1) return { ok: false };
    return JSON.parse(Buffer.from(buffer, 8, Atomics.load(header, 1)).toString('utf8'));
  });
}
function frames(onFrame: (body: Buffer, sock: Socket, index: number) => void) {
  return (sock: Socket) => {
    let pending = Buffer.alloc(0), index = 0;
    sock.on('data', (d: Buffer) => {
      pending = Buffer.concat([pending, d]);
      while (pending.length >= 4) { const n = pending.readUInt32BE(0); if (pending.length < 4 + n) return; const body = pending.subarray(4, 4 + n); pending = pending.subarray(4 + n); onFrame(body, sock, index++); }
    });
  };
}
const reply = (sock: Socket, status: number, body: string) => { const b = Buffer.from(body); const h = Buffer.alloc(6); h.writeUInt32BE(b.length, 0); h.writeUInt16BE(status, 4); sock.write(Buffer.concat([h, b])); };
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pol-')); chmodSync(dir, 0o700);
  const tokenFile = path.join(dir, 'token'); writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  return { dir, tokenFile, socket: path.join(dir, 'policy.sock') };
}

test('one handshake per connection, then each packet answered in order over the same connection', async () => {
  const f = fixture(); const seen: string[] = []; let connections = 0;
  const server = createNet(s => { connections++; frames((body, sock, i) => { seen.push(body.toString()); if (i > 0) reply(sock, 200, JSON.stringify({ echo: JSON.parse(body.toString()).n })); })(s); });
  await new Promise<void>(r => server.listen(f.socket, r));
  const w = new Worker(workerFile, { workerData: { endpoint: 'http://127.0.0.1:1/', tokenFile: f.tokenFile, socket: f.socket } });
  try {
    for (let n = 0; n < 3; n++) assert.deepEqual(await call(w, JSON.stringify({ n })), { ok: true, value: { echo: n } });
    assert.equal(connections, 1); assert.equal(seen[0], 'Bearer ' + TOKEN); assert.equal(seen.length, 4);
  } finally { await w.terminate(); server.close(); }
});

test('a refusal is a failure and drops the connection; the next call reconnects', async () => {
  const f = fixture(); let connections = 0;
  const server = createNet(s => { connections++; frames((body, sock, i) => { if (i === 0) return; const p = JSON.parse(body.toString()); reply(sock, p.bad ? 409 : 200, p.bad ? 'nudge_policy_owner_mismatch' : '{"fine":1}'); })(s); });
  await new Promise<void>(r => server.listen(f.socket, r));
  const w = new Worker(workerFile, { workerData: { endpoint: 'http://127.0.0.1:1/', tokenFile: f.tokenFile, socket: f.socket } });
  try {
    assert.deepEqual(await call(w, '{"bad":1}'), { ok: false });
    assert.deepEqual(await call(w, '{"bad":0}'), { ok: true, value: { fine: 1 } });
    assert.equal(connections, 2);
  } finally { await w.terminate(); server.close(); }
});

test('a socket that cannot be opened sends the call over HTTP instead', async () => {
  const f = fixture(); let posts = 0;
  const http = createHttp((req, res) => { posts++; let b = ''; req.on('data', c => b += c); req.on('end', () => { assert.equal(req.headers.authorization, 'Bearer ' + TOKEN); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ via: 'http', got: JSON.parse(b) })); }); });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r)); const port = (http.address() as any).port;
  const w = new Worker(workerFile, { workerData: { endpoint: `http://127.0.0.1:${port}/`, tokenFile: f.tokenFile, socket: f.socket } });   // nothing listens on f.socket
  try { assert.deepEqual(await call(w, '{"n":7}'), { ok: true, value: { via: 'http', got: { n: 7 } } }); assert.equal(posts, 1); }
  finally { await w.terminate(); http.close(); }
});

test('the worker refuses to send the token to a socket in a directory others can enter', async () => {
  const f = fixture(); chmodSync(f.dir, 0o755);
  const w = new Worker(workerFile, { workerData: { endpoint: 'http://127.0.0.1:1/', tokenFile: f.tokenFile, socket: f.socket } });
  const error = await new Promise<Error>(r => w.once('error', r));
  assert.match(error.message, /core_policy_socket_not_private/);
  chmodSync(f.dir, 0o700);
});
