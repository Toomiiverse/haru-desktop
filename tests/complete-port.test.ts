import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { watchDigits, bindWatch } from '../src/companion/watch';
import { WardrobePose } from '../src/companion/wardrobePose';
import { vrmWardrobe } from '../electron/vrmWardrobe';

test('watch rolls date and time over at midnight in local time', () => {
  assert.deepEqual(watchDigits(new Date(2026, 11, 31, 23, 59)), [1, 2, 3, 1, 2, 3, 5, 9]);
  assert.deepEqual(watchDigits(new Date(2027, 0, 1, 0, 0)), [0, 1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(watchDigits(new Date(2028, 1, 29, 9, 7)), [0, 2, 2, 9, 0, 9, 0, 7]);
});
test('watch changes all eight digits and clears the previous numbers', async () => {
  const mesh = new THREE.Mesh(); mesh.morphTargetDictionary = {}; mesh.morphTargetInfluences = Array(80).fill(0);
  for (let p = 1; p <= 8; p++) for (let d = 0; d <= 9; d++) mesh.morphTargetDictionary[`NO${p}_${d}`] = (p - 1) * 10 + d;
  const loaded = { parser: { json: { nodes: [{ name: 'Watch_Dial' }] }, getDependency: async () => mesh } } as unknown as GLTF;
  const watch = await bindWatch(loaded);
  for (const date of [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 0, 0)]) {
    watch!.update(date);
    watchDigits(date).forEach((digit, p) => assert.deepEqual(mesh.morphTargetInfluences!.slice(p * 10, p * 10 + 10), Array.from({ length: 10 }, (_, i) => i === digit ? 1 : 0)));
  }
  assert.equal(await bindWatch({ parser: { json: {} } } as unknown as GLTF), undefined);
});
test('held finger poses do not accumulate and release to the running idle', () => {
  const finger = new THREE.Object3D(), pose = new WardrobePose(new Map([['finger', finger]]));
  const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1);
  for (let i = 0; i < 900; i++) { pose.restore(); finger.rotation.set(0, 0, .1); pose.update({ finger: target.toArray() }, 1 / 30, false); }
  assert.ok(finger.quaternion.angleTo(target) < .00001);
  for (let i = 0; i < 90; i++) { pose.restore(); finger.rotation.set(0, 0, .1); pose.update({}, 1 / 30, false); }
  assert.ok(Math.abs(finger.rotation.z - .1) < .00001);
  pose.restore(); pose.update({ finger: target.toArray() }, 1 / 30, true);
  assert.ok(finger.quaternion.angleTo(target) < .00001);
});
test('wardrobe accepts normalized poses and rejects malformed bone rotations', () => {
  const pack = (q: unknown) => ({ version: 1, controls: [{ id: 'hands', name: 'Hands', kind: 'option', default: 0, options: [{ label: 'Idle' }, { label: 'Open', bones: { leftIndexProximal: q } }] }] });
  assert.equal(vrmWardrobe(pack([0, 0, 0, 1])).length, 1);
  for (const invalid of [[0, 0, 0, 0], [0, 0, 1], [0, 0, 0, Infinity], ['0', 0, 0, 1]]) assert.throws(() => vrmWardrobe(pack(invalid)));
});
