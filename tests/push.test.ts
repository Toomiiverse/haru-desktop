// The seal, checked against the people who wrote the algorithm.
//
// RFC 8291 ships a complete worked example in its Appendix A: fixed keys on
// both ends, a fixed salt, and the exact bytes that must come out. Replaying it
// is the whole argument for writing this against node:crypto instead of pulling
// a package — the implementation is either byte-for-byte what the RFC says, or
// this test fails. There is no "roughly right" available.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { inQuietHours, newVapidKeys, pushRequest, readPushDevices, readPushPrefs, sealPayload, vapidToken } from '../electron/push';

// -- RFC 8291 Appendix A, verbatim -------------------------------------------

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  sealed: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('the seal reproduces the RFC 8291 test vector byte for byte', () => {
  const sealed = sealPayload(
    Buffer.from(RFC.receiverPublic, 'base64url'),
    Buffer.from(RFC.authSecret, 'base64url'),
    Buffer.from(RFC.plaintext, 'utf8'),
    { privateKey: Buffer.from(RFC.senderPrivate, 'base64url') },
    Buffer.from(RFC.salt, 'base64url'),
  );
  assert.equal(sealed.toString('base64url'), RFC.sealed);
});

test('without the fixed inputs, two seals of the same message never match', () => {
  // Fresh salt and a fresh ephemeral key every time is what the RFC's security
  // depends on; identical output twice would mean one of them is being reused.
  const p256dh = Buffer.from(RFC.receiverPublic, 'base64url');
  const auth = Buffer.from(RFC.authSecret, 'base64url');
  const once = sealPayload(p256dh, auth, Buffer.from('hello'));
  const twice = sealPayload(p256dh, auth, Buffer.from('hello'));
  assert.notEqual(once.toString('base64url'), twice.toString('base64url'));
});

// -- VAPID (RFC 8292) ---------------------------------------------------------

test('the vapid token verifies against its own public key and claims the right audience', () => {
  const vapid = newVapidKeys();
  const now = new Date('2026-08-28T12:00:00Z');
  const token = vapidToken('https://web.push.apple.com', vapid, 'mailto:haru@example.com', now);

  const [head, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  const body = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(body.aud, 'https://web.push.apple.com');
  assert.equal(body.sub, 'mailto:haru@example.com');
  assert.ok(body.exp > now.getTime() / 1000 && body.exp <= now.getTime() / 1000 + 24 * 3600, 'expiry outside what push services accept');

  const point = Buffer.from(vapid.publicKey, 'base64url');
  assert.equal(point.length, 65, 'the public key is not a raw P-256 point');
  const publicKey = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33, 65).toString('base64url') },
  });
  const good = verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  assert.ok(good, 'the signature does not verify');
});

test('a whole request carries the seal, the token, and nothing surprising', () => {
  const vapid = newVapidKeys();
  const request = pushRequest(
    { endpoint: 'https://web.push.apple.com/QOX...token', p256dh: RFC.receiverPublic, auth: RFC.authSecret },
    JSON.stringify({ title: 'Haru', body: 'hi', url: '/' }),
    vapid,
  );
  assert.equal(request.url, 'https://web.push.apple.com/QOX...token');
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.match(request.headers['Authorization'], /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  // The audience must be the origin, not the endpoint — Apple refuses otherwise.
  const claims = JSON.parse(Buffer.from(request.headers['Authorization'].match(/t=[\w-]+\.([\w-]+)\./)![1], 'base64url').toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  // Header: 16 salt + 4 record size + 1 length + 65 key; then ciphertext + 16 tag.
  assert.ok(request.body.length > 86 + 16, 'the body is too short to hold anything');
});

// -- the stored shapes --------------------------------------------------------

test('the device reader keeps only entries that could actually be pushed to', () => {
  const devices = readPushDevices([
    { endpoint: 'https://push.example/a', p256dh: 'x', auth: 'y', name: 'phone' },
    { endpoint: 'http://push.example/plaintext', p256dh: 'x', auth: 'y' },
    { endpoint: 'https://push.example/no-keys' },
    'not even an object',
    null,
  ]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].endpoint, 'https://push.example/a');
  assert.equal(readPushDevices(undefined).length, 0);
});

test('preferences read back sane from anything, and quiet hours span midnight', () => {
  const prefs = readPushPrefs({ random: false, quietFrom: '25:99', quietTo: '07:30' });
  assert.equal(prefs.random, false);
  assert.equal(prefs.events, true);
  assert.equal(prefs.quietFrom, '23:00', 'a nonsense time was accepted');
  assert.equal(prefs.quietTo, '07:30');

  const overnight = { quietFrom: '23:00', quietTo: '08:00' };
  assert.ok(inQuietHours(overnight, new Date(2026, 7, 28, 23, 30)), '23:30 should be quiet');
  assert.ok(inQuietHours(overnight, new Date(2026, 7, 28, 3, 0)), '3:00 should be quiet');
  assert.ok(!inQuietHours(overnight, new Date(2026, 7, 28, 12, 0)), 'noon is not quiet');
  assert.ok(!inQuietHours({ quietFrom: '08:00', quietTo: '08:00' }, new Date(2026, 7, 28, 8, 0)), 'equal times mean no quiet hours');
  const daytime = { quietFrom: '09:00', quietTo: '17:00' };
  assert.ok(inQuietHours(daytime, new Date(2026, 7, 28, 12, 0)), 'a same-day span should hold at noon');
  assert.ok(!inQuietHours(daytime, new Date(2026, 7, 28, 20, 0)), 'a same-day span should end');
});
