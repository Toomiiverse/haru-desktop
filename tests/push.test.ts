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
import { heldBack, inQuietHours, newVapidKeys, pushRequest, readPushDevices, readPushPrefs, sealPayload, vapidToken, nextNudgeDelay, NUDGE_GAP_MS, NUDGE_FLOOR_MS, nudgeOverdue, LAST_CALL_MS, untilQuiet, PUSH_BREATHER_MS, tooSoonToPush, withoutDevice, isPhoneWebApp, coveredByNativeApp } from '../electron/push';

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

test('the next nudge is a random while off, never in the quiet hours, and not on the dot of them ending', () => {
  const prefs = { quietFrom: '23:00', quietTo: '06:00' };
  const at = (h: number, m = 0) => { const d = new Date(2026, 7, 28, h, m, 0, 0); return d; };
  const fixed = (v: number) => () => v;
  // Midday, shortest and longest gaps.
  assert.equal(nextNudgeDelay(prefs, at(12), fixed(0)), NUDGE_GAP_MS[0]);
  assert.equal(nextNudgeDelay(prefs, at(12), fixed(1)), NUDGE_GAP_MS[1]);
  // Almost bedtime, with too little evening left to be worth one: the gap would
  // land after midnight, so it is pushed to after six, plus a little. (With more
  // of the evening left it is squeezed into what remains instead — see the
  // last-call test below, which is what stopped her sleeping on a whole night.)
  const late = nextNudgeDelay(prefs, at(22, 50), fixed(0.5));
  const lands = new Date(at(22, 50).getTime() + late);
  assert.ok(lands.getHours() >= 6 && lands.getHours() < 7, `lands after the quiet ends, not in it (${lands.getHours()}:${lands.getMinutes()})`);
  assert.ok(lands.getMinutes() >= 5, 'and not on the dot');
  // Small hours: same, and never a delay of nothing.
  assert.ok(nextNudgeDelay(prefs, at(2), fixed(0)) > 3 * 60 * 60_000);
  // No quiet hours at all: the plain gap.
  assert.equal(nextNudgeDelay({ quietFrom: '08:00', quietTo: '08:00' }, at(2), fixed(0)), NUDGE_GAP_MS[0]);
});

test('two hours without her landing anything is overdue, and the quiet hours are not', () => {
  const prefs = { quietFrom: '23:00', quietTo: '06:00' };
  const noon = new Date(2026, 7, 28, 12, 0, 0, 0);
  const now = noon.getTime();
  // Just under, and just over.
  assert.equal(nudgeOverdue(now - NUDGE_FLOOR_MS + 60_000, now, prefs, noon), false);
  assert.equal(nudgeOverdue(now - NUDGE_FLOOR_MS, now, prefs, noon), true);
  assert.equal(nudgeOverdue(now - 5 * 60 * 60_000, now, prefs, noon), true);
  // Asleep: a whole night overdue is still not a reason to buzz them at three.
  const small = new Date(2026, 7, 28, 3, 0, 0, 0);
  assert.equal(nudgeOverdue(small.getTime() - 6 * 60 * 60_000, small.getTime(), prefs, small), false);
  // Nothing known yet is not the same as overdue.
  assert.equal(nudgeOverdue(0, now, prefs, noon), false);
});

test('the last of the evening is used rather than thrown over the night', () => {
  const prefs = { quietFrom: '23:00', quietTo: '06:00' };
  const at = (h: number, m = 0) => new Date(2026, 7, 28, h, m, 0, 0);
  const fixed = (v: number) => () => v;
  // 21:37 with 83 minutes of evening left: the long draw would land at 23:22
  // and used to hop the whole night — 526 minutes for having said hello.
  const late = nextNudgeDelay(prefs, at(21, 37), fixed(1));
  assert.ok(late < 83 * 60_000, `stayed inside the evening, got ${Math.round(late / 60_000)} min`);
  const lands = new Date(at(21, 37).getTime() + late);
  assert.equal(inQuietHours(prefs, lands), false);
  // Never immediate, however little is left.
  assert.ok(nextNudgeDelay(prefs, at(22, 45), fixed(0)) >= 60_000);
  // Too close to the quiet to be worth one: hop as before, to after six.
  const closing = nextNudgeDelay(prefs, at(22, 50), fixed(1));
  const after = new Date(at(22, 50).getTime() + closing);
  assert.ok(after.getHours() >= 6 && after.getHours() < 7, `hopped the night, got ${after.getHours()}:${after.getMinutes()}`);
  // A draw that lands before the quiet is untouched either way.
  assert.equal(nextNudgeDelay(prefs, at(12), fixed(0)), NUDGE_GAP_MS[0]);
});

test('how long is left of the waking day', () => {
  const prefs = { quietFrom: '23:00', quietTo: '06:00' };
  const at = (h: number, m = 0) => new Date(2026, 7, 28, h, m, 0, 0);
  assert.equal(untilQuiet(prefs, at(22, 30)), 30 * 60_000);
  assert.equal(untilQuiet(prefs, at(22, 30)), LAST_CALL_MS);
  assert.equal(untilQuiet(prefs, at(7)), 16 * 60 * 60_000);
  // Already in it.
  assert.equal(untilQuiet(prefs, at(23, 30)), null);
  assert.equal(untilQuiet(prefs, at(2)), null);
  // No quiet hours configured at all.
  assert.equal(untilQuiet({ quietFrom: '08:00', quietTo: '08:00' }, at(12)), 20 * 60 * 60_000);
});

test('one notification at a time, except a reminder', () => {
  const now = Date.parse('2026-08-30T02:22:00.000Z');
  const justNow = now - 5 * 60_000;
  assert.equal(tooSoonToPush('random', justNow, now), true);
  assert.equal(tooSoonToPush('weather', justNow, now), true);
  assert.equal(tooSoonToPush('system', justNow, now), true);
  // A reminder is about a time, and waits for nothing.
  assert.equal(tooSoonToPush('events', justNow, now), false);
  assert.equal(tooSoonToPush('random', now - PUSH_BREATHER_MS, now), false);
  // Nothing ever landed: nothing to wait for.
  assert.equal(tooSoonToPush('random', 0, now), false);
});

test('a push carries a topic, made safe for the header', () => {
  const keys = newVapidKeys();
  const device = { endpoint: 'https://push.example/x', p256dh: RFC.receiverPublic, auth: RFC.authSecret };
  const topped = pushRequest(device, '{"a":1}', keys, {}, 'haru-random');
  assert.equal(topped.headers['Topic'], 'haru-random');
  assert.equal(pushRequest(device, '{"a":1}', keys, {}, 'ev-abc/def!').headers['Topic'], 'ev-abcdef');
  assert.equal('Topic' in pushRequest(device, '{"a":1}', keys).headers, false);
});

test('a Focus on the phone holds her, in or out of quiet hours; the reader defaults it off', () => {
  const noon = new Date('2026-09-05T12:00:00');
  const prefs = readPushPrefs({ quietFrom: '23:00', quietTo: '08:00' });
  assert.equal(prefs.held, false);
  assert.equal(heldBack(prefs, noon), false);
  assert.equal(heldBack({ ...prefs, held: true }, noon), true);
  assert.equal(heldBack(readPushPrefs({ held: 'yes' }), noon), false, 'only a real boolean counts');
});

test('a phone with the app on it does not need its browser buzzing too', () => {
  const safari = { endpoint: 'https://web.push.apple.com/a', p256dh: 'k', auth: 's', name: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit', added: '', deviceId: 'web1' };
  const desk = { endpoint: 'https://fcm.googleapis.com/b', p256dh: 'k', auth: 's', name: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome', added: '', deviceId: 'desk1' };
  assert.deepEqual(coveredByNativeApp([safari, desk], true), [safari]);
  assert.deepEqual(coveredByNativeApp([safari, desk], false), [], 'with no Apple token the browser is all the phone has');
  assert.ok(isPhoneWebApp(safari.name));
  assert.ok(!isPhoneWebApp(desk.name));
  assert.deepEqual(withoutDevice([safari, desk], 'web1'), [desk]);
  assert.deepEqual(withoutDevice([safari, desk], undefined), [safari, desk], 'an unknown sign-in removes nothing');
  const read = readPushDevices([{ ...safari }, { endpoint: 'https://x/y', p256dh: 'k', auth: 's', name: 'old' }]);
  assert.equal(read[0].deviceId, 'web1');
  assert.equal(read[1].deviceId, undefined, 'entries from before the field are kept as they were');
});
