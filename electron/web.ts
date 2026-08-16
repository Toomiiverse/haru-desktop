// Letting her be reached from a phone, without letting anyone else in.
//
// What sits behind this door is not a chat toy: it is her memory of one
// person's life — who they live with, what they take, what they wrote in a
// journal on a bad night. That is the reason for every awkward decision in this
// file. A password that can be guessed at leisure, a cookie that never expires,
// a device that cannot be revoked once the phone is lost — each of those is a
// worse failure here than in an app that holds a shopping list.
//
// Nothing in this file talks to the network. It decides who is allowed in; the
// server that asks it is elsewhere, and keeping the two apart is what makes any
// of this testable without opening a port.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export type Device = {
  id: string;
  /** What the person called it, or what the browser said it was. */
  name: string;
  /** The sha256 of the token, never the token. See fingerprint. */
  seal: string;
  added: string;
  lastSeen: string;
};

export type WebAccess = {
  enabled: boolean;
  username: string;
  /** Both hex. Empty until a password has been set, which is what gates enabled. */
  salt: string;
  hash: string;
  devices: Device[];
};

/**
 * How long a remembered phone stays remembered.
 *
 * "Remember this device" has to mean months or it means nothing — a login every
 * week is a login they will disable. But a token with no end is one that
 * survives the phone being sold, so it ends, and using it pushes the end back.
 */
export const DEVICE_DAYS = 90;

/** Nothing here is worth a fast hash. These are the node defaults, stated. */
const SCRYPT_COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 64;

export function readWebAccess(saved: unknown): WebAccess {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<WebAccess>;
  const devices = Array.isArray(record.devices) ? record.devices : [];
  return {
    enabled: Boolean(record.enabled),
    username: typeof record.username === 'string' ? record.username : '',
    salt: typeof record.salt === 'string' ? record.salt : '',
    hash: typeof record.hash === 'string' ? record.hash : '',
    devices: devices
      .filter(d => d && typeof d.seal === 'string' && d.seal)
      .map(d => ({
        id: typeof d.id === 'string' ? d.id : randomBytes(8).toString('hex'),
        name: typeof d.name === 'string' ? d.name : 'a device',
        seal: d.seal,
        added: typeof d.added === 'string' ? d.added : '',
        lastSeen: typeof d.lastSeen === 'string' ? d.lastSeen : '',
      })),
  };
}

/**
 * Why a password is not good enough, in words rather than a score.
 *
 * This is reachable from the whole internet by anyone who learns the address, so
 * the floor is higher than it would be for a local app. Length does most of the
 * work; the rest of the rules exist because the obvious three passwords are the
 * ones actually tried first.
 */
export function weakPassword(password: string, username: string): string | null {
  const value = password.trim();
  if (value.length < 12) return 'It needs to be at least 12 characters — this is reachable from the internet.';
  if (username && value.toLowerCase() === username.toLowerCase()) return 'That is the username.';
  if (/^(.)\1+$/.test(value)) return 'That is one character repeated.';
  if (/^(password|haru|letmein|qwerty|iloveyou)/i.test(value)) return 'That starts with one of the first things anyone tries.';
  return null;
}

export function setPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16);
  return {
    salt: salt.toString('hex'),
    hash: scryptSync(password, salt, KEY_BYTES, SCRYPT_COST).toString('hex'),
  };
}

/**
 * Compared in constant time, because the alternative leaks the password one
 * character at a time to anyone patient enough to measure the reply.
 */
export function passwordMatches(password: string, access: Pick<WebAccess, 'salt' | 'hash'>): boolean {
  if (!access.salt || !access.hash) return false;
  let expected: Buffer;
  try { expected = Buffer.from(access.hash, 'hex'); } catch { return false; }
  if (!expected.length) return false;
  const got = scryptSync(password, Buffer.from(access.salt, 'hex'), expected.length, SCRYPT_COST);
  return timingSafeEqual(got, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What gets written down instead of the token.
 *
 * The store sits in a readable file on a desktop that other things also run on.
 * Keeping only the hash means a copy of that file is not a set of working keys
 * to her memory — the same reason a server never keeps the password itself.
 */
export function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const DAY_MS = 86_400_000;

export function rememberDevice(access: WebAccess, token: string, name: string, now: Date): WebAccess {
  const seal = fingerprint(token);
  const at = now.toISOString();
  const device: Device = {
    id: randomBytes(8).toString('hex'),
    name: (name || '').slice(0, 60) || 'a device',
    seal,
    added: at,
    lastSeen: at,
  };
  return { ...access, devices: [device, ...access.devices.filter(d => d.seal !== seal)] };
}

/**
 * The device this token belongs to, if it is still allowed in.
 *
 * Looked up by hash and compared in constant time for the same reason the
 * password is: a token is a password that types itself.
 */
export function deviceFor(access: WebAccess, token: string, now: Date): Device | null {
  if (!token) return null;
  const wanted = Buffer.from(fingerprint(token), 'hex');
  for (const device of access.devices) {
    let seal: Buffer;
    try { seal = Buffer.from(device.seal, 'hex'); } catch { continue; }
    if (seal.length !== wanted.length || !timingSafeEqual(seal, wanted)) continue;
    const seen = Date.parse(device.lastSeen || device.added);
    if (Number.isFinite(seen) && now.getTime() - seen > DEVICE_DAYS * DAY_MS) return null;
    return device;
  }
  return null;
}

/** Pushes the expiry back, so a phone in daily use is never logged out. */
export function touchDevice(access: WebAccess, id: string, now: Date): WebAccess {
  return { ...access, devices: access.devices.map(d => (d.id === id ? { ...d, lastSeen: now.toISOString() } : d)) };
}

/** For the phone that was lost, which is the only reason any of this is stored. */
export function forgetDevice(access: WebAccess, id: string): WebAccess {
  return { ...access, devices: access.devices.filter(d => d.id !== id) };
}

/** Changing the password turns every remembered device off. That is the point of changing it. */
export function forgetEveryDevice(access: WebAccess): WebAccess {
  return { ...access, devices: [] };
}

export type Attempts = { failures: number; until: number };

/**
 * Slowing down guessing, without ever locking the real person out for good.
 *
 * A password behind a public address gets tried, patiently, by things that are
 * not people. Backing off doubles the wait each time and stops at a quarter of
 * an hour: long enough that guessing is hopeless, short enough that being locked
 * out of her while standing at a bus stop is survivable.
 */
const FIRST_WAIT_MS = 2_000;
const LONGEST_WAIT_MS = 15 * 60_000;
export const FREE_TRIES = 3;

export function noteFailure(attempts: Attempts, now: number): Attempts {
  const failures = attempts.failures + 1;
  if (failures <= FREE_TRIES) return { failures, until: 0 };
  const wait = Math.min(FIRST_WAIT_MS * 2 ** (failures - FREE_TRIES - 1), LONGEST_WAIT_MS);
  return { failures, until: now + wait };
}

export function lockedFor(attempts: Attempts, now: number): number {
  return attempts.until > now ? attempts.until - now : 0;
}

export function clearFailures(): Attempts {
  return { failures: 0, until: 0 };
}
