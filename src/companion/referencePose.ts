import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { reachBones } from './perchPose';

type Frame = { weight: number; channels: Record<string, number> };
type HandOption = {label: string; bones?: Record<string, readonly number[]>};
const clamp = (n: number) => THREE.MathUtils.clamp(n, 0, 1);

/** A reversible layer above sitting and below the VRM's normal spring/cloth update. */
export class ReferencePose {
  armWeight = 0;
  private applied = false;
  private readonly bones = new Map<string, { bone: THREE.Object3D; base: THREE.Quaternion }>();
  private readonly hips;
  private readonly head;
  private readonly torsoRest = new Map<string, THREE.Quaternion>();
  private readonly hipPosition = new THREE.Vector3();
  private readonly unit: number;
  private readonly palms = new Map<string, THREE.Quaternion>();
  private readonly thumbs = new Map<string, THREE.Quaternion>();
  private readonly cuffs: {mesh: THREE.Mesh; index: number; side: 'left' | 'right'}[] = [];
  private readonly cuffWeight = {left: 0, right: 0};
  private readonly handPoses = new Map<string, Record<string, readonly number[]>>();

  constructor(vrm: VRM, hands: readonly HandOption[] = []) {
    for (const option of hands) if (option.bones) this.handPoses.set(option.label, option.bones);
    vrm.scene?.traverse(node => {
      const mesh = node as THREE.Mesh;
      for (const [side, suffix] of [['left', 'L'], ['right', 'R']] as const) {
        const index = mesh.morphTargetDictionary?.['Haru_GestureCuff_' + suffix];
        if (index !== undefined && mesh.morphTargetInfluences) this.cuffs.push({mesh, index, side});
      }
    });
    const names = ['hips', 'spine', 'chest', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
    for (const side of ['left', 'right']) {
      names.push(...['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'].map(n => side + n));
      for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
        names.push(...['Proximal', 'Intermediate', 'Distal'].map(n => side + finger + n));
      }
    }
    for (const name of names) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      if (bone) this.bones.set(name, { bone, base: bone.quaternion.clone() });
    }
    this.hips = this.bone('hips');
    this.head = vrm.humanoid.getNormalizedBoneNode('head');
    for (const name of ['spine', 'chest']) {
      const bone = this.bone(name); if (bone) this.torsoRest.set(name, bone.quaternion.clone());
    }
    this.unit = (this.bone('leftLowerLeg')?.position.length() || .4) + (this.bone('leftFoot')?.position.length() || .4);
    for (const side of ['left', 'right']) {
      const hand = this.bone(side + 'Hand'), middle = this.bone(side + 'MiddleProximal');
      const index = this.bone(side + 'IndexProximal'), little = this.bone(side + 'LittleProximal');
      if (!hand || !middle || !index || !little) continue;
      hand.updateWorldMatrix(true, true);
      const local = (b: THREE.Object3D) => hand.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
      const fingers = local(middle).normalize();
      const across = local(index).sub(local(little)).normalize();
      const palm = fingers.clone().cross(across).multiplyScalar(side === 'left' ? 1 : -1).normalize();
      const right = fingers.clone().cross(palm).normalize();
      palm.copy(right).cross(fingers).normalize();
      // A normalized palm basis avoids assuming the source avatar's hand-axis convention.
      this.palms.set(side, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, fingers, palm)).invert());
      const thumbBase = this.bone(side + 'ThumbMetacarpal'), thumbTip = this.bone(side + 'ThumbDistal');
      if (thumbBase && thumbTip) {
        // Calibrate the upward thumb direction using the imported thumb articulation.
        // Constructor sampling must leave the initial rig exactly as it was.
        const thumbPose = this.handPoses.get('Thumbs up');
        const saved = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'].flatMap(name => {
          const bone = this.bone(side + name), q = thumbPose?.[side + name];
          if (!bone || !q) return [];
          const before = bone.quaternion.clone(); bone.quaternion.fromArray(q);
          return [{bone, before}];
        });
        hand.updateWorldMatrix(true, true);
        const thumb = local(thumbTip).sub(local(thumbBase)).normalize();
        const thumbRight = thumb.clone().cross(palm).normalize();
        const thumbPalm = thumbRight.clone().cross(thumb).normalize();
        this.thumbs.set(side, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(thumbRight, thumb, thumbPalm)).invert());
        for (const {bone, before} of saved) bone.quaternion.copy(before);
        hand.updateWorldMatrix(true, true);
      }
    }
  }

  private bone(name: string) { return this.bones.get(name)?.bone; }

  restore() {
    this.cuffWeight.left = this.cuffWeight.right = 0;
    this.applyClothing();
    if (!this.applied) return;
    for (const { bone, base } of this.bones.values()) bone.quaternion.copy(base);
    this.hips?.position.copy(this.hipPosition);
    this.applied = false;
  }

  update(frame: Frame, seated: boolean, airborne: boolean, reduced: boolean, body: Frame = frame) {
    this.armWeight = 0;
    this.cuffWeight.left = this.cuffWeight.right = 0;
    if (!this.hips || reduced || (frame.weight <= 0 && body.weight <= 0)) return;
    const c = frame.channels, weight = clamp(frame.weight);
    const b = body.channels, bodyWeight = clamp(body.weight);
    for (const { bone, base } of this.bones.values()) base.copy(bone.quaternion);
    this.hipPosition.copy(this.hips.position);
    this.applied = true;
    const rotate = (name: string, x: number, y = 0, z = 0, amount = weight, additive = false) => {
      const bone = this.bone(name); if (!bone || amount <= 0) return;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
      if (additive) bone.quaternion.multiply(new THREE.Quaternion().slerp(q, amount));
      else bone.quaternion.slerp(q, amount);
    };
    for (const [name, rest] of this.torsoRest) this.bone(name)?.quaternion.slerp(rest, bodyWeight * clamp(b.stillness || 0));
    rotate('spine', b.lean || 0, b.turn || 0, b.sway || 0, bodyWeight, true);
    rotate('chest', b.chestLean || 0, b.chestTurn || 0, b.chestSway || 0, bodyWeight, true);
    // Move the clavicles before arm reach so the shoulders lead the gesture
    // while its head-relative wrist target stays in place.
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? 1 : -1;
      rotate(side + 'Shoulder', 0, -sign * (b[side + 'ShoulderForward'] || 0), sign * (b[side + 'ShoulderLift'] || 0), bodyWeight, true);
    }

    const gait = !seated && !airborne ? clamp(c.gait || 0) * weight : 0;
    if (gait) {
      const feet = [this.bone('leftFoot'), this.bone('rightFoot')].filter((b): b is THREE.Object3D => !!b);
      this.hips.updateWorldMatrix(true, true);
      const floor = Math.min(...feet.map(b => b.getWorldPosition(new THREE.Vector3()).y));
      const phase = c.stride || 0;
      for (const side of ['left', 'right']) {
        const p = phase + (side === 'right' ? Math.PI : 0);
        const upper = -.42 * Math.sin(p), knee = .80 * Math.max(0, Math.cos(p));
        rotate(side + 'UpperLeg', upper, 0, side === 'left' ? .025 : -.025, gait);
        rotate(side + 'LowerLeg', knee, 0, 0, gait);
        rotate(side + 'Foot', -upper - knee, 0, 0, gait);
        if (!(c[side + 'Arm'] > 0)) {
          const sign = side === 'left' ? 1 : -1;
          rotate(side + 'UpperArm', .16 * Math.sin(p), 0, -sign * 1.28, gait);
          rotate(side + 'LowerArm', -.10, 0, 0, gait);
        }
      }
      // Correct the hip height from the solved leg flex so the lowest flat foot stays planted.
      // This changes the avatar skeleton only, never the native desktop window.
      this.hips.updateWorldMatrix(true, true);
      const posedFloor = Math.min(...feet.map(b => b.getWorldPosition(new THREE.Vector3()).y));
      if (Number.isFinite(floor) && Number.isFinite(posedFloor)) {
        const world = this.hips.getWorldPosition(new THREE.Vector3());
        world.y += floor - posedFloor;
        world.y += this.unit * .025 * clamp(c.bounce || 0) * gait * Math.sin(phase * 2) ** 2;
        this.hips.position.copy(this.hips.parent ? this.hips.parent.worldToLocal(world) : world);
      }
      rotate('spine', 0, -.028 * Math.sin(phase), .020 * Math.sin(phase), gait, true);
    }

    if (!seated && !airborne && ['weightX', 'weightY', 'weightZ', 'hipPitch', 'hipYaw', 'hipRoll'].some(name => b[name])) {
      this.hips.updateWorldMatrix(true, true);
      const facing = this.hips.getWorldQuaternion(new THREE.Quaternion());
      const feet = (['left', 'right'] as const).flatMap(side => {
        const upper = this.bone(side + 'UpperLeg'), lower = this.bone(side + 'LowerLeg'), foot = this.bone(side + 'Foot');
        if (!upper || !lower || !foot) return [];
        const position = foot.getWorldPosition(new THREE.Vector3());
        const origin = upper.getWorldPosition(new THREE.Vector3()), knee = lower.getWorldPosition(new THREE.Vector3());
        const length = origin.distanceTo(knee) + knee.distanceTo(position);
        const direction = position.clone().sub(origin).normalize();
        const bend = knee.clone().sub(origin); bend.addScaledVector(direction, -bend.dot(direction));
        // Keep the native knee plane at entry/release; imposing a new pole can
        // snap a slightly bent idle leg even while its sole stays in place.
        if (bend.lengthSq() < 1e-12) bend.set(side === 'left' ? .06 : -.06, 0, .50).applyQuaternion(facing);
        const pole = knee.clone().addScaledVector(bend.normalize(), this.unit * .5);
        return [{upper, lower, foot, position, orientation: foot.getWorldQuaternion(new THREE.Quaternion()), length, pole}];
      });
      if (feet.length === 2) {
        const world = this.hips.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(b.weightX || 0, b.weightY || 0, b.weightZ || 0).multiplyScalar(this.unit * bodyWeight).applyQuaternion(facing));
        this.hips.position.copy(this.hips.parent ? this.hips.parent.worldToLocal(world) : world);
        rotate('hips', b.hipPitch || 0, b.hipYaw || 0, b.hipRoll || 0, bodyWeight, true);
        this.hips.updateWorldMatrix(true, true);
        // A straight stance needs only its geometric reach correction, not the
        // arm solver's fixed bend margin. This keeps tiny entry weights smooth.
        const maxReach = 1 - 1e-7;
        let drop = 0;
        for (const foot of feet) {
          const upper = foot.upper.getWorldPosition(new THREE.Vector3());
          const horizontal = (upper.x - foot.position.x) ** 2 + (upper.z - foot.position.z) ** 2;
          const height = Math.sqrt(Math.max(0, (foot.length * maxReach) ** 2 - horizontal));
          drop = Math.max(drop, upper.y - foot.position.y - height);
        }
        if (drop > 0) {
          const lowered = this.hips.getWorldPosition(new THREE.Vector3()); lowered.y -= drop;
          this.hips.position.copy(this.hips.parent ? this.hips.parent.worldToLocal(lowered) : lowered);
          this.hips.updateWorldMatrix(true, true);
        }
        for (const foot of feet) {
          // Pelvis motion is weighted already; a second IK fade would slide the soles.
          reachBones(foot.upper, foot.lower, foot.foot, foot.position, foot.pole, 1, maxReach);
          if (foot.foot.parent) foot.orientation.premultiply(foot.foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
          foot.foot.quaternion.copy(foot.orientation);
          foot.foot.updateWorldMatrix(false, true);
        }
      }
    }

    this.hips.updateWorldMatrix(true, true);
    const origin = this.hips.getWorldPosition(new THREE.Vector3());
    const facing = this.hips.getWorldQuaternion(new THREE.Quaternion());
    const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).multiplyScalar(this.unit).applyQuaternion(facing).add(origin);
    for (const side of ['left', 'right'] as const) {
      const amount = clamp(c[side + 'Arm'] || 0) * weight;
      this.armWeight = Math.max(this.armWeight, amount);
      if (!amount) continue;
      const sign = side === 'left' ? 1 : -1;
      const target = point(c[side + 'X'] ?? sign * .35, c[side + 'Y'] ?? .4, c[side + 'Z'] ?? .25);
      const contact = this.head ? clamp(c[side + 'Contact'] || 0) : 0;
      const headFacing = this.head?.getWorldQuaternion(new THREE.Quaternion());
      if (contact && this.head && headFacing) {
        const touch = new THREE.Vector3(c[side + 'ContactX'] ?? sign * .13, c[side + 'ContactY'] ?? 0, c[side + 'ContactZ'] ?? .15)
          .multiplyScalar(this.unit).applyQuaternion(headFacing).add(this.head.getWorldPosition(new THREE.Vector3()));
        target.lerp(touch, contact);
      }
      // Outward, slightly forward elbows keep large sleeves clear of the torso.
      const pole = point(c[side + 'PoleX'] ?? sign * .70, c[side + 'PoleY'] ?? .28, c[side + 'PoleZ'] ?? .22);
      reachBones(this.bone(side + 'UpperArm'), this.bone(side + 'LowerArm'), this.bone(side + 'Hand'), target, pole, amount);
      const hand = this.bone(side + 'Hand'), basis = this.palms.get(side);
      const curl = clamp(c[side + 'Curl'] || 0), peace = clamp(c[side + 'Peace'] || 0), thumb = clamp(c[side + 'Thumb'] || 0), pointing = clamp(c[side + 'Point'] || 0);
      const raised = Math.max(contact, clamp(((c[side + 'Y'] ?? .4) - .27) / .10));
      this.cuffWeight[side] = amount * raised * Math.max(.75 + curl * .20, peace, thumb, pointing);
      if (hand?.parent && basis) {
        const palm = basis.clone().slerp(this.thumbs.get(side) || basis, thumb);
        const world = facing.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
          c[side + 'WristX'] || 0, c[side + 'WristY'] || 0, c[side + 'WristZ'] || 0,
        ))).multiply(palm);
        if (contact && headFacing) world.slerp(headFacing.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
          c[side + 'ContactWristX'] ?? 0, c[side + 'ContactWristY'] ?? Math.PI, c[side + 'ContactWristZ'] ?? .6,
        ))).multiply(palm), contact);
        world.premultiply(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        hand.quaternion.slerp(world, amount);
      }
      const open = this.handPoses.get('Open hands'), fists = this.handPoses.get('Fists');
      if (open && fists) {
        // Use the avatar's authored knuckle/thumb poses instead of approximating its anatomy.
        for (const [name, {bone}] of this.bones) {
          if (!name.startsWith(side) || !/(Metacarpal|Proximal|Intermediate|Distal)$/.test(name) || !open[name] || !fists[name]) continue;
          const finger = name.slice(side.length).replace(/(Metacarpal|Proximal|Intermediate|Distal)$/, '');
          const fingerCurl = clamp(c[side + finger + 'Curl'] ?? curl);
          const target = new THREE.Quaternion().fromArray(open[name]).slerp(new THREE.Quaternion().fromArray(fists[name]), fingerCurl);
          for (const [label, mix] of [['Peace', peace], ['Point', pointing], ['Thumbs up', thumb]] as const) {
            const q = this.handPoses.get(label)?.[name];
            if (mix && q) target.slerp(new THREE.Quaternion().fromArray(q), mix);
          }
          if (name.endsWith('Proximal') && !name.includes('Thumb')) {
            // The imported fist leaves its first knuckles raised; close that remaining
            // gap on Wolfram's gloves, while preserving the straight pointing fingers.
            let closed = clamp((fingerCurl - .65) / .25);
            closed = THREE.MathUtils.lerp(closed, /Ring|Little/.test(name) ? 1 : 0, peace);
            closed = THREE.MathUtils.lerp(closed, name.includes('Index') ? 0 : 1, pointing);
            closed = THREE.MathUtils.lerp(closed, 1, thumb);
            target.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sign * .65 * closed));
            const fan = {Index: -.18, Middle: -.04, Ring: .07, Little: .20}[finger as 'Index' | 'Middle' | 'Ring' | 'Little'] ?? 0;
            const splay = c[side + finger + 'Splay'] ?? (c[side + 'Splay'] || 0) * fan;
            target.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sign * splay));
          }
          bone.quaternion.slerp(target, amount);
        }
        continue;
      }
      for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
        const folded = finger === 'Ring' || finger === 'Little';
        const fingerCurl = clamp(c[side + finger + 'Curl'] ?? curl);
        const bend = THREE.MathUtils.lerp(THREE.MathUtils.lerp(fingerCurl, folded ? .95 : 0, peace) * (1 - thumb) + thumb * .95, finger === 'Index' ? 0 : .95, pointing);
        for (const [joint, factor] of [['Proximal', 1], ['Intermediate', 1.25], ['Distal', .6]] as const) {
          const fan = {Index: -.18, Middle: -.04, Ring: .07, Little: .20}[finger as 'Index' | 'Middle' | 'Ring' | 'Little'];
          const spread = joint === 'Proximal' ? (!folded ? (finger === 'Index' ? -.16 : .10) * peace : 0) + (c[side + finger + 'Splay'] ?? (c[side + 'Splay'] || 0) * fan) : 0;
          rotate(side + finger + joint, 0, spread * sign, -sign * bend * factor, amount);
        }
      }
      // Curl the thumb across a loose fist; thumbs-up leaves its full chain extended.
      rotate(side + 'ThumbMetacarpal', 0, sign * (.35 * Math.max(curl, peace, pointing) * (1 - thumb)), -sign * .30 * Math.max(curl, peace, pointing) * (1 - thumb), amount);
      rotate(side + 'ThumbProximal', 0, 0, -sign * .45 * Math.max(curl, peace, pointing) * (1 - thumb), amount);
      rotate(side + 'ThumbDistal', 0, 0, -sign * .35 * Math.max(curl, peace, pointing) * (1 - thumb), amount);
    }
    this.hips.updateWorldMatrix(true, true);
  }

  /** Run after wardrobe and seated sleeve corrections so idle morph sampling cannot erase it. */
  applyClothing() {
    for (const {mesh, index, side} of this.cuffs) mesh.morphTargetInfluences![index] = this.cuffWeight[side];
  }
}
