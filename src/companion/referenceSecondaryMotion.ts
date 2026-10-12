import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

type Frame = {weight: number; channels: Record<string, number>};
const clamp = (n: number) => THREE.MathUtils.clamp(n, 0, 1);

/** Follow-through on the existing raw hair and loose-clothing animation. */
export class ReferenceSecondaryMotion {
  private readonly anchors;
  private readonly springs = [
    [0, 2.8], [0, 1.8], [0, 1.15], [1, 2.4], [1, 1.65], [2, 2.1], [2, 1.35],
  ].map(([anchor, frequency]) => ({anchor, omega: frequency * Math.PI * 2, value: new THREE.Vector3(), speed: new THREE.Vector3()}));
  private readonly bones: {bone: THREE.Object3D; name: string; base: THREE.Quaternion; spring: number; kind: string; cap: number; side: number}[] = [];
  private applied = false;

  constructor(vrm: VRM) {
    this.anchors = (['head', 'chest', 'hips'] as const).map(name => ({
      bone: vrm.humanoid.getNormalizedBoneNode(name), position: new THREE.Vector3(), rotation: new THREE.Quaternion(),
      drive: new THREE.Vector3(), facing: new THREE.Quaternion(), ready: false,
    }));
    vrm.scene.traverse(bone => {
      if (!(bone as THREE.Bone).isBone) return;
      const name = typeof bone.userData.name === 'string' ? bone.userData.name : bone.name, side = name.includes('.R') ? -1 : 1;
      let kind = '', spring = 0, cap = 0;
      if (/^HairTail(?:\.[LR])?\.[123]$/.test(name)) {
        const depth = Number(name.at(-1)); kind = 'tail'; spring = depth - 1; cap = depth + 2;
      } else if (/^Hair(?:Front|FrontSide|Side|Top)/.test(name)) {
        kind = 'hair'; spring = /Side/.test(name) ? 1 : 0; cap = /Front(?!Side)|Top/.test(name) ? 2 : 4;
      } else if (/^Jacket(?:Front|Back|Side)\.[LR](?:\.001)?$/.test(name) || name === 'HoodBone') {
        kind = name === 'HoodBone' ? 'back' : name.startsWith('JacketFront') ? 'front' : name.startsWith('JacketBack') ? 'back' : 'side';
        spring = name === 'HoodBone' ? 4 : 3; cap = name.endsWith('.001') ? 1 : name === 'HoodBone' ? 2.5 : 3.5;
      } else if (/^Belt(?:_Close)?\.(?:[LR](?:\.[23])?|4\.[LR])$/.test(name)) {
        kind = name.startsWith('Belt.4') ? 'pocket' : 'cord'; spring = /\.[23]$/.test(name) ? 6 : 5; cap = spring === 6 ? 10 : 8;
      } else if (/^JacketFrontString\.[LR]$/.test(name) || name === 'ZipTab') {
        kind = 'cord'; spring = 4; cap = 8;
      }
      if (kind) this.bones.push({bone, name, base: bone.quaternion.clone(), spring, kind, cap: THREE.MathUtils.degToRad(cap), side});
    });
  }

  restore() {
    if (!this.applied) return;
    for (const {bone, base} of this.bones) bone.quaternion.copy(base);
    this.applied = false;
  }

  /** Run after the native face bindings, which also own the authored hair/cloth tracks. */
  update(frame: Frame, delta: number, reduced: boolean) {
    const weight = reduced ? 0 : clamp(frame.weight) * clamp(frame.channels.secondary || 0);
    const validStep = Number.isFinite(delta) && delta > 0 && delta <= .25;
    for (const anchor of this.anchors) {
      if (!anchor.bone) continue;
      const position = anchor.bone.getWorldPosition(new THREE.Vector3());
      const rotation = anchor.bone.getWorldQuaternion(new THREE.Quaternion());
      anchor.facing.copy(rotation); anchor.drive.set(0, 0, 0);
      if (anchor.ready && validStep) {
        const inverse = rotation.clone().invert();
        const linear = position.clone().sub(anchor.position).multiplyScalar(1 / delta).applyQuaternion(inverse);
        const angular = rotation.clone().multiply(anchor.rotation.clone().invert());
        if (angular.w < 0) angular.set(-angular.x, -angular.y, -angular.z, -angular.w);
        const axis = new THREE.Vector3(angular.x, angular.y, angular.z), sine = axis.length();
        if (sine > 1e-8) axis.multiplyScalar(2 * Math.atan2(sine, angular.w) / (sine * delta));
        axis.applyQuaternion(inverse);
        anchor.drive.set(-linear.y * .35 - linear.z * .45 - axis.x * .08, -axis.y * .085, -linear.x * .65 - axis.z * .08).clampLength(0, .22);
      }
      // Observe disabled frames too, so a new clip never inherits an old position jump.
      anchor.position.copy(position); anchor.rotation.copy(rotation); anchor.ready = true;
      // Desktop-window descent does not move rig coordinates. Supply its upward
      // air flow explicitly so loose hair, jacket panels and laces still trail.
      anchor.drive.x+=.045*clamp(frame.channels.airflow || 0);
    }
    if (!weight || !validStep) {
      this.restore();
      for (const spring of this.springs) {spring.value.set(0, 0, 0); spring.speed.set(0, 0, 0);}
      return;
    }
    const steps = Math.ceil(delta / (1 / 120)), dt = delta / steps;
    for (const spring of this.springs) {
      const target = this.anchors[spring.anchor].drive;
      for (let i = 0; i < steps; i++) {
        const acceleration = target.clone().sub(spring.value).multiplyScalar(spring.omega ** 2).addScaledVector(spring.speed, -2 * .52 * spring.omega);
        spring.speed.addScaledVector(acceleration, dt);
        spring.value.addScaledVector(spring.speed, dt).clampLength(0, .25);
      }
    }
    for (const entry of this.bones) {
      const {bone, base, kind, cap, side} = entry, spring = this.springs[entry.spring];
      base.copy(bone.quaternion);
      const motion = spring.value.clone(), strength = motion.length();
      if (kind === 'hair') {
        motion.x = -Math.abs(motion.x) * .65; motion.y *= .45;
      } else if (kind !== 'tail') {
        // Panels and strings open away from the body; their rebound returns to
        // the authored fit instead of driving the fabric through the torso.
        const lift = Math.abs(motion.x) * .6 + strength * .4;
        if (kind === 'side') motion.set(0, 0, side * lift * .8);
        else if (kind === 'front' || kind === 'back') motion.set((kind === 'front' ? -1 : 1) * lift * (entry.name === 'HoodBone' ? .55 : .8), 0, side * Math.abs(motion.z) * .18);
        else motion.set(-lift, motion.y * .4, kind === 'pocket' ? side * (strength * .5 + Math.abs(motion.z) * .3) : motion.z);
      }
      const contactGain = kind === 'hair' && /^HairFront(?:$|\.R)|^HairFrontSide\.R/.test(entry.name) ? 1 - .8 * clamp(frame.channels.rightContact || 0) : 1;
      motion.clampLength(0, cap).multiplyScalar(weight * contactGain);
      const angle = motion.length();
      if (!angle || !bone.parent) continue;
      // The source left/right joints use different bases. Express the same
      // head/chest/hip-frame rotation in each joint's current parent frame.
      motion.multiplyScalar(1 / angle).applyQuaternion(this.anchors[spring.anchor].facing)
        .applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(motion, angle)).normalize();
      bone.updateWorldMatrix(false, true);
    }
    this.applied = true;
  }
}
