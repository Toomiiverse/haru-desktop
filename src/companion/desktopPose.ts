import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { DesktopScene } from '../../electron/desktopAwareness';
import { reachBones } from './perchPose';

const smooth = (value: number) => {const t = THREE.MathUtils.clamp(value, 0, 1); return t*t*(3-2*t);};

export function desktopGaze(desktop: DesktopScene | null | undefined, gaze: {x:number;y:number}, available: boolean) {
  if (!available || !desktop?.focus || desktop.avatar.width <= 0 || desktop.avatar.height <= 0) return gaze;
  const {avatar, focus} = desktop;
  const x = THREE.MathUtils.clamp((focus.x-avatar.x-avatar.width*.5)/(avatar.width*.65), -1, 1);
  const y = THREE.MathUtils.clamp((avatar.y+avatar.height*.30-focus.y)/(avatar.height*.65), -1, 1);
  return Number.isFinite(x+y) ? {x: THREE.MathUtils.lerp(gaze.x, x, .38), y: THREE.MathUtils.lerp(gaze.y, y, .38)} : gaze;
}

/** Locomotion follows native walking state; window peeks share the same reversible rig layer. */
export class DesktopPose {
  walkWeight = 0;
  peekWeight = 0;
  peekEdge: 'left' | 'right' | 'top' = 'left';
  private phase = 0;
  private yaw = 0;
  private applied = false;
  private readonly bones = new Map<string, {bone: THREE.Object3D; rotation: THREE.Quaternion}>();
  private readonly hips;
  private readonly hipPosition = new THREE.Vector3();
  private readonly restHip;
  private readonly center;
  private readonly unit: number;
  private readonly feet = new Map<string, {position: THREE.Vector3; rotation: THREE.Quaternion}>();

  constructor(vrm: VRM) {
    const names = ['hips', 'spine', 'chest', 'neck', 'head'];
    for (const side of ['left', 'right']) names.push(...['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map(name => side+name));
    for (const name of names) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      if (bone) this.bones.set(name, {bone, rotation: bone.quaternion.clone()});
    }
    this.hips = this.bone('hips')!;
    this.restHip = this.hips.position.clone(); this.center = this.hips.getWorldPosition(new THREE.Vector3());
    this.unit = (this.bone('leftLowerLeg')?.position.length() || .4)+(this.bone('leftFoot')?.position.length() || .4);
    for (const side of ['left', 'right']) {
      const foot = this.bone(side+'Foot');
      if (foot) this.feet.set(side, {position: foot.getWorldPosition(new THREE.Vector3()), rotation: foot.getWorldQuaternion(new THREE.Quaternion())});
    }
  }

  get activity() {return Math.max(this.walkWeight, this.peekWeight);}
  private bone(name: string) {return this.bones.get(name)?.bone;}

  restore() {
    if (!this.applied) return;
    for (const {bone, rotation} of this.bones.values()) bone.quaternion.copy(rotation);
    this.hips.position.copy(this.hipPosition); this.applied = false;
  }

  update(walking: number, desktop: DesktopScene | null | undefined, blocked: boolean, delta: number, now: number, reduced: boolean, walkSpeed?: number) {
    if (blocked || reduced || !Number.isFinite(delta) || delta <= 0 || delta > .1) {
      this.walkWeight = this.peekWeight = this.yaw = 0;
      return;
    }
    const peek = desktop?.peek;
    const peekTarget = peek ? smooth((now-peek.started)/550)*smooth((peek.started+peek.duration-now)/650) : 0;
    if (peekTarget > 0 && peek) this.peekEdge = peek.edge;
    const direction = Number.isFinite(walking) ? Math.sign(walking) : 0;
    this.walkWeight = THREE.MathUtils.damp(this.walkWeight, direction && !peekTarget ? 1 : 0, 9, delta);
    this.peekWeight = THREE.MathUtils.damp(this.peekWeight, peekTarget, 10, delta);
    this.yaw = THREE.MathUtils.damp(this.yaw, direction && !peekTarget ? direction*1.1 : 0, 7, delta);
    if (this.walkWeight < .001) this.walkWeight = 0;
    if (this.peekWeight < .001) this.peekWeight = 0;
    if (!this.activity) {this.yaw = 0; return;}
    // Each cycle covers two stance strides; compensate for the projected yaw.
    // The caller converts native DIP/s through the current camera scale.
    const cadence = Number.isFinite(walkSpeed) ? THREE.MathUtils.clamp(walkSpeed!/(this.unit*.64*Math.sin(1.1)), .18, 2.4) : .95;
    this.phase += delta*Math.PI*2*cadence*this.walkWeight;
    const walk = this.walkWeight, peekAmount = this.peekWeight, unit = this.unit;
    for (const {bone, rotation} of this.bones.values()) rotation.copy(bone.quaternion);
    this.hipPosition.copy(this.hips.position); this.applied = true;
    const sampledFeet = new Map([...this.feet].map(([side]) => {
      const foot = this.bone(side+'Foot')!, upper = this.bone(side+'UpperLeg')!, lower = this.bone(side+'LowerLeg')!;
      const position = foot.getWorldPosition(new THREE.Vector3()), shoulder = upper.getWorldPosition(new THREE.Vector3()), knee = lower.getWorldPosition(new THREE.Vector3());
      const axis = position.clone().sub(shoulder).normalize(), bend = knee.clone().sub(shoulder);
      bend.addScaledVector(axis, -bend.dot(axis));
      if (bend.lengthSq() < 1e-10) bend.set(side === 'left' ? .05 : -.05, 0, 1);
      return [side, {position, rotation: foot.getWorldQuaternion(new THREE.Quaternion()), pole: knee.addScaledVector(bend.normalize(), unit*.5)}] as const;
    }));
    const pose = (name: string, x: number, y: number, z: number, amount: number) => {
      this.bone(name)?.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)), amount);
    };
    const offset = (name: string, x: number, y: number, z: number, amount: number) => {
      this.bone(name)?.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x*amount, y*amount, z*amount)));
    };
    const sway = Math.sin(this.phase), bob = 1-Math.cos(this.phase*2), side = this.peekEdge === 'left' ? -1 : 1;
    const curious = Math.sin(now/1000*2.4), top = this.peekEdge === 'top';
    this.hips.position.y = THREE.MathUtils.lerp(this.hipPosition.y, this.restHip.y-unit*(.025+.012*bob), walk);
    this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, this.restHip.y-unit*(top ? .025+.012*(1-curious) : .014), peekAmount);
    this.hips.position.x += unit*((top ? 0 : side*.018)*peekAmount+.018*sway*walk);
    pose('hips', 0, this.yaw, -.028*sway, walk);
    pose('spine', .07, -this.yaw*.08, .05*sway, walk);
    pose('chest', -.025, -.06*Math.sin(this.phase+.3), -.035*sway, walk);
    offset('head', -.025, -this.yaw*.45, .012*sway, walk);
    offset('spine', top ? .045 : -.025, 0, top ? 0 : -side*.18, peekAmount);
    offset('chest', -.03+.012*curious, 0, top ? .025*curious : -side*.07, peekAmount);
    offset('head', -.045+.025*curious, top ? .07*Math.sin(now/1000*1.6) : -side*.13, top ? -.02*curious : side*.09, peekAmount);
    this.hips.updateWorldMatrix(true, true);
    const origin = this.hips.getWorldPosition(new THREE.Vector3()), facing = this.hips.getWorldQuaternion(new THREE.Quaternion());
    const point = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z).multiplyScalar(unit).applyQuaternion(facing).add(origin);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
    for (const [name, sign] of [['left',1],['right',-1]] as const) {
      const phase = this.phase+(name === 'right' ? Math.PI : 0), stride = Math.cos(phase);
      pose(name+'Shoulder', 0, -sign*.055*stride, sign*.025*sway, walk);
      const upper = this.bone(name+'UpperArm'), shoulder = upper?.getWorldPosition(new THREE.Vector3()) || point(sign*.24,.58,0);
      const hand = point(sign*.36,-.10,.16-.18*stride);
      hand.lerp(point(sign*(top ? .39 : .38),top ? .65 : .43,.30), peekAmount);
      // Keep sleeves alongside the chest during a turn or a peek.
      const clearance = hand.clone().sub(shoulder).applyQuaternion(facing.clone().invert());
      clearance.x = sign*Math.max(sign*clearance.x, unit*.17);
      clearance.z = Math.max(clearance.z, unit*(peekAmount > .1 ? .24 : .035));
      hand.copy(clearance.applyQuaternion(facing).add(shoulder));
      const pole = shoulder.clone().lerp(hand,.5).add(new THREE.Vector3(sign*.48,-.10,.04).multiplyScalar(unit).applyQuaternion(facing));
      reachBones(upper, this.bone(name+'LowerArm'), this.bone(name+'Hand'), hand, pole, this.activity);
      const wrist = this.bone(name+'Hand');
      if (wrist?.parent) {
        const rotation = facing.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.10,-sign*.8,sign*.12)));
        rotation.premultiply(wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert()); wrist.quaternion.slerp(rotation,this.activity);
      }
      const rest = this.feet.get(name), sample = sampledFeet.get(name);
      if (!rest || !sample) continue;
      const goal = rest.position.clone().sub(this.center).applyQuaternion(turn).add(this.center);
      goal.add(new THREE.Vector3(0,unit*.075*Math.max(0,-Math.sin(phase))**2,unit*.16*stride).applyQuaternion(turn));
      sample.position.lerp(goal,walk).lerp(rest.position,peekAmount);
      const rotation = turn.clone().multiply(rest.rotation);
      sample.rotation.slerp(rotation,walk).slerp(rest.rotation,peekAmount);
      sample.pole.lerp(point(sign*.18,-.28,.65),this.activity);
      reachBones(this.bone(name+'UpperLeg'),this.bone(name+'LowerLeg'),this.bone(name+'Foot'),sample.position,sample.pole,1,.9999999);
      const foot = this.bone(name+'Foot');
      if (foot?.parent) foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(sample.rotation));
    }
  }
}
