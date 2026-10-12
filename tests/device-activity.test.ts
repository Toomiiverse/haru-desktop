import test from 'node:test';
import assert from 'node:assert/strict';
import { readWebAccess, rememberDevice, touchDevice, deviceFor, forgetDevice, forgetEveryDevice } from '../electron/web';

test('activity persists once per minute while device revocation stays immediate', () => {
  const now = new Date('2026-09-30T10:00:00Z'), token = 'fixture-device-token';
  const access = rememberDevice(readWebAccess({}), token, 'fixture', now), id = access.devices[0].id;
  assert.equal(touchDevice(access, id, new Date(+now + 59_999)), access);
  const touched = touchDevice(access, id, new Date(+now + 60_000));
  assert.notEqual(touched, access);
  assert.equal(deviceFor(touched, token, new Date(+now + 60_001))?.id, id);
  const revoked = forgetDevice(touched, id);
  assert.equal(deviceFor(revoked, token, now), null);
  assert.equal(touchDevice(revoked, id, now), revoked, 'activity cannot resurrect a revoked device');
  assert.equal(deviceFor(forgetEveryDevice(touched), token, now), null);
  assert.equal(deviceFor(access, token, new Date(+now + 400 * 86_400_000)), null);
  assert.notEqual(touchDevice(access, id, new Date(+now - 1)), access, 'clock rollback does not prevent future refreshes');
});
