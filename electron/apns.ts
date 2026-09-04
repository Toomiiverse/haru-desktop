// Her lines to the phone, through Apple.
//
// The web page gets Web Push; the native app cannot consume that, and until
// there was a paid developer account it polled instead — a refresh iOS grants
// when it feels like it. APNs is the real thing: an HTTP/2 POST to Apple, per
// device token, signed with a key from the developer portal. Nothing here
// needs a library: Node signs ES256 and speaks HTTP/2 on its own.
//
// The key is a file on this machine (apns.keyPath), never in config.json; the
// key ID, team ID and bundle ID beside it are identifiers, not secrets.

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http2 from 'node:http2';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export type ApnsConfig = { keyPath: string; keyId: string; teamId: string; bundleId: string };
export type ApnsDevice = { token: string; name: string; at: string; sandbox: boolean };

export const APNS_HOST = 'https://api.push.apple.com';
export const APNS_SANDBOX_HOST = 'https://api.sandbox.push.apple.com';
/** Apple wants a fresh token at most hourly and not more often than every twenty minutes. */
export const JWT_LIFETIME_MS = 50 * 60_000;

export function readApnsConfig(saved: unknown): ApnsConfig | null {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  const config = { keyPath: text('keyPath'), keyId: text('keyId'), teamId: text('teamId'), bundleId: text('bundleId') || 'com.toomiiverse.haru' };
  return config.keyPath && config.keyId && config.teamId ? config : null;
}

/** A device token is 32 bytes as hex, as iOS hands it over. */
export function isDeviceToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/i.test(token);
}

export function readApnsDevices(saved: unknown): ApnsDevice[] {
  const list = Array.isArray(saved) ? saved : [];
  const out: ApnsDevice[] = [];
  for (const entry of list as Record<string, unknown>[]) {
    if (!entry || !isDeviceToken(entry.token)) continue;
    out.push({ token: entry.token.toLowerCase(), name: typeof entry.name === 'string' ? entry.name : 'an iPhone', at: typeof entry.at === 'string' ? entry.at : '', sandbox: entry.sandbox === true });
  }
  return out;
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * The bearer token: ES256 over `header.claims`, the key ID in the header and
 * the team ID as issuer. Node's `sign` gives DER by default; Apple wants the
 * raw r||s pair, which `ieee-p1363` is.
 */
export function apnsJwt(keyPem: string, keyId: string, teamId: string, nowMs = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey(keyPem), dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${base64url(signature)}`;
}

/** The notification as Apple reads it, and the page the app should open. */
export function apnsPayload(title: string, body: string, url: string, topic: string): string {
  return JSON.stringify({ aps: { alert: { title, body: body.slice(0, 1000) }, sound: 'default', 'thread-id': topic }, url });
}

export type ApnsResult = { status: number; reason?: string; gone: boolean };

/** Whether Apple says this token will never work again. */
export function tokenIsGone(status: number, reason?: string): boolean {
  return status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'));
}

/**
 * One notification to one device. A short-lived HTTP/2 session per send is
 * fine at her volume — a handful a day — and keeps this free of connection
 * bookkeeping.
 */
export function sendApns(device: ApnsDevice, payload: string, config: ApnsConfig, jwt: string, collapseId?: string): Promise<ApnsResult> {
  // Under Electron the send goes to a plain Node child (below); anywhere else,
  // straight from here.
  if (process.versions.electron) return sendApnsFromNode({ device, payload, config, jwt, collapseId });
  return sendApnsHere(device, payload, config, jwt, collapseId);
}

export type ApnsJob = { device: ApnsDevice; payload: string; config: ApnsConfig; jwt: string; collapseId?: string };

/**
 * Electron's Node is built against BoringSSL, and Apple's gateway asks the
 * client for an (optional) certificate during the TLS handshake. Under
 * Electron that exchange tears the HTTP/2 session down before the request is
 * sent — "The pending stream has been canceled (caused by: )", every time —
 * while the system Node, on OpenSSL, carries on without a certificate.
 * Chromium's own stack (net.fetch) is no way round it either: it refuses with
 * ERR_SSL_CLIENT_AUTH_CERT_NEEDED and the select-client-certificate event never
 * fires for main-process requests. So the app runs apns-send.js in `node`
 * (2026-09-04). No node on the machine: the in-process attempt, for the log.
 */
const NODE_CANDIDATES = ['node', '/usr/bin/node', '/usr/local/bin/node', '/opt/homebrew/bin/node'];
export function sendApnsFromNode(job: ApnsJob, attempt = 0): Promise<ApnsResult> {
  const bin = NODE_CANDIDATES[attempt];
  if (!bin) return sendApnsHere(job.device, job.payload, job.config, job.jwt, job.collapseId);
  return new Promise(resolve => {
    const child = execFile(bin, [join(__dirname, 'apns-send.js')], { timeout: 25_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') { resolve(sendApnsFromNode(job, attempt + 1)); return; }
      try {
        const parsed = JSON.parse(String(stdout)) as Partial<ApnsResult>;
        if (typeof parsed.status !== 'number') throw new Error('no status');
        resolve({ status: parsed.status, reason: parsed.reason, gone: parsed.gone === true });
      } catch {
        resolve({ status: 0, reason: error ? `${bin}: ${error.message}` : `${bin} gave no answer`, gone: false });
      }
    });
    child.stdin?.on('error', () => { /* the child died before reading; the callback reports it */ });
    child.stdin?.end(JSON.stringify(job));
  });
}

function sendApnsHere(device: ApnsDevice, payload: string, config: ApnsConfig, jwt: string, collapseId?: string): Promise<ApnsResult> {
  return new Promise(resolve => {
    const host = device.sandbox ? APNS_SANDBOX_HOST : APNS_HOST;
    const client = http2.connect(host);
    const finish = (result: ApnsResult) => { client.close(); resolve(result); };
    client.on('error', error => finish({ status: 0, reason: error.message, gone: false }));
    const headers: Record<string, string> = {
      ':method': 'POST', ':path': `/3/device/${device.token}`,
      authorization: `bearer ${jwt}`, 'apns-topic': config.bundleId, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json',
    };
    if (collapseId) headers['apns-collapse-id'] = collapseId.slice(0, 64);
    const request = client.request(headers);
    let status = 0; let body = '';
    request.on('response', received => { status = Number(received[':status'] ?? 0); });
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      let reason: string | undefined;
      try { reason = (JSON.parse(body) as { reason?: string }).reason; } catch { /* no body on success */ }
      finish({ status, reason, gone: tokenIsGone(status, reason) });
    });
    request.on('error', error => finish({ status: 0, reason: error.message, gone: false }));
    request.setTimeout(15_000, () => request.close(http2.constants.NGHTTP2_CANCEL));
    request.end(payload);
  });
}

/** The signing key read once and the bearer token reused until it is nearly due. */
export function apnsSigner(config: ApnsConfig, now: () => number = Date.now) {
  let pem = '';
  let jwt = ''; let mintedAt = 0;
  return () => {
    if (!pem) pem = readFileSync(config.keyPath, 'utf8');
    if (!jwt || now() - mintedAt > JWT_LIFETIME_MS) { jwt = apnsJwt(pem, config.keyId, config.teamId, now()); mintedAt = now(); }
    return jwt;
  };
}
