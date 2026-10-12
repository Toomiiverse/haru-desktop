// Where her browser may not go: anything that is this machine, this network,
// or this tailnet.
//
// The browser runs on the server, and the server can reach things the internet
// cannot — her own web client on 127.0.0.1:8787, qBittorrent, Jellyfin, the
// router, every Tailscale peer. A page she opens can point an image, a script
// or a redirect at any of those, which is the classic way a browser inside a
// network is turned against it. So every request the browser makes goes through
// the small proxy below, which resolves the name once, checks the address it
// got, and connects to that very address. Resolving here rather than in the
// browser is what closes the rebinding trick, where a name answers public once
// for the check and private once for the connection.
//
// The classifier is pure and tested; the proxy is a thin thing around it.

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { lookup } from 'node:dns/promises';

/** Names that are local by convention, whatever they resolve to. */
const LOCAL_NAMES = /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|ts\.net|arpa)$/i;

/** True for an address that is this machine, a private network, link-local,
 *  the Tailscale range, or an IPv6 equivalent. Unparseable counts as private:
 *  the cost of a wrong "public" is the whole point of the file. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (/^f[cd]/.test(ip)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(ip)) return true; // fe80::/10 link-local
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return privateV4(mapped[1]);
    return false;
  }
  return true;
}

function privateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address with it
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — Tailscale, and carrier NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** True for a hostname that must not even be looked up. */
export function isLocalName(host: string): boolean {
  const name = host.replace(/\.$/, '').toLowerCase();
  return LOCAL_NAMES.test(name) || isIP(name.replace(/^\[|\]$/g, '')) !== 0 && isPrivateAddress(name);
}

export type Resolver = (host: string) => Promise<string[]>;

const resolveAll: Resolver = async host => (await lookup(host, { all: true })).map(entry => entry.address);

/**
 * The one address the browser may connect to for `host`, or a reason it may
 * not. Every address the name resolves to has to be public: a name that mixes
 * a public and a private answer is refused, because the browser would take
 * whichever came first.
 */
export async function admit(host: string, resolve: Resolver = resolveAll): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
  const name = host.replace(/^\[|\]$/g, '');
  if (!name) return { ok: false, reason: 'no host' };
  if (isLocalName(name)) return { ok: false, reason: `${name} is on this machine or this network` };
  if (isIP(name)) return isPrivateAddress(name) ? { ok: false, reason: `${name} is a private address` } : { ok: true, address: name };
  let addresses: string[];
  try {
    addresses = await resolve(name);
  } catch (error) {
    return { ok: false, reason: `${name} could not be looked up (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!addresses.length) return { ok: false, reason: `${name} does not resolve` };
  const inside = addresses.find(isPrivateAddress);
  if (inside) return { ok: false, reason: `${name} points at a private address (${inside})` };
  return { ok: true, address: addresses[0] };
}

/** The page the browser sees in place of one it may not have. Plain and
 *  titled, so a snapshot of it reads as what it is. */
export const BLOCKED_TITLE = 'Blocked by Haru';

export function blockedPage(reason: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${BLOCKED_TITLE}</title></head><body><h1>${BLOCKED_TITLE}</h1><p>Your browser does not reach private addresses: ${escapeHtml(reason)}.</p></body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

export type GuardProxy = {
  port: number;
  /** Hosts refused so far, newest last, for the log and for telling her why a page is blank. */
  refused: string[];
  close(): Promise<void>;
};

function hostAndPort(target: string, fallback: number): { host: string; port: number } {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(target);
  if (!match) return { host: target, port: fallback };
  return { host: match[1], port: match[2] ? Number(match[2]) : fallback };
}

/**
 * The proxy itself, on a loopback port of its own. Plain http is forwarded
 * request by request; https arrives as CONNECT and is tunnelled byte for byte,
 * unread — the check is on the name and the address, never on the content.
 */
export function startGuardProxy({ resolve = resolveAll, gate = admit, log = () => {} }: {
  resolve?: Resolver;
  /** The check itself; replaced only by a test that needs a local server to pass as public. */
  gate?: typeof admit;
  log?: (line: string) => void;
} = {}): Promise<GuardProxy> {
  const refused: string[] = [];
  const refuse = (host: string, reason: string) => {
    refused.push(host);
    if (refused.length > 50) refused.shift();
    log(`[browser] refused ${host}: ${reason}`);
  };

  const server: Server = createServer(async (incoming: IncomingMessage, response: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(incoming.url ?? '');
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain' }).end('not a proxy request');
      return;
    }
    if (url.protocol !== 'http:') {
      response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }).end(blockedPage(`${url.protocol} is not allowed`));
      return;
    }
    const verdict = await gate(url.hostname, resolve);
    if (!verdict.ok) {
      refuse(url.hostname, verdict.reason);
      response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }).end(blockedPage(verdict.reason));
      return;
    }
    const headers = { ...incoming.headers };
    delete headers['proxy-connection'];
    const upstream = httpRequest({
      host: verdict.address,
      port: url.port ? Number(url.port) : 80,
      method: incoming.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, host: url.host },
      setHost: false,
    }, answer => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on('error', error => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`could not reach ${url.hostname}: ${error.message}`);
    });
    incoming.pipe(upstream);
  });

  server.on('connect', async (incoming: IncomingMessage, socket: Socket, head: Buffer) => {
    const { host, port } = hostAndPort(incoming.url ?? '', 443);
    const verdict = await gate(host, resolve);
    if (!verdict.ok) {
      refuse(host, verdict.reason);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = netConnect(port, verdict.address, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    socket.on('error', () => upstream.destroy());
  });

  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolveStart({
        port,
        refused,
        close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}
