import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EarAnimator, earTarget, type EarFeeling } from '../src/companion/ears';

test('listening overrides emotion, fades back without accumulating and respects reduced motion', () => {
  const head = new THREE.Object3D(); const bone = new THREE.Bone(); head.add(bone);
  bone.rotation.set(.2, -.4, .1); head.updateMatrixWorld(true);
  const rest = bone.quaternion.clone(); const animator = new EarAnimator([{ bone, side: 1 }]);
  const neutral: EarFeeling = { emotion: 'neutral', strength: 0, listening: false, sleepiness: 0 };
  const listening = { ...neutral, emotion: 'worried' as const, strength: 1, listening: true };
  assert.deepEqual(earTarget(listening, 1, 0), earTarget({ ...listening, emotion: 'happy' }, 1, 0));
  for (let i = 0; i < 240; i++) { animator.restore(); animator.update(listening, i / 30, 1 / 30, false); }
  const held = bone.quaternion.clone(); assert.ok(rest.angleTo(held) > .25);
  for (let i = 0; i < 600; i++) { animator.restore(); animator.update(listening, i / 30, 1 / 30, false); }
  assert.ok(held.angleTo(bone.quaternion) < 1e-6, 'held pose must not accumulate rotation');
  for (let i = 0; i < 240; i++) { animator.restore(); animator.update(neutral, i / 30, 1 / 30, false); }
  assert.ok(rest.angleTo(bone.quaternion) < 1e-6, 'returns to the original idle pose');
  animator.restore(); animator.update(listening, 0, 1 / 30, true); assert.ok(rest.angleTo(bone.quaternion) < 1e-6);
  const worried = earTarget({ ...neutral, emotion: 'worried', strength: 1 }, 1, 0);
  assert.ok(worried[1] < 0);
  assert.ok(earTarget({ ...neutral, sleepiness: 1 }, 1, 0)[1] < 0);
  new EarAnimator([]).update(listening, 0, 1 / 30, false);
});
