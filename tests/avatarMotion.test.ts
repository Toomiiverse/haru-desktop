import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleMotion, settleSpring } from '../src/companion/idle';

test('hair follows a moving head, then settles consistently at different frame rates', () => {
  const trajectories = [30, 60, 144].map(fps => {
    let value = 0, speed = 0;
    const samples: number[] = [];
    for (let i = 1; i <= fps * 3; i++) {
      [value, speed] = settleSpring(value, speed, i <= fps ? 3 : 0, 95, 14, 1 / fps);
      assert.ok(Number.isFinite(value) && Math.abs(value) < 3.2);
      if (i % (fps / 2) === 0) samples.push(value);
    }
    assert.ok(samples[0] > 2.8, 'tuft follows the head');
    assert.ok(Math.abs(value) < .001 && Math.abs(speed) < .01, 'tuft returns to rest');
    return samples;
  });
  for (const samples of trajectories) samples.forEach((value, i) => assert.ok(Math.abs(value - trajectories[0][i]) < .04));
});

test('invalid or suspended frames cannot kick a strand out of place', () => {
  for (const dt of [0, -1, NaN, Infinity, 3]) assert.deepEqual(settleSpring(2, 15, -4, 95, 14, dt), [2, 0]);
});

test('fringe and tuft have different inertia, and a held tilt retains gravity', () => {
  const fringe = settleSpring(0, 0, 2, 210, 22, 1 / 30);
  const tuft = settleSpring(0, 0, 2, 95, 14, 1 / 30);
  assert.ok(fringe[0] > tuft[0], 'fringe catches up sooner');
  let value = 0, speed = 0;
  for (let i = 0; i < 120; i++) [value, speed] = settleSpring(value, speed, -.6, 95, 14, 1 / 60);
  assert.ok(Math.abs(value + .6) < .001, 'hair rests toward gravity during a held tilt');
});

test('idle channels stay subtle and do not repeat with the former 3.8-second loop', () => {
  const vitals = { energy: .55, sleepiness: .1, stress: 0 };
  let difference = 0;
  for (let t = 0; t < 60000; t += 50) {
    const a = idleMotion(t, vitals), b = idleMotion(t + 3800, vitals);
    assert.ok(a.breath >= 0 && a.breath <= 1 && Math.abs(a.driftX) < .01 && Math.abs(a.headZ) < 2.5);
    difference += Math.abs(a.headZ - b.headZ);
  }
  assert.ok(difference > 100);
});
