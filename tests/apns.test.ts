// Her lines to the phone through Apple: the token, the payload, the key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';
import { apnsJwt, apnsPayload, isDeviceToken, readApnsConfig, readApnsDevices, tokenIsGone } from '../electron/apns';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

test('the bearer token is ES256 over header.claims, with the key id and the team as issuer', () => {
  const jwt = apnsJwt(pem, 'ABC123DEFG', 'TEAM123456', 1_700_000_000_000);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { iss: 'TEAM123456', iat: 1_700_000_000 });
  assert.equal(Buffer.from(signature, 'base64url').length, 64, 'raw r||s, not DER');
  assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  assert.ok(createPrivateKey(pem));
});

test('the payload is an alert with a sound, threaded by kind, carrying the page to open', () => {
  const parsed = JSON.parse(apnsPayload('Haru', 'Where are you?', '/', 'haru-random'));
  assert.deepEqual(parsed, { aps: { alert: { title: 'Haru', body: 'Where are you?' }, sound: 'default', 'thread-id': 'haru-random' }, url: '/' });
  assert.equal(JSON.parse(apnsPayload('Haru', 'x'.repeat(2000), '/', 't')).aps.alert.body.length, 1000);
});

test('a device token is 64 hex characters, and a dead one is told from a refusal', () => {
  const token = 'a'.repeat(64);
  assert.ok(isDeviceToken(token)); assert.ok(!isDeviceToken('a'.repeat(63))); assert.ok(!isDeviceToken('z'.repeat(64)));
  assert.deepEqual(readApnsDevices([{ token: token.toUpperCase(), name: 'phone', at: 't', sandbox: false }, { token: 'nope' }]), [{ token, name: 'phone', at: 't', sandbox: false }]);
  assert.ok(tokenIsGone(410)); assert.ok(tokenIsGone(400, 'BadDeviceToken')); assert.ok(!tokenIsGone(403, 'InvalidProviderToken'), 'a bad key is not a dead phone');
});

test('the sender is configured only when the key, its id and the team are all there', () => {
  assert.equal(readApnsConfig({ keyId: 'K', teamId: 'T' }), null);
  assert.deepEqual(readApnsConfig({ keyPath: '/k.p8', keyId: 'K', teamId: 'T' }), { keyPath: '/k.p8', keyId: 'K', teamId: 'T', bundleId: 'com.toomiiverse.haru' });
});
