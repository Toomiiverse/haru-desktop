import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { landingDuration, type FallFrame } from '../../electron/perching';
import { reachBones } from './perchPose';

const smooth=(v:number)=>{const t=THREE.MathUtils.clamp(v,0,1);return t*t*(3-2*t);};
export const fallReaction=(frame:FallFrame|null)=>!frame || frame.phase==='done'?0:frame.strength*(frame.phase==='fall'?smooth(frame.progress/.18):1-smooth(frame.progress));

/** Air resistance leads into a one-foot catch and circling-arm recovery. */
export class FallPose {
  private readonly bones=new Map<string,{bone:THREE.Object3D;base:THREE.Quaternion}>();
  private readonly hips;
  private readonly hipBase=new THREE.Vector3();
  private readonly restHipY:number;
  private readonly feet=new Map<string,{position:THREE.Vector3;rotation:THREE.Quaternion}>();
  private readonly thigh:number;
  private readonly shin:number;
  private applied=false;
  activity=0;
  private readonly chest;
  private readonly breasts:{bone:THREE.Object3D;position:THREE.Vector3;rotation:THREE.Quaternion;offset:number;speed:number;omega:number}[]=[];
  private chestApplied=false;
  private previousChestY:number|null=null;
  private chestSpeed=0;

  constructor(vrm:VRM) {
    const names=['hips','spine','chest','head'];
    for(const side of ['left','right']) {
      names.push(...['Shoulder','UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot'].map(name=>side+name));
      for(const finger of ['Index','Middle','Ring','Little'])names.push(side+finger+'Proximal',side+finger+'Intermediate');
    }
    for(const name of names){const bone=vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);if(bone)this.bones.set(name,{bone,base:bone.quaternion.clone()});}
    this.hips=this.bone('hips')!;this.restHipY=this.hips.position.y;
    this.chest=this.bone('chest');
    vrm.scene?.traverse(bone=>{
      const name=bone.userData.name || bone.name;
      if(name==='Breast.L' || name==='Breast.R')this.breasts.push({bone,position:bone.position.clone(),rotation:bone.quaternion.clone(),offset:0,speed:0,omega:(name==='Breast.L'?3.6:3.8)*Math.PI*2});
    });
    this.thigh=this.bone('leftLowerLeg')?.position.length() || this.restHipY*.45;
    this.shin=this.bone('leftFoot')?.position.length() || this.restHipY*.45;
    for(const side of ['left','right']){const foot=this.bone(side+'Foot');if(foot)this.feet.set(side,{position:foot.getWorldPosition(new THREE.Vector3()),rotation:foot.getWorldQuaternion(new THREE.Quaternion())});}
  }
  private bone(name:string){return this.bones.get(name)?.bone;}
  restore() {
    if(this.chestApplied){for(const entry of this.breasts){entry.bone.position.copy(entry.position);entry.bone.quaternion.copy(entry.rotation);}this.chestApplied=false;}
    if(!this.applied)return;
    this.hips.position.copy(this.hipBase);
    for(const {bone,base} of this.bones.values())bone.quaternion.copy(base);
    this.applied=false;
  }
  update(frame:FallFrame|null,reduced:boolean) {
    this.activity=0;
    if(!frame || reduced || frame.phase==='done')return;
    const p=frame.progress,landing=frame.phase==='land',strength=frame.strength;
    const duration=landingDuration(strength)/1000,t=landing?p*duration:0;
    const preparation=landing?1:smooth((p-.52)/.48);
    const oneFoot=landing?1-smooth((t-.16)/Math.max(.35,duration*.70-.16)):preparation;
    const weight=landing?1-smooth((t-duration+.26)/.26):smooth(p/.22);
    if(!weight)return;
    this.activity=weight*strength;
    this.applied=true;this.hipBase.copy(this.hips.position);
    for(const {bone,base} of this.bones.values())base.copy(bone.quaternion);
    const pose=(name:string,x:number,y=0,z=0)=>this.bone(name)?.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z)),weight);
    const unit=this.thigh+this.shin;
    const landingFeet=landing || preparation>0?new Map([...this.feet.keys()].map(side=>{
      const foot=this.bone(side+'Foot')!,upper=this.bone(side+'UpperLeg')!,lower=this.bone(side+'LowerLeg')!;
      const position=foot.getWorldPosition(new THREE.Vector3()),origin=upper.getWorldPosition(new THREE.Vector3()),knee=lower.getWorldPosition(new THREE.Vector3());
      const direction=position.clone().sub(origin).normalize(),bend=knee.clone().sub(origin);
      bend.addScaledVector(direction,-bend.dot(direction));
      if(bend.lengthSq()<1e-12)bend.set(side==='left'?.06:-.06,0,.5).applyQuaternion(this.hips.getWorldQuaternion(new THREE.Quaternion()));
      return [side,{position,rotation:foot.getWorldQuaternion(new THREE.Quaternion()),pole:knee.addScaledVector(bend.normalize(),unit*.5)}] as const;
    })):null;
    const pulse=(start:number,length:number)=>Math.sin(Math.PI*THREE.MathUtils.clamp((t-start)/length,0,1))**2;
    const impact=landing?pulse(0,.26)+.46*pulse(.26,.30)+.17*pulse(.57,.28):0;
    const recoil=landing?strength*(pulse(.20,.22)-.50*pulse(.43,.24)+.18*pulse(.66,.22)):0;
    const headRecoil=landing?strength*(pulse(.25,.24)-.50*pulse(.50,.24)+.18*pulse(.73,.22)):0;
    const high=smooth((strength-.2)/.8),balanceTime=Math.max(0,t-.10);
    const balance=landing?smooth(t/.10)*(1-smooth((p-.55)/.30))*(.20+.80*oneFoot):0;
    const wobble=(.30+.70*high)*balance*Math.sin(balanceTime*Math.PI*2*1.25)*(.55+.45*Math.exp(-.8*balanceTime));
    // A staggered fore/aft rock makes the catch travel around the support foot.
    // Pelvis and ribcage counterbalance instead of tipping together rigidly.
    const foreAft=(.25+.75*high)*balance*Math.sin(balanceTime*Math.PI*2*1.10+.80)*(.55+.45*Math.exp(-.8*balanceTime));
    const compression=wobble*wobble+.35*foreAft*foreAft;
    const bend=.16*oneFoot+(landing?.78*strength*impact+.26*compression:.20*strength*(1-smooth((p-.64)/.36)));
    const calf=Math.asin(Math.min(.95,this.thigh/this.shin*Math.sin(bend)));
    const drop=(this.thigh*(1-Math.cos(bend))+this.shin*(1-Math.cos(calf)))*(landing?1:preparation)+unit*(.018*compression+.025*foreAft*foreAft);
    this.hips.position.y=THREE.MathUtils.lerp(this.hipBase.y,this.restHipY-drop,weight);
    this.hips.position.x+=unit*(-.10*oneFoot+.055*wobble)*weight;
    this.hips.position.z-=unit*.055*foreAft*weight;
    pose('hips',0,0,-.045*oneFoot+(landing?-.06*wobble:Math.sin(p*5)*.018*strength*(1-preparation)));
    pose('spine',landing?bend*.30-.085*recoil+.24*foreAft:THREE.MathUtils.lerp(-.045*strength,bend*.30,preparation),0,-.20*wobble);
    pose('chest',landing?bend*.14-.065*recoil+.10*foreAft:THREE.MathUtils.lerp(-.025*strength,bend*.14,preparation),0,.045*wobble);
    pose('head',landing?.10*strength*(1-smooth(t/.16))-.06*impact+.13*headRecoil-.14*foreAft:.10*strength,0,landing?.14*wobble:Math.sin(p*4)*.025*strength*(1-preparation));
    for(const [side,sign] of [['left',1],['right',-1]] as const) {
      pose(side+'UpperLeg',-bend,0,sign*.025);
      pose(side+'LowerLeg',bend+calf);
      pose(side+'Foot',landing?-calf:-.10*(1-smooth((p-.64)/.36)));
    }
    this.hips.updateWorldMatrix(true,true);
    const origin=this.hips.getWorldPosition(new THREE.Vector3()),facing=this.hips.getWorldQuaternion(new THREE.Quaternion());
    const point=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).multiplyScalar(unit).applyQuaternion(facing).add(origin);
    for(const [side,sign] of [['left',1],['right',-1]] as const) {
      // The shoulders lead, while loose elbows and wrists lag in the upward air flow.
      const air=landing?1-smooth(t/.22):smooth(p/.72);
      const lift=(landing?air:.55+.45*air)*strength;
      const ripple=landing?0:Math.sin(p*8+sign*.6)*.018*air*(1-smooth((p-.84)/.16));
      const circling=landing?smooth((t-.14)/.26)*(1-smooth((p-.60)/.26))*(.25+.75*oneFoot):0;
      const circleTime=Math.max(0,t-.14);
      const cycle=Math.PI*2*(1.50*circleTime-.22*circleTime*circleTime/Math.max(.4,duration*.75));
      const angle=sign*cycle+(side==='left'?.4:2.1),size=.75+.25*strength;
      const sweep=landing?Math.sin(Math.PI*smooth(t/.22))*strength:0;
      const target=point(sign*(.31+.13*lift+.18*sweep),-.16+.82*lift+ripple,.12+.08*lift+.12*sweep);
      // The wrist stays forward while the elbow bends outward and slightly down,
      // keeping the bulky sleeve beside the torso instead of across the chest.
      target.lerp(point(sign*(.55+.20*size*Math.cos(angle)),.46+.31*size*Math.sin(angle),.26-.06*size*Math.cos(angle)),circling);
      target.add(new THREE.Vector3(0,-.10*foreAft,-.18*foreAft).multiplyScalar(unit).applyQuaternion(facing));
      pose(side+'Shoulder',0,-sign*(.04*lift+.07*circling*Math.cos(angle)),sign*(.12*lift+.08*circling*Math.sin(angle)+.10*recoil));
      const upper=this.bone(side+'UpperArm');
      const shoulder=upper?.getWorldPosition(new THREE.Vector3()) || point(sign*.25,.58,0);
      // Keep the wrist in front/outside its shoulder through blended arrivals,
      // where a straight interpolation would otherwise fold the elbow tightly.
      const clearance=target.clone().sub(shoulder).applyQuaternion(facing.clone().invert());
      clearance.x=sign*Math.max(sign*clearance.x,unit*.20);clearance.z=Math.max(clearance.z,unit*.32);
      target.copy(clearance.applyQuaternion(facing).add(shoulder));
      const pole=shoulder.clone().lerp(target,.5)
        .add(new THREE.Vector3(sign*.50,-.08,.04).multiplyScalar(unit).applyQuaternion(facing));
      reachBones(upper,this.bone(side+'LowerArm'),this.bone(side+'Hand'),target,pole,weight);
      const hand=this.bone(side+'Hand');
      if(hand?.parent){
        const q=facing.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12+.18*circling*Math.cos(angle),-sign*.9,sign*(.85*lift+.22*circling*Math.sin(angle)))));
        q.premultiply(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert());hand.quaternion.slerp(q,weight);hand.updateWorldMatrix(false,true);
      }
      for(const [index,finger] of ['Index','Middle','Ring','Little'].entries()) {
        pose(side+finger+'Proximal',0,sign*(index-1.5)*.07*Math.max(lift,circling),-sign*(.12+index*.035));
        pose(side+finger+'Intermediate',0,0,-sign*(.16+index*.035));
      }
      if(landingFeet && this.feet.has(side)) {
        const planted=this.feet.get(side)!;
        const goal=landingFeet!.get(side)!;
        const contactWeight=weight*(landing?1:preparation),target=planted.position.clone(),rotation=planted.rotation.clone();
        if(side==='left'){
          target.add(new THREE.Vector3(.085,.22+.05*strength,.16).multiplyScalar(unit*oneFoot).applyQuaternion(facing));
          rotation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.20*oneFoot,0,.06*oneFoot)));
        }
        goal.position.lerp(target,contactWeight);goal.rotation.slerp(rotation,contactWeight);
        // Blend the contact target, then solve it fully; blending the solved
        // joints again would lift the feet during the return to the native idle.
        // Return the knee plane to the sampled idle along with its contact target.
        goal.pole.lerp(point(sign*(.16+(side==='left'?.12*oneFoot:0)),-.25,.60),contactWeight);
        reachBones(this.bone(side+'UpperLeg'),this.bone(side+'LowerLeg'),this.bone(side+'Foot'),goal.position,goal.pole,1,.9999999);
        const foot=this.bone(side+'Foot');
        if(foot?.parent)foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(goal.rotation));
      }
    }
  }

  /** Damped chest inertia, added after native tracks so body and fitted fabric
   * follow the same source bones. Observe inactive frames to avoid stale impulses. */
  applySecondary(delta:number,reduced:boolean) {
    if(!this.chest)return;
    const y=this.chest.getWorldPosition(new THREE.Vector3()).y,valid=delta>0 && delta<=.1;
    const speed=valid && this.previousChestY!==null?(y-this.previousChestY)/delta:0;
    const acceleration=valid?THREE.MathUtils.clamp((speed-this.chestSpeed)/delta,-35,35):0;
    this.previousChestY=y;this.chestSpeed=speed;
    if(reduced || !this.activity || !valid){for(const entry of this.breasts){entry.offset=0;entry.speed=0;}return;}
    const steps=Math.ceil(delta/(1/120)),dt=delta/steps;
    const pitchAxis=new THREE.Vector3(1,0,0).applyQuaternion(this.chest.getWorldQuaternion(new THREE.Quaternion()));
    for(const entry of this.breasts) {
      const {bone,omega}=entry;if(!bone.parent)continue;
      entry.position.copy(bone.position);entry.rotation.copy(bone.quaternion);
      for(let i=0;i<steps;i++){
        entry.speed+=(-omega*omega*entry.offset-2*.36*omega*entry.speed-.65*acceleration)*dt;
        entry.offset=THREE.MathUtils.clamp(entry.offset+entry.speed*dt,-.016,.016);
      }
      const offset=entry.offset*this.activity;
      bone.position.copy(bone.parent.worldToLocal(bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,offset,0))));
      const axis=pitchAxis.clone().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.clamp(-offset*4,-.065,.065)));
      bone.updateWorldMatrix(false,true);
    }
    this.chestApplied=true;
  }
}
