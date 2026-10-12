// Where her browser may not go, and the proxy that keeps it there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { BLOCKED_TITLE, admit, isLocalName, isPrivateAddress, startGuardProxy } from '../electron/webguard';

test('isPrivateAddress: this machine, the private ranges, link-local, the tailnet, and the IPv6 equivalents', () => {
  for (const inside of ['127.0.0.1', '127.8.8.8', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.254', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd12::1', 'fc00::1', 'fe80::1', '::ffff:192.168.0.1', '[::1]', 'not an address', '999.1.1.1']) {
    assert.equal(isPrivateAddress(inside), true, inside);
  }
  for (const outside of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.63.0.1', '100.128.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(outside), false, outside);
  }
});

test('isLocalName: names that are local by convention, including the tailnet', () => {
  for (const local of ['localhost', 'LOCALHOST.', 'haruserver.local', 'nas.lan', 'router.home', 'haruserver.tail6da04d.ts.net', 'box.internal', '127.0.0.1', '[::1]']) assert.equal(isLocalName(local), true, local);
  for (const outside of ['example.com', 'ts.net.example.com', 'localhost.example.com', 'en.wikipedia.org']) assert.equal(isLocalName(outside), false, outside);
});

test('admit: resolves once and refuses a name that answers private — in part or in whole', async () => {
  const resolve = async (host: string) => ({ 'public.example': ['93.184.216.34'], 'rebind.example': ['93.184.216.34', '10.0.0.5'], 'inside.example': ['192.168.0.9'], 'nowhere.example': [] as string[] })[host] ?? Promise.reject(new Error('ENOTFOUND'));
  assert.deepEqual(await admit('public.example', resolve), { ok: true, address: '93.184.216.34' });
  assert.match((await admit('rebind.example', resolve) as { reason: string }).reason, /private address \(10\.0\.0\.5\)/);
  assert.match((await admit('inside.example', resolve) as { reason: string }).reason, /192\.168\.0\.9/);
  assert.match((await admit('nowhere.example', resolve) as { reason: string }).reason, /does not resolve/);
  assert.match((await admit('gone.example', resolve) as { reason: string }).reason, /ENOTFOUND/);
  assert.match((await admit('localhost', resolve) as { reason: string }).reason, /this machine or this network/);
  assert.match((await admit('127.0.0.1:8787'.split(':')[0], resolve) as { reason: string }).reason, /this machine/);
  assert.deepEqual(await admit('8.8.8.8', resolve), { ok: true, address: '8.8.8.8' });
});

/** One request through the proxy, as a browser would send it. */
function via(proxyPort: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: target.host } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** The first line a CONNECT gets back. */
function tunnel(proxyPort: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.once('data', chunk => { resolve(String(chunk).split('\r\n')[0]); socket.destroy(); });
    socket.on('error', reject);
  });
}

test('the guard proxy refuses private places with a page that says so, and passes what it admits — to the address it checked', async () => {
  // The "public" site is a local server the resolver vouches for under a public name.
  const site = createServer((incoming, response) => response.end(`served ${incoming.headers.host} ${incoming.url}`));
  await new Promise<void>(done => site.listen(0, '127.0.0.1', done));
  const sitePort = (site.address() as AddressInfo).port;
  const resolve = async (host: string) => host === 'evil.example' ? ['10.0.0.1'] : Promise.reject(new Error('ENOTFOUND'));
  // The real check would refuse 127.0.0.1 whatever name it came by, so the one
  // name this test calls public is let through to the local server by hand.
  const gate: typeof admit = (host, lookup) => host === 'public.example' ? Promise.resolve({ ok: true, address: '127.0.0.1' }) : admit(host, lookup);
  const refusals: string[] = [];
  const proxy = await startGuardProxy({ resolve, gate, log: line => refusals.push(line) });
  try {
    const blocked = await via(proxy.port, 'http://127.0.0.1:8787/');
    assert.equal(blocked.status, 403);
    assert.match(blocked.body, new RegExp(BLOCKED_TITLE));
    assert.match(blocked.body, /this machine or this network/);
    assert.equal((await via(proxy.port, 'http://evil.example/')).status, 403);
    assert.equal((await via(proxy.port, 'http://haruserver.tail6da04d.ts.net/')).status, 403);
    assert.equal((await via(proxy.port, 'http://192.168.1.1/')).status, 403);
    const served = await via(proxy.port, `http://public.example:${sitePort}/page?q=1`);
    assert.equal(served.status, 200);
    assert.equal(served.body, `served public.example:${sitePort} /page?q=1`, 'the Host header is the name, the connection is the checked address');
    assert.match(await tunnel(proxy.port, '127.0.0.1:443'), /403/);
    assert.match(await tunnel(proxy.port, 'evil.example:443'), /403/);
    assert.match(await tunnel(proxy.port, `public.example:${sitePort}`), /200 Connection Established/);
    assert.deepEqual(proxy.refused, ['127.0.0.1', 'evil.example', 'haruserver.tail6da04d.ts.net', '192.168.1.1', '127.0.0.1', 'evil.example']);
    assert.ok(refusals.every(line => line.startsWith('[browser] refused ')));
  } finally {
    await proxy.close();
    site.closeAllConnections();
    site.close();
  }
});
