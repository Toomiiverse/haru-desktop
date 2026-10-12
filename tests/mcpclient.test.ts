// The stdio half of MCP, against two pipes standing in for a process.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { McpClient, imageOf, textOf, type McpChild } from '../electron/mcpclient';

/** A server that answers from a script: method -> result (or an error). */
function fakeServer(answer: (method: string, params: unknown) => unknown) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const events = new EventEmitter();
  const seen: { method: string; params: unknown }[] = [];
  let buffer = '';
  stdin.on('data', chunk => {
    buffer += String(chunk);
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      const message = JSON.parse(line) as { id?: number; method: string; params: unknown };
      seen.push({ method: message.method, params: message.params });
      if (message.id === undefined) continue;
      const result = answer(message.method, message.params);
      if (result === undefined) continue; // a server that never answers this one
      const reply = result instanceof Error ? { jsonrpc: '2.0', id: message.id, error: { code: -1, message: result.message } } : { jsonrpc: '2.0', id: message.id, result };
      // A log line on stdout in the middle, which a real server never does but a stray console.log would.
      stdout.write('not json at all\n');
      stdout.write(`${JSON.stringify(reply)}\n`);
    }
  });
  const child = Object.assign(events, { stdin, stdout, pid: 4242, kill: () => { events.emit('exit', null, 'SIGTERM'); return true; } }) as unknown as McpChild & { emit: EventEmitter['emit'] };
  return { child, seen };
}

test('McpClient shakes hands, lists and calls tools over newline-delimited JSON-RPC', async () => {
  const { child, seen } = fakeServer((method, params) => {
    if (method === 'initialize') return { protocolVersion: '2025-06-18', serverInfo: { name: 'Playwright', version: '1.64' } };
    if (method === 'tools/list') return { tools: [{ name: 'browser_navigate' }, { name: 'browser_snapshot' }] };
    if (method === 'tools/call' && (params as { name: string }).name === 'nothing') return new Error('Tool nothing not found');
    if (method === 'tools/call') return { content: [{ type: 'text', text: `called ${(params as { name: string }).name}` }, { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }] };
    return new Error(`unknown ${method}`);
  });
  const client = new McpClient(child);
  assert.deepEqual(await client.initialize(), { name: 'Playwright', version: '1.64' });
  assert.deepEqual(seen.map(entry => entry.method), ['initialize', 'notifications/initialized']);
  assert.deepEqual(await client.listTools(), ['browser_navigate', 'browser_snapshot']);
  const result = await client.callTool('browser_navigate', { url: 'https://example.com/' });
  assert.equal(textOf(result), 'called browser_navigate');
  assert.deepEqual(imageOf(result), { data: 'QUJD', mimeType: 'image/jpeg' });
  assert.equal(result.isError, false);
  assert.deepEqual(seen.at(-1)?.params, { name: 'browser_navigate', arguments: { url: 'https://example.com/' } });
  await assert.rejects(client.callTool('nothing'), /Tool nothing not found/);
  client.close();
  assert.equal(client.alive, false);
  await assert.rejects(client.callTool('browser_snapshot'), /closed/);
});

test('McpClient: an isError result is still a result, and a dead process fails what was waiting', async () => {
  const { child } = fakeServer(method => method === 'tools/call' ? { content: [{ type: 'text', text: '### Error\nError: Ref e9 not found' }], isError: true } : {});
  const client = new McpClient(child);
  const result = await client.callTool('browser_click', { target: 'e9' });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /Ref e9 not found/);
  // A request the server never answers, then the process goes.
  const silent = fakeServer(() => undefined);
  const quiet = new McpClient(silent.child, 5_000);
  const waiting = quiet.callTool('browser_snapshot').then(() => 'answered', (error: Error) => error.message);
  silent.child.emit('exit', 1, null);
  assert.match(await waiting, /exited/);
  assert.equal(quiet.alive, false);
});

test('McpClient gives up on a request nobody answers', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, pid: 1, kill: () => true }) as unknown as McpChild;
  const client = new McpClient(child, 20);
  await assert.rejects(client.callTool('browser_snapshot'), /did not answer tools\/call/);
  assert.equal(client.alive, true, 'a slow answer is not a dead process');
});
