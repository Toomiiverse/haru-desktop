import * as THREE from 'three';
import type { EmotionName } from '../types';

export type EarFeeling = { emotion: EmotionName; strength: number; listening: boolean; sleepiness: number };
// Degrees in the model's forward/up frame: pitch, paired lift, left/right difference.
const POSES: Record<EmotionName, readonly [number, number, number]> = {
  neutral: [0, 0, 0], happy: [5, 11, 2], curious: [8, 8, 12],
  smug: [-4, 5, 9], annoyed: [-25, -28, 3], bored: [-8, -16, 5],
  sleepy: [-12, -24, 2], surprised: [16, 20, 0], affectionate: [4, 6, 4],
  embarrassed: [-14, -18, 7], determined: [10, 13, 0], worried: [-10, -23, 6],
};

export function earTarget(feeling: EarFeeling, side: number, seconds: number): [number, number] {
  if (feeling.listening) return [12, side * 17];
  const strength = THREE.MathUtils.clamp(feeling.strength, 0, 1);
  const pose = POSES[feeling.emotion] ?? POSES.neutral;
  const sleepy = THREE.MathUtils.clamp((feeling.sleepiness - .5) * 2, 0, 1) * (1 - strength);
  const happy = feeling.emotion === 'happy' || feeling.emotion === 'affectionate';
  const flutter = happy ? Math.sin(seconds * 7 + side * .7) * 2 * strength : 0;
  return [pose[0] * strength - 12 * sleepy, side * (pose[1] * strength - 24 * sleepy + flutter) + pose[2] * strength];
}

/** Additive ears: save the sampled idle pose, then restore it before the next mixer tick. */
export class EarAnimator {
  private readonly ears;
  private readonly delta = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'XYZ');
  constructor(nodes: { bone: THREE.Object3D; side: number }[]) {
    this.ears = nodes.map(({ bone, side }) => {
      const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      return { bone, side, parent, inverse: parent.clone().invert(), base: bone.quaternion.clone(), pitch: 0, lift: 0, pitchSpeed: 0, liftSpeed: 0 };
    });
  }
  restore() { for (const ear of this.ears) ear.bone.quaternion.copy(ear.base); }
  update(feeling: EarFeeling, seconds: number, dt: number, reducedMotion: boolean) {
    for (const ear of this.ears) {
      ear.base.copy(ear.bone.quaternion);
      const target = reducedMotion ? [0, 0] : earTarget(feeling, ear.side, seconds);
      // Small stable spring steps give a quick perk and a softer settling motion.
      const steps = Math.max(1, Math.ceil(Math.min(dt, .1) / (1 / 120)));
      const step = Math.min(dt, .1) / steps;
      for (let i = 0; i < steps; i++) {
        const stiffness = feeling.listening ? 150 : 95, damping = feeling.listening ? 19 : 16;
        ear.pitchSpeed += ((target[0] - ear.pitch) * stiffness - ear.pitchSpeed * damping) * step;
        ear.liftSpeed += ((target[1] - ear.lift) * stiffness - ear.liftSpeed * damping) * step;
        ear.pitch += ear.pitchSpeed * step; ear.lift += ear.liftSpeed * step;
      }
      if (reducedMotion) { ear.pitch = 0; ear.lift = 0; ear.pitchSpeed = 0; ear.liftSpeed = 0; }
      this.euler.set(THREE.MathUtils.degToRad(ear.pitch), 0, THREE.MathUtils.degToRad(ear.lift));
      this.delta.setFromEuler(this.euler).premultiply(ear.inverse).multiply(ear.parent);
      ear.bone.quaternion.premultiply(this.delta);
    }
  }
}
