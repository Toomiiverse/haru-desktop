import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { FallPose, fallReaction } from '../src/companion/fallPose';
import { landingDuration } from '../electron/perching';

test('landings keep elbows outside and progressively recover onto both feet',()=>{
 const nodes=new Map<string,THREE.Bone>();
 const add=(name:string,parent:string|null,x:number,y:number,z=0)=>{const bone=new THREE.Bone();bone.position.set(x,y,z);nodes.set(name,bone);if(parent)nodes.get(parent)!.add(bone);return bone;};
 const hips=add('hips',null,0,1);add('spine','hips',0,.15);add('chest','spine',0,.10);add('head','chest',0,.25);
 for(const [side,sign] of [['left',1],['right',-1]] as const){
  add(side+'Shoulder','chest',sign*.055,.07);add(side+'UpperArm',side+'Shoulder',sign*.125,0);add(side+'LowerArm',side+'UpperArm',sign*.26,0);add(side+'Hand',side+'LowerArm',sign*.24,0);
  add(side+'UpperLeg','hips',sign*.07,-.06);add(side+'LowerLeg',side+'UpperLeg',0,-.38);add(side+'Foot',side+'LowerLeg',0,-.37);
  nodes.get(side+'UpperLeg')!.rotation.set(-.07,sign*.12,0);nodes.get(side+'LowerLeg')!.rotation.x=.16;
 }
 const pose=new FallPose({humanoid:{getNormalizedBoneNode:(name:string)=>nodes.get(name)}} as unknown as VRM);
 const point=(name:string)=>nodes.get(name)!.getWorldPosition(new THREE.Vector3());
 const soles=[point('leftFoot'),point('rightFoot')],positions=new Map([...nodes].map(([name,bone])=>[name,bone.position.clone()]));
 const baseline=new Map([...nodes].map(([name,bone])=>[name,bone.quaternion.clone()]));
 for(let i=0;i<=30;i++){
  pose.restore();pose.update({phase:'fall',progress:i/30,strength:1},false);
  for(const [name,bone] of nodes){assert.ok(bone.quaternion.toArray().every(Number.isFinite));if(name!=='hips')assert.ok(bone.position.distanceTo(positions.get(name)!)<1e-12,'limbs never stretch');}
 }
 for(const side of ['left','right'])assert.ok(point(side+'Hand').y>point(side+'UpperArm').y+.08,'air flow carries both wrists above the shoulders');
 const fallEnd=new Map([...nodes].map(([name,bone])=>[name,{position:bone.getWorldPosition(new THREE.Vector3()),rotation:bone.quaternion.clone()}]));
 pose.restore();pose.update({phase:'land',progress:0,strength:1},false);
 for(const [name,bone] of nodes){assert.ok(bone.getWorldPosition(new THREE.Vector3()).distanceTo(fallEnd.get(name)!.position)<1e-6,'contact continues the prepared one-foot pose');assert.ok(bone.quaternion.angleTo(fallEnd.get(name)!.rotation)<1e-5);}
 const drops:number[]=[],holds:number[]=[],rockRanges:number[]=[];
 for(const strength of [.3,1]){
  let lowest=Infinity,hold=0;
  const duration=landingDuration(strength)/1000;
  const hands={left:[] as THREE.Vector3[],right:[] as THREE.Vector3[]};
  const footHeights:number[]=[];
  const rock:{z:number;pitch:number}[]=[];
  const previousArms=new Map<string,{rotation:THREE.Quaternion;position:THREE.Vector3}>();
  for(let i=0;i<=240;i++){
   const t=i/240*duration;
   pose.restore();pose.update({phase:'land',progress:i/240,strength},false);hips.updateMatrixWorld(true);
   lowest=Math.min(lowest,hips.position.y);
   const torso=point('head').sub(point('spine'));
   rock.push({z:hips.position.z-positions.get('hips')!.z,pitch:Math.atan2(torso.z,torso.y)});
   const error=point('rightFoot').distanceTo(soles[1]);assert.ok(error<.003,`support foot retains floor contact: strength ${strength}, frame ${i}, error ${error}`);
   const clearance=point('leftFoot').y-soles[0].y;
   assert.ok(clearance>-.003,'the raised foot never passes through the floor');
   if(i===0)assert.ok(clearance>.10,'the landing starts on one foot');
   if([0,60,120,168].includes(i))footHeights.push(clearance);
   if(clearance>.10)hold=t;
   if(i>=168)assert.ok(point('leftFoot').distanceTo(soles[0])<.003,'both feet support the last part of recovery');
   if(t>=.3 && t<duration*.8)for(const side of ['left','right'] as const)hands[side].push(point(side+'Hand').sub(point('hips')));
   for(const side of ['left','right'])for(const joint of ['UpperArm','LowerArm']){
    const name=side+joint,bone=nodes.get(name)!,current={rotation:bone.quaternion.clone(),position:point(name)},previous=previousArms.get(name);
    if(previous){assert.ok(previous.rotation.angleTo(current.rotation)<.6,`arm joints never flip: ${name}, strength ${strength}, t ${t}, angle ${previous.rotation.angleTo(current.rotation)}`);assert.ok(previous.position.distanceTo(current.position)<.08,'elbows follow the hand paths continuously');}
    previousArms.set(name,current);
   }
   if(t<duration-.26)for(const [side,sign] of [['left',1],['right',-1]] as const){
    const elbow=point(side+'LowerArm').sub(point(side+'UpperArm')).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()).invert());
    assert.ok(sign*elbow.x>.05,'elbows stay outside the shoulders instead of pulling sleeves across the chest');
   }
   for(const [name,bone] of nodes)if(name!=='hips')assert.ok(bone.position.distanceTo(positions.get(name)!)<1e-12,'balancing never stretches limbs');
  }
  assert.ok(hips.position.distanceTo(positions.get('hips')!)<1e-12,'balance fully returns to the sampled idle');
  assert.ok(footHeights[0]>footHeights[1]+.005 && footHeights[1]>footHeights[2]+.02 && footHeights[2]>footHeights[3]+.02,'the free foot descends progressively through recovery');
  const minimum=Math.min(...rock.map(v=>v.z)),maximum=Math.max(...rock.map(v=>v.z));
  rockRanges.push(maximum-minimum);
  if(strength===1){
   assert.ok(minimum<-.02 && maximum>.01,'high falls rock the pelvis behind and ahead of the standing position');
   const recovery=rock.slice(Math.ceil(.30/duration*240),193);
   const forwardLean=Math.max(...recovery.map(v=>v.pitch)),backwardLean=Math.min(...recovery.map(v=>v.pitch));
   assert.ok(forwardLean>.08 && backwardLean<-.04,`the torso leans forward and back after the initial crouch: ${forwardLean}, ${backwardLean}`);
   let reversals=0;for(let i=2;i<rock.length;i++)if((rock[i].z-rock[i-1].z)*(rock[i-1].z-rock[i-2].z)<0)reversals++;
   assert.ok(reversals>=2,'fore/aft balance changes direction before settling');
  }
  if(strength===1)for(const side of ['left','right'] as const){
   const path=hands[side],range=(axis:'x'|'y')=>Math.max(...path.map(v=>v[axis]))-Math.min(...path.map(v=>v[axis]));
   assert.ok(range('x')>.12 && range('y')>.28,`both arms retain visible circling as balance recovers: ${side}, ${range('x')}, ${range('y')}`);
   let reversals=0;for(let i=2;i<path.length;i++)if((path[i].y-path[i-1].y)*(path[i-1].y-path[i-2].y)<0)reversals++;
   assert.ok(reversals>=3,'a high fall gets repeated balancing swings before settling');
  }
  drops.push(1-lowest);holds.push(hold);
 }
 assert.ok(drops[1]>.18 && drops[1]>drops[0]*3,'high drops bend the support knee much deeper than low drops');
 assert.ok(rockRanges[1]>rockRanges[0]*2,'higher drops need larger forward/back corrections');
 assert.ok(holds[1]<1 && holds[1]>holds[0]+.3,'recovery is quick while higher drops still take longer to transfer back to both feet');
 const sample=(t:number)=>{pose.restore();pose.update({phase:'land',progress:t/(landingDuration(1)/1000),strength:1},false);return hips.position.y;};
 for(let cycle=1;cycle<=5;cycle++){
  const t=.10+cycle/(2*1.25),dt=1e-5,before=sample(t-dt),center=sample(t),after=sample(t+dt);
  assert.ok(Math.abs((after-center)/dt-(center-before)/dt)<.005,'balance direction changes retain continuous vertical speed');
 }
 pose.restore();pose.update({phase:'land',progress:.999999,strength:1},false);
 for(const side of ['left','right'])for(const joint of ['UpperLeg','LowerLeg','Foot']){
  const name=side+joint;assert.ok(nodes.get(name)!.quaternion.angleTo(baseline.get(name)!)<1e-3,'the knee plane returns continuously to native idle');
 }
 pose.restore();for(const [name,bone] of nodes){assert.ok(bone.quaternion.angleTo(baseline.get(name)!)<1e-6);assert.ok(bone.position.distanceTo(positions.get(name)!)<1e-12);}
 for(const reduced of [false,true]){pose.update(reduced?{phase:'fall',progress:.8,strength:1}:null,reduced);for(const [name,bone] of nodes)assert.ok(bone.quaternion.angleTo(baseline.get(name)!)<1e-6,'cancellation and reduced motion leave no fall offsets');}
});

test('chest inertia follows vertical impact, stays bounded, and restores native motion',()=>{
 const scene=new THREE.Group(),hips=new THREE.Bone(),chest=new THREE.Bone();
 hips.position.y=1;chest.position.y=.3;scene.add(hips);hips.add(chest);
 const parent=new THREE.Bone();parent.quaternion.setFromEuler(new THREE.Euler(.4,-.8,.3));scene.add(parent);
 const breasts=['Breast.L','Breast.R'].map((name,i)=>{const bone=new THREE.Bone();bone.userData.name=name;bone.position.set(i?-.04:.04,.06,0);parent.add(bone);return bone;});
 const bases=breasts.map(bone=>({position:bone.position.clone(),rotation:bone.quaternion.clone(),world:bone.getWorldPosition(new THREE.Vector3())}));
 const pose=new FallPose({scene,humanoid:{getNormalizedBoneNode:(name:string)=>name==='hips'?hips:name==='chest'?chest:null}} as unknown as VRM);
 let positive=0,negative=0;
 for(let i=0;i<120;i++){
  pose.restore();
  for(const [j,bone] of breasts.entries()){assert.ok(bone.position.distanceTo(bases[j].position)<1e-12);assert.ok(bone.quaternion.angleTo(bases[j].rotation)<1e-6);}
  const t=i/60;chest.position.y=.3-(t<.4?.2*Math.sin(Math.PI*t/.4)**2:0);
  pose.activity=1;pose.applySecondary(1/60,false);
  for(const [j,bone] of breasts.entries()){
   const offset=bone.getWorldPosition(new THREE.Vector3()).sub(bases[j].world);
   positive=Math.max(positive,offset.y);negative=Math.min(negative,offset.y);
   assert.ok(Math.abs(offset.x)<1e-9 && Math.abs(offset.z)<1e-9,'rotated source parents retain world-vertical inertia');
   assert.ok(Math.abs(offset.y)<=.0160001 && bone.quaternion.angleTo(bases[j].rotation)<=.0650001,'secondary movement remains inside the garment clearance envelope');
  }
 }
 assert.ok(positive>.005 && negative<-.005,'impact produces a visible overshoot and rebound');
 pose.restore();pose.update(null,false);pose.applySecondary(1/60,false);
 for(const [j,bone] of breasts.entries())assert.ok(bone.position.distanceTo(bases[j].position)<1e-12,'cancellation restores the source pose');
 pose.activity=1;chest.position.y=.2;pose.applySecondary(1/60,true);
 for(const [j,bone] of breasts.entries())assert.ok(bone.position.distanceTo(bases[j].position)<1e-12,'reduced motion does not apply inertia');
});

test('surprise enters smoothly, survives delayed contact, and fades through the landing',()=>{
 assert.equal(fallReaction(null),0);
 assert.equal(fallReaction({phase:'fall',progress:0,strength:1}),0);
 assert.equal(fallReaction({phase:'fall',progress:1,strength:.7}),.7);
 assert.equal(fallReaction({phase:'land',progress:0,strength:.7}),.7);
 assert.ok(fallReaction({phase:'land',progress:.5,strength:1})>.2);
 assert.equal(fallReaction({phase:'land',progress:1,strength:1}),0);
 assert.equal(fallReaction({phase:'done',progress:1,strength:1}),0);
});
