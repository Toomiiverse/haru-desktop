import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { JumpFrame } from '../../electron/perching';

const smooth=(v:number)=>{const t=THREE.MathUtils.clamp(v,0,1);return t*t*(3-2*t);};

/** Two-bone reach shared by seated and reference gestures, preserving limb lengths. */
export function reachBones(upper:THREE.Object3D|undefined, lower:THREE.Object3D|undefined, end:THREE.Object3D|undefined, target:THREE.Vector3, pole:THREE.Vector3, weight:number, maxReach=.985) {
  if(weight<=0)return;
    if(!upper || !lower || !end)return;
    upper.updateWorldMatrix(true,true);
    const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=end.getWorldPosition(new THREE.Vector3());
    const first=a.distanceTo(b),second=b.distanceTo(c);if(first<.001 || second<.001)return;
    // Keep a small elbow bend at full reach so crossing the reach limit cannot snap it straight.
    const direction=target.clone().sub(a),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(first-second)+.0001,(first+second)*maxReach);direction.normalize();
    const bend=pole.clone().sub(a);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const along=(first*first+distance*distance-second*second)/(2*distance);
    const elbow=a.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,first*first-along*along)));
    const upperBase=upper.quaternion.clone(),lowerBase=lower.quaternion.clone();
    const aim=(bone:THREE.Object3D,from:THREE.Vector3,to:THREE.Vector3)=>{
      const world=bone.getWorldQuaternion(new THREE.Quaternion());
      world.premultiply(new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize()));
      if(bone.parent)world.premultiply(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.copy(world);bone.updateWorldMatrix(false,true);
    };
    aim(upper,b.sub(a),elbow.clone().sub(a));
    const joint=lower.getWorldPosition(new THREE.Vector3());
    aim(lower,end.getWorldPosition(c).sub(joint),a.addScaledVector(direction,distance).sub(joint));
    upper.quaternion.slerp(upperBase,1-weight);
    lower.quaternion.slerp(lowerBase,1-weight);
    upper.updateWorldMatrix(false,true);
}

/** Restore the sampled idle before each mixer update; never accumulate bone offsets. */
export class PerchPose {
  private readonly hips;
  private readonly spine;
  private readonly spinePosition = new THREE.Vector3();
  private readonly rawSpine;
  private readonly rawSpinePosition = new THREE.Vector3();
  private rawSpineApplied = false;
  private compression = 0;
  private readonly bones;
  private readonly hipPosition = new THREE.Vector3();
  private readonly restHipPosition = new THREE.Vector3();
  private readonly thigh: number;
  private readonly shin: number;
  private amount = 0;
  private jumping = false;
  private time = 0;
  private seatedTime = 0;
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  constructor(vrm: VRM) {
    this.hips=vrm.humanoid.getNormalizedBoneNode('hips')!;
    this.spine=vrm.humanoid.getNormalizedBoneNode('spine');
    this.rawSpine=vrm.humanoid.getRawBoneNode?.('spine');
    if(this.spine)this.spinePosition.copy(this.spine.position);
    this.restHipPosition.copy(this.hips.position);this.hipPosition.copy(this.hips.position);
    this.thigh=vrm.humanoid.getNormalizedBoneNode('leftLowerLeg')?.position.length() || this.restHipPosition.y*.45;
    this.shin=vrm.humanoid.getNormalizedBoneNode('leftFoot')?.position.length() || this.restHipPosition.y*.45;
    this.bones=(['hips','spine','chest','head','leftShoulder','rightShoulder','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand',
      'leftIndexProximal','leftIndexIntermediate','leftMiddleProximal','leftMiddleIntermediate','leftRingProximal','leftRingIntermediate','leftLittleProximal','leftLittleIntermediate',
      'rightIndexProximal','rightIndexIntermediate','rightMiddleProximal','rightMiddleIntermediate','rightRingProximal','rightRingIntermediate','rightLittleProximal','rightLittleIntermediate'] as const).flatMap(name=>{
      const bone=vrm.humanoid.getNormalizedBoneNode(name);
      return bone?[{name,bone,base:bone.quaternion.clone()}]:[];
    });
  }
  private reach(upperName:string,lowerName:string,endName:string,target:THREE.Vector3,pole:THREE.Vector3,weight:number) {
    reachBones(this.bones.find(b=>b.name===upperName)?.bone,this.bones.find(b=>b.name===lowerName)?.bone,this.bones.find(b=>b.name===endName)?.bone,target,pole,weight);
  }
  get secondaryWeight() { return this.jumping ? 0 : this.amount; }

  private seatedStyle(weight:number,reduced:boolean,armFreedom:number) {
    const armWeight=weight*(1-THREE.MathUtils.clamp(armFreedom,0,1));
    const unit=this.thigh+this.shin;
    const phase=this.seatedTime*Math.PI*2/4.8;
    // One supported pose throughout the sit. The small second beat gives each
    // lift a softer rebound; delayed chest/head/ankles keep it from moving rigidly.
    const bounce=(lag=0)=>reduced?0:Math.sin(phase-lag)+.28*Math.sin(phase*2-lag*1.5);
    const pose=(name:string,x:number,y=0,z=0)=>{
      const bone=this.bones.find(b=>b.name===name)?.bone;if(!bone)return;
      bone.quaternion.slerp(this.rotation.setFromEuler(this.euler.set(x,y,z)),weight);
    };
    const offset=(name:string,x:number,y=0,z=0)=>{
      const bone=this.bones.find(b=>b.name===name)?.bone;
      bone?.quaternion.multiply(this.rotation.setFromEuler(this.euler.set(x*weight,y*weight,z*weight)));
    };
    // Preserve the trouser clearance and the knee supporting her left hand.
    const swing=bounce(.65)*.040, dangle=bounce(.95)*.065;
    pose('leftUpperLeg',-2.08,0,-.20);pose('leftLowerLeg',1.30+swing,0,-.10);pose('leftFoot',.73-swing*.4,0,.05);
    pose('rightUpperLeg',-1.25,0,-.08);pose('rightLowerLeg',1.27+dangle);pose('rightFoot',-.06-dangle*.4,0,-.02);
    offset('hips',0,.08);
    // A small reversible torso compression gives the lift a visible vertical
    // arc above the fixed pelvis. Arm and leg lengths remain unchanged.
    const compression=reduced?0:(1-Math.cos(phase))*.5+.34*(1-Math.cos(phase*2))*.5;
    this.compression=unit*.028*compression*weight;
    if(this.spine)this.spine.position.y-=this.compression;
    const sway=reduced?0:Math.sin(phase-.35);
    offset('spine',-.035+bounce()*.030,sway*.012,.12+sway*.027);
    offset('chest',bounce(.22)*.028,0,-sway*.015);
    offset('leftShoulder',bounce(.32)*.028,0,bounce(.28)*.115);
    offset('rightShoulder',bounce(.43)*.023,0,-bounce(.40)*.090);
    offset('head',-bounce(.48)*.040,0,-.06-sway*.014);
    const hips=this.hips;hips.updateWorldMatrix(true,true);
    const origin=hips.getWorldPosition(new THREE.Vector3());
    const facing=hips.getWorldQuaternion(new THREE.Quaternion());
    const point=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).multiplyScalar(unit).applyQuaternion(facing).add(origin);
    const right=point(-.29,-.15,-.025);
    const raisedKnee=this.bones.find(b=>b.name==='leftLowerLeg')?.bone;
    const left=raisedKnee
      ?raisedKnee.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.13,-.09).multiplyScalar(unit).applyQuaternion(facing))
      :point(-.08,.115,.35);
    // Both contact points stay fixed while the shoulders float above them.
    this.reach('rightUpperArm','rightLowerArm','rightHand',right,point(-.60,.18,-.08),armWeight);
    this.reach('leftUpperArm','leftLowerArm','leftHand',left,point(.38,.18,.18),armWeight);
    for(const [name,x,y] of [['rightHand',0,Math.PI/2],['leftHand',.12,-Math.PI/2]] as const) {
      const bone=this.bones.find(b=>b.name===name)?.bone;if(!bone?.parent || armWeight<=0)continue;
      const rotation=facing.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,0)));
      rotation.premultiply(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.slerp(rotation,armWeight);bone.updateWorldMatrix(false,true);
    }
    for(const b of this.bones) {
      if(!b.name.endsWith('Proximal') && !b.name.endsWith('Intermediate'))continue;
      const side=b.name.startsWith('left')?1:-1;
      const curl=.10*(b.name.endsWith('Intermediate')?1.3:1);
      b.bone.quaternion.multiply(this.rotation.setFromEuler(this.euler.set(0,0,-side*curl*armWeight)));
    }
  }
  /** VRM retargets hip translation only. Match the rendered torso to the
   * normalized compression after native tracks, keeping the solved hands aligned. */
  applyTorso() {
    if(!this.rawSpine?.parent || !this.spine?.parent || !this.compression)return;
    const bone=this.rawSpine;
    this.rawSpinePosition.copy(bone.position);
    const parent=this.spine.parent;
    const displacement=parent.localToWorld(new THREE.Vector3(0,-this.compression,0))
      .sub(parent.localToWorld(new THREE.Vector3()));
    bone.position.copy(bone.parent!.worldToLocal(bone.getWorldPosition(new THREE.Vector3()).add(displacement)));
    bone.updateWorldMatrix(false,true);
    this.rawSpineApplied=true;
  }
  restore() {
    if(this.rawSpineApplied){this.rawSpine!.position.copy(this.rawSpinePosition);this.rawSpineApplied=false;}
    if(!this.amount)return;
    this.hips.position.copy(this.hipPosition);
    if(this.spine)this.spine.position.copy(this.spinePosition);
    for(const b of this.bones)b.bone.quaternion.copy(b.base);
  }
  update(seated: boolean, dt: number, reduced: boolean, jump: JumpFrame | null = null, armFreedom=0) {
    this.compression=0;
    this.hipPosition.copy(this.hips.position);
    if(this.spine)this.spinePosition.copy(this.spine.position);
    for(const b of this.bones)b.base.copy(b.bone.quaternion);
    const active=seated && !reduced && !!jump && jump.phase!=='seated';
    if(active)this.seatedTime=0;else if(!reduced && (seated || this.amount>0))this.seatedTime+=dt;
    // Being picked up cancels a jump without briefly blending through a seated pose.
    if(this.jumping && !active)this.amount=Number(seated);
    this.jumping=active;
    this.amount=reduced?Number(seated):active?1:THREE.MathUtils.damp(this.amount,Number(seated),9,dt);
    if(this.amount<.0001){this.amount=0;this.seatedTime=0;return;}
    if(!reduced)this.time+=dt;
    const swing=reduced?0:Math.sin(this.time*1.8)*.045;
    let upper=-1.38,lower=1.4,foot=-.04,yaw=.22,drop=0,lean=0,arm=0,armWeight=0,weight=this.amount;
    if(active && jump) {
      const p=jump.progress;
      if(jump.phase==='crouch') {
        const bend=.62*(p<.72?smooth(p/.72):1-smooth((p-.72)/.28));
        const calf=Math.asin(Math.min(.95,this.thigh/this.shin*Math.sin(bend)));
        upper=-bend;lower=bend+calf;foot=-calf;yaw=0;
        drop=this.thigh*(1-Math.cos(bend))+this.shin*(1-Math.cos(calf));
        lean=bend*.28;arm=bend*.75;armWeight=smooth(p/.45);weight=armWeight;
      } else if(jump.phase==='flight') {
        const tuck=smooth(p/.55),seat=smooth((p-.65)/.35);
        upper=THREE.MathUtils.lerp(-1.65*tuck,-1.38,seat);
        lower=THREE.MathUtils.lerp(1.85*tuck,1.4,seat);
        foot=THREE.MathUtils.lerp(.18,-.04,seat);yaw=.22*smooth((p-.35)/.65);
        lean=-.06*Math.sin(p*Math.PI)+.09*tuck*(1-seat);
        arm=-.85*Math.sin(p*Math.PI);armWeight=1-seat;
      } else {
        const impact=Math.sin(p*Math.PI)*Math.exp(-2*p);
        upper-=.12*impact;lower+=.16*impact;lean=.14*impact;
      }
    }
    if(!active)this.hips.position.lerpVectors(this.hipPosition,this.restHipPosition,weight);
    this.hips.position.y=THREE.MathUtils.lerp(this.hipPosition.y,this.restHipPosition.y-drop,weight);
    for(const b of this.bones) {
      const side=b.name.startsWith('left')?1:-1;
      if(b.name==='spine') {
        if(lean)b.bone.quaternion.multiply(this.rotation.setFromEuler(this.euler.set(lean*weight,0,0)));
        continue;
      }
      if(b.name.endsWith('UpperArm')) {
        if(armWeight){this.rotation.setFromEuler(this.euler.set(arm,0,-side*1.04));b.bone.quaternion.slerp(this.rotation,armWeight);}
        continue;
      }
      if(b.name==='chest' || b.name.endsWith('Shoulder') || b.name==='head' || b.name.endsWith('LowerArm') || b.name.endsWith('Hand') || b.name.endsWith('Proximal') || b.name.endsWith('Intermediate'))continue;
      const dangling=active?0:swing;
      const spread=active && jump?.phase==='crouch'?0:.035;
      const angles=b.name==='hips'?[0,yaw,0]:b.name.endsWith('UpperLeg')?[upper,side*spread,side*spread]
        :b.name.endsWith('LowerLeg')?[lower+side*dangling,0,0]:[foot-side*dangling*.3,side*spread,0];
      this.rotation.setFromEuler(this.euler.set(angles[0],angles[1],angles[2]));
      b.bone.quaternion.slerp(this.rotation,weight);
    }
    if(!active)this.seatedStyle(this.amount*(reduced?1:smooth((this.seatedTime-.15)/1.6)),reduced,armFreedom);
  }
}
