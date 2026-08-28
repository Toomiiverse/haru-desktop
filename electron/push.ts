// Reaching the phone when nothing of hers is open on it.
//
// Web Push, spoken directly: RFC 8291 for sealing the message and RFC 8292 for
// proving it is her server sending it. Written against node:crypto rather than
// pulled in as a package for the same reason the rest of this project holds the
// line — the algorithm is fixed, the RFC ships official test vectors (which the
// tests here replay), and a dependency tree is a bigger liability in a packaged
// app than a hundred lines that never change.
//
// Getting the seal wrong is loud, not dangerous: the phone's push service
// refuses the request, or the phone fails to decrypt and shows nothing. The
// secrets protected here are the VAPID private key — which never leaves the
// main process and is stored encrypted by the caller — and the message text,
// which is sealed to the phone so the push service ferries it unread.
//
// Nothing in this file talks to the network. It builds the request; the caller
// sends it, which is what makes any of this testable.

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** One phone that asked to be told. The keys are the phone's, not ours. */
export type PushDevice = {
  /** Where the phone's push service accepts messages for it. */
  endpoint: string;
  /** The phone's public key (base64url, a 65-byte P-256 point). */
  p256dh: string;
  /** The phone's shared auth secret (base64url, 16 bytes). */
  auth: string;
  /** What the person called the device when they signed in on it. */
  name: string;
  added: string;
};

/** What is allowed to buzz, and when the phone is left alone. */
export type PushPrefs = {
  /** Her own unprompted thoughts. */
  random: boolean;
  /** Reminders being chased, and the journal ask. */
  events: boolean;
  /** Thresholds on the machine she runs on. */
  system: boolean;
  /** "HH:MM" pair; equal means no quiet hours. Spans midnight when from > to. */
  quietFrom: string;
  quietTo: string;
};

export function readPushDevices(saved: unknown): PushDevice[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .filter(entry => typeof entry.endpoint === 'string' && /^https:\/\//.test(entry.endpoint)
      && typeof entry.p256dh === 'string' && entry.p256dh
      && typeof entry.auth === 'string' && entry.auth)
    .map(entry => ({
      endpoint: String(entry.endpoint),
      p256dh: String(entry.p256dh),
      auth: String(entry.auth),
      name: typeof entry.name === 'string' ? entry.name : 'a phone',
      added: typeof entry.added === 'string' ? entry.added : '',
    }));
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function readPushPrefs(saved: unknown): PushPrefs {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<PushPrefs>;
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const time = (value: unknown, fallback: string) => (typeof value === 'string' && TIME.test(value) ? value : fallback);
  return {
    random: flag(record.random, true),
    events: flag(record.events, true),
    system: flag(record.system, true),
    // Overnight by default. A companion that buzzes a nightstand at 3am is a
    // companion whose permission gets revoked, which is the quieter failure.
    quietFrom: time(record.quietFrom, '23:00'),
    quietTo: time(record.quietTo, '08:00'),
  };
}

/** Whether the phone is being left alone right now. Uses the clock it is given. */
export function inQuietHours(prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo'>, now: Date): boolean {
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(prefs.quietFrom);
  const to = minutes(prefs.quietTo);
  if (from === to) return false;
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/**
 * A fresh VAPID signing pair, both halves base64url.
 *
 * The public key is exactly what a browser wants as applicationServerKey — a
 * raw uncompressed P-256 point — so it is handed to the page as-is. The private
 * half is a bare 32-byte scalar; whoever stores it encrypts it.
 */
export function newVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const scalar = ecdh.getPrivateKey();
  // A scalar with leading zero bytes comes back short, and a JWK d must be
  // exactly 32 bytes or the key is a different number.
  const padded = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]);
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: padded.toString('base64url') };
}

function signingKey(vapid: { publicKey: string; privateKey: string }): KeyObject {
  const point = Buffer.from(vapid.publicKey, 'base64url');
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
      d: vapid.privateKey,
    },
  });
}

/**
 * Who is knocking, for the push service (RFC 8292): a short-lived token signed
 * with the key the subscription was created against. The audience is the push
 * service's origin, never the full endpoint — Apple checks.
 */
export function vapidToken(audience: string, vapid: { publicKey: string; privateKey: string }, contact: string, now: Date): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = part({ typ: 'JWT', alg: 'ES256' });
  const claims = part({ aud: audience, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: contact });
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key: signingKey(vapid), dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${signature.toString('base64url')}`;
}

/**
 * The message, sealed to one phone (RFC 8291, aes128gcm).
 *
 * The push service sees only this: a salt, our ephemeral public key, and
 * ciphertext only the phone's private key can open. `local` and `salt` exist so
 * the RFC's own test vector — fixed keys, fixed salt — can be replayed exactly;
 * real calls pass neither and get fresh randomness every time.
 */
export function sealPayload(
  p256dh: Buffer,
  auth: Buffer,
  plaintext: Buffer,
  local?: { privateKey: Buffer },
  salt?: Buffer,
): Buffer {
  const ecdh = createECDH('prime256v1');
  if (local) ecdh.setPrivateKey(local.privateKey); else ecdh.generateKeys();
  const ourPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(p256dh);
  const fresh = salt ?? randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), p256dh, ourPublic]), 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, fresh, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, fresh, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  // 0x02 marks the final (and only) record; everything fits in one.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  // The header the phone reads back: salt, record size 4096, our key's length, our key.
  return Buffer.concat([fresh, Buffer.from([0, 0, 16, 0, ourPublic.length]), ourPublic, sealed]);
}

/**
 * Sub claim for the VAPID token. A push service may refuse a token without
 * one; none of them ever mail it. Deliberately not the user's address.
 */
const CONTACT = 'mailto:haru@example.com';

/** How long the push service holds an undelivered message. An hour: a nudge
 *  that arrives stale reads worse than one that never arrives. */
const TTL_SECONDS = 3600;

/**
 * Everything one push needs, built and handed back. The caller does the fetch,
 * watches for 404/410 — the subscription is dead, drop it — and nothing else.
 */
export function pushRequest(
  device: Pick<PushDevice, 'endpoint' | 'p256dh' | 'auth'>,
  payload: string,
  vapid: { publicKey: string; privateKey: string },
  options: { now?: Date; local?: { privateKey: Buffer }; salt?: Buffer } = {},
): { url: string; headers: Record<string, string>; body: Buffer } {
  const body = sealPayload(
    Buffer.from(device.p256dh, 'base64url'),
    Buffer.from(device.auth, 'base64url'),
    Buffer.from(payload, 'utf8'),
    options.local,
    options.salt,
  );
  const token = vapidToken(new URL(device.endpoint).origin, vapid, CONTACT, options.now ?? new Date());
  return {
    url: device.endpoint,
    headers: {
      'Authorization': `vapid t=${token}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(TTL_SECONDS),
      'Urgency': 'normal',
    },
    body,
  };
}

/** The gap between one unprompted push and the next: somewhere in here, never the same twice. */
export const NUDGE_GAP_MS: [number, number] = [45 * 60_000, 150 * 60_000];

/**
 * How long until the next unprompted push.
 *
 * Random within the gap — a nudge on the hour every three hours is a
 * scheduler, and reads as one. A nudge that would land in the quiet hours is
 * pushed past them, plus a little, so the first of the morning is not on the
 * dot of the quiet ending either. `now` is the user's own clock (zonedNow),
 * the same clock inQuietHours reads.
 */
export function nextNudgeDelay(prefs: Pick<PushPrefs, 'quietFrom' | 'quietTo'>, now: Date, random: () => number = Math.random): number {
  const delay = NUDGE_GAP_MS[0] + random() * (NUDGE_GAP_MS[1] - NUDGE_GAP_MS[0]);
  const at = new Date(now.getTime() + delay);
  if (!inQuietHours(prefs, at)) return delay;
  const [hour, minute] = prefs.quietTo.split(':').map(Number);
  const wake = new Date(at.getTime());
  wake.setHours(hour, minute, 0, 0);
  if (wake.getTime() <= at.getTime()) wake.setDate(wake.getDate() + 1);
  return wake.getTime() - now.getTime() + (5 + random() * 35) * 60_000;
}
