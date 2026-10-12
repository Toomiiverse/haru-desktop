import test from 'node:test';
import assert from 'node:assert/strict';
import {groundPosition,fallPosition,parseSurfaces,readPerchMetrics,choosePerch,perchPosition,openEdges,jumpFrame,jumpPosition,type DesktopSurface} from '../electron/perching';
import {PerchPose} from '../src/companion/perchPose';
import * as THREE from 'three';
import type {VRM} from '@pixiv/three-vrm';
const body={x:400,y:220,width:300,height:360},metrics={head:.1,seat:.52,feet:.97,halfWidth:.19};
const display={x:0,y:0,width:1920,height:1040};
const surface:DesktopSurface={id:'10:20',x:200,y:410,width:850,height:500,eligible:true};

test('window geometry rejects malformed values and has no metadata dependency',()=>{
 assert.deepEqual(parseSurfaces(JSON.stringify([surface])),[surface]);
 assert.deepEqual(parseSurfaces('[]'),[]);
 for(const value of ['bad','{}',JSON.stringify([surface,surface]),JSON.stringify([{...surface,id:'title'}]),JSON.stringify([{...surface,width:-1}]),JSON.stringify([{...surface,x:Infinity}])])assert.equal(parseSurfaces(value),null);
 assert.deepEqual(readPerchMetrics(metrics),metrics);
 for(const value of [{},null,{...metrics,seat:NaN},{...metrics,head:.9},{...metrics,feet:2}])assert.equal(readPerchMetrics(value),null);
});
test('perch follows the same window position and relative seat after a resize',()=>{
 const target=choosePerch([surface],body,metrics,[display],true);assert.ok(target);
 const before=perchPosition(target,[surface],body,metrics,[display]);assert.deepEqual(before,{x:400,y:223});
 assert.deepEqual(perchPosition(target,[{...surface,x:300,y:450}],body,metrics,[display]),{x:500,y:263});
 const wider=perchPosition(target,[{...surface,width:1000}],body,metrics,[display]);assert.ok(wider);assert.equal(wider.x,462);
 assert.equal(perchPosition(target,[],body,metrics,[display]),null);
 assert.equal(perchPosition(target,[{...surface,eligible:false}],body,metrics,[display]),null);
});

test('a seat does not chase fractional-DPI changes in the reported window size',()=>{
 const target={id:surface.id,offset:.4,size:{width:433,height:519}};
 const position=perchPosition(target,[surface],{...body,width:433,height:519},metrics,[display]);assert.ok(position);
 for(const width of [433,434])for(const height of [519,520])assert.deepEqual(perchPosition(target,[surface],{...body,width,height},metrics,[display]),position);
 const resized={...target,size:{width:600,height:720}};
 assert.notDeepEqual(perchPosition(resized,[surface],body,metrics,[display]),position,'an actual resize updates the anchor');
 const moved=perchPosition(target,[{...surface,x:surface.x+1,y:surface.y-1}],body,metrics,[display]);
 assert.deepEqual(moved,{x:position.x+1,y:position.y-1},'still follow real one-pixel window movements');
});
test('covered edges, cramped headroom, and distant drag releases do not attach',()=>{
 const cover={...surface,id:'11:21',x:190,y:300,width:1000,eligible:false};
 assert.deepEqual(openEdges([cover,surface],1),[]);assert.equal(choosePerch([cover,surface],body,metrics,[display],false),null);
 assert.equal(choosePerch([{...surface,y:20}],body,metrics,[display],false),null);
 assert.equal(choosePerch([surface],{...body,y:0},metrics,[display],true),null);
 const partial={...cover,width:280};const edges=openEdges([partial,surface],1);assert.deepEqual(edges,[[470,1034]]);
 assert.ok(choosePerch([partial,surface],body,metrics,[display],false));
 assert.equal(choosePerch([{...surface,width:100}],body,metrics,[display],false),null);
});
test('negative monitor coordinates and scaled avatar sizes retain usable seats',()=>{
 const other={...display,x:-1920};const left={...surface,x:-1600};
 const shifted={...body,x:-1400};const target=choosePerch([left],shifted,metrics,[other,display],true);assert.ok(target);
 assert.ok(perchPosition(target,[left],shifted,metrics,[other,display])!.x<0);
 const big={...body,width:600,height:720,y:40};const p=choosePerch([surface],big,metrics,[display],true);assert.ok(p);
 assert.ok(perchPosition(p,[surface],big,metrics,[display]));
});
test('seated overlay keeps hip contact steady, restores mixer poses, and honors reduced motion',()=>{
 const names=['hips','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot'];
 const nodes=new Map(names.map(name=>[name,new THREE.Bone()]));nodes.get('hips')!.position.y=1;
 const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>nodes.get(name)}} as unknown as VRM;
 const pose=new PerchPose(vrm);const baseline=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12,0,.02));
 for(let i=0;i<120;i++){pose.restore();nodes.get('hips')!.position.y=.98;for(const n of nodes.values())n.quaternion.copy(baseline);pose.update(true,1/30,false);}
 assert.ok(Math.abs(nodes.get('hips')!.position.y-1)<1e-6);assert.ok(nodes.get('leftUpperLeg')!.rotation.x < -1.2);
 pose.restore();assert.ok(nodes.get('leftUpperLeg')!.quaternion.angleTo(baseline)<1e-7);assert.equal(nodes.get('hips')!.position.y,.98);
 pose.update(true,1/30,true);const q=nodes.get('leftLowerLeg')!.quaternion.clone();
 pose.restore();pose.update(true,1/30,true);assert.ok(q.angleTo(nodes.get('leftLowerLeg')!.quaternion)<1e-7);
 pose.restore();pose.update(false,1/30,true);assert.ok(nodes.get('leftUpperLeg')!.quaternion.angleTo(baseline)<1e-7);
});

test('jump holds the launch point, clears the seat, descends to contact, and respects headroom',()=>{
 const jump={started:1000,flight:800},from={x:200,y:650},to={x:400,y:260};
 for(const time of [990,1000,1120,1259])assert.deepEqual(jumpPosition(from,to,jumpFrame(jump,time),600,0),from);
 const points=Array.from({length:101},(_,i)=>jumpPosition(from,to,{phase:'flight',progress:i/100},600,0));
 assert.ok(Math.abs(points[0].y-from.y)<1e-8);assert.ok(Math.abs(points[100].y-to.y)<1e-8);
 const apex=Math.min(...points.map(p=>p.y));assert.ok(apex<to.y-60);
 assert.ok(points[1].y<points[0].y && points[99].y<points[100].y,'launch up and land moving down');
 for(let i=1;i<99;i++)assert.ok(Math.abs((points[i+1].y-2*points[i].y+points[i-1].y)-(points[2].y-2*points[1].y+points[0].y))<1e-8,'constant gravity');
 for(const p of points)assert.ok(p.y>=0);
 for(let i=0;i<=100;i++)assert.ok(jumpPosition(from,to,{phase:'flight',progress:i/100},600,245).y>=245);
 assert.deepEqual(jumpPosition(from,to,jumpFrame(jump,2060),600,0),to);
 assert.equal(jumpFrame(jump,2379).phase,'land');assert.equal(jumpFrame(jump,2380).phase,'seated');
 assert.equal(jumpFrame(jump,1000,true).phase,'seated');
 // A dragged window supplies a fresh endpoint, including negative monitor coordinates.
 const moved={x:-500,y:300};assert.deepEqual(jumpPosition(from,moved,jumpFrame(jump,2400),600,0),moved);
});

test('jump bends planted legs, tucks in flight, restores arms, and cancels cleanly',()=>{
 const names=['hips','spine','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot','leftUpperArm','rightUpperArm'];
 const nodes=new Map(names.map(name=>[name,new THREE.Bone()]));const hips=nodes.get('hips')!;hips.position.y=1;
 for(const side of ['left','right']){const thigh=nodes.get(side+'UpperLeg')!,shin=nodes.get(side+'LowerLeg')!,foot=nodes.get(side+'Foot')!;hips.add(thigh);thigh.add(shin);shin.add(foot);shin.position.y=-.4;foot.position.y=-.4;}
 const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>nodes.get(name)}} as unknown as VRM,pose=new PerchPose(vrm);
 const foot=nodes.get('leftFoot')!,point=()=>{hips.updateMatrixWorld(true);return foot.getWorldPosition(new THREE.Vector3())};const start=point();
 pose.update(true,.03,false,{phase:'crouch',progress:.72});assert.ok(hips.position.y<.88);assert.ok(point().distanceTo(start)<1e-6,'crouch preserves foot contact');
 pose.restore();assert.equal(hips.position.y,1);pose.update(true,.03,false,{phase:'flight',progress:.55});
 assert.ok(nodes.get('leftUpperLeg')!.rotation.x<-1.5);assert.ok(nodes.get('leftLowerLeg')!.rotation.x>1.7);
 pose.restore();pose.update(false,.03,false);for(const n of nodes.values())assert.ok(n.quaternion.angleTo(new THREE.Quaternion())<1e-7,'cancellation restores baseline');
 pose.restore();pose.update(true,.03,true,{phase:'crouch',progress:.72});assert.equal(hips.position.y,1);assert.ok(nodes.get('leftUpperLeg')!.rotation.x<-1.3,'reduced motion sits directly');
});

test('one bouncing seated idle keeps contacts and limb lengths for two minutes, then restores',()=>{
 const nodes=new Map<string,THREE.Bone>();
 const add=(name:string,parent:string|null,x:number,y:number,z=0)=>{const bone=new THREE.Bone();bone.position.set(x,y,z);nodes.set(name,bone);if(parent)nodes.get(parent)!.add(bone);return bone;};
 const hips=add('hips',null,0,1);add('spine','hips',0,.15);add('chest','spine',0,.10);add('head','chest',0,.25);
 for(const [side,sign] of [['left',1],['right',-1]] as const){
  add(side+'UpperLeg','hips',sign*.07,-.06);add(side+'LowerLeg',side+'UpperLeg',0,-.38);add(side+'Foot',side+'LowerLeg',0,-.37);
  add(side+'Shoulder','chest',sign*.055,.07);add(side+'UpperArm',side+'Shoulder',sign*.125,0);add(side+'LowerArm',side+'UpperArm',sign*.26,0);add(side+'Hand',side+'LowerArm',sign*.24,0);
  for(const finger of ['Index','Middle','Ring','Little']){add(side+finger+'Proximal',side+'Hand',sign*.055,0);add(side+finger+'Intermediate',side+finger+'Proximal',sign*.035,0);}
 }
 const pose=new PerchPose({humanoid:{getNormalizedBoneNode:(name:string)=>nodes.get(name)}} as unknown as VRM);
 const baseline=new Map([...nodes].map(([name,bone])=>[name,bone.quaternion.clone()]));
 baseline.get('head')!.setFromEuler(new THREE.Euler(.03,.2,0));
 const positions=new Map([...nodes].map(([name,bone])=>[name,bone.position.clone()]));
 const point=(name:string)=>nodes.get(name)!.getWorldPosition(new THREE.Vector3());
 let previous=new Map<string,THREE.Quaternion>();
 const cycle=new Map<number,Map<string,THREE.Quaternion>>();
 const samples: {left:THREE.Vector3;right:THREE.Vector3;head:THREE.Vector3;shoulder:THREE.Quaternion}[]=[];
 for(let frame=1;frame<=120*30;frame++){
  pose.restore();
  assert.ok(nodes.get('spine')!.position.distanceTo(positions.get('spine')!)<1e-12,'torso compression is restored before the next native sample');
  for(const [name,bone] of nodes){assert.ok(bone.quaternion.angleTo(baseline.get(name)!)<1e-6 || frame===1,'restore every overlay, including fingers and head');bone.quaternion.copy(baseline.get(name)!);}
  hips.position.set(Math.sin(frame*.1)*.005,.985,.005);pose.update(true,1/30,false);hips.updateMatrixWorld(true);
  if(frame>90)assert.ok(hips.position.distanceTo(new THREE.Vector3(0,1,0))<1e-8,'all three pelvis axes stay anchored over the native idle');
  for(const [name,bone] of nodes){
   assert.ok(bone.quaternion.toArray().every(Number.isFinite));assert.ok(Math.abs(bone.quaternion.length()-1)<1e-6);
   if(name!=='hips' && name!=='spine')assert.ok(bone.position.distanceTo(positions.get(name)!)<1e-12,'reach rotates limbs without stretching them');
   if(frame>90 && previous.has(name))assert.ok(bone.quaternion.angleTo(previous.get(name)!)<.13,`${name} changes smoothly at frame ${frame}`);
  }
  previous=new Map([...nodes].map(([name,bone])=>[name,bone.quaternion.clone()]));
  if(frame>144 && frame<=288)cycle.set(frame%144,new Map([...nodes].map(([name,bone])=>[name,bone.quaternion.clone()])));
  if(frame>288)for(const [name,bone] of nodes)assert.ok(bone.quaternion.angleTo(cycle.get(frame%144)!.get(name)!)<1e-6,'the same 4.8-second idle continues beyond the former switching times');
  if(frame>144)samples.push({left:point('leftHand'),right:point('rightHand'),head:point('head'),shoulder:nodes.get('leftShoulder')!.quaternion.clone()});
 }
 const casual=samples[0];
 assert.ok(casual.right.y<.93 && casual.left.y>1,'one hand braces below the hip and the other rests over the lap');
 for(const sample of samples){assert.ok(sample.right.distanceTo(casual.right)<1e-6,'bracing hand does not slide');assert.ok(sample.left.distanceTo(casual.left)<1e-6,'lap hand stays on the fixed raised knee');}
 assert.ok(Math.max(...samples.map(sample=>sample.shoulder.angleTo(casual.shoulder)))>.1,'shoulders have visible buoyant motion above the contacts');
 assert.ok(Math.max(...samples.map(sample=>sample.head.y))-Math.min(...samples.map(sample=>sample.head.y))>.015,'the torso has visible vertical bounce above the fixed seat');
 pose.restore();pose.update(false,0,true);for(const [name,bone] of nodes)assert.ok(bone.quaternion.angleTo(baseline.get(name)!)<1e-6);
 pose.update(true,0,true);const still=new Map([...nodes].map(([name,bone])=>[name,bone.quaternion.clone()]));
 for(let i=0;i<10;i++){pose.restore();pose.update(true,10,true);for(const [name,bone] of nodes)assert.ok(bone.quaternion.angleTo(still.get(name)!)<1e-6,'reduced motion holds a single still pose');}
});

test('the visible soles meet the monitor floor after drops, scaling, and taskbar changes',()=>{
 const work={x:-1920,y:-200,width:1920,height:1040},body={x:-800,y:20,width:600,height:720};
 const floor=groundPosition(work,body,.97);assert.ok(Math.abs(floor.y+720*.97-840)<=.5);
 const scaled=groundPosition(work,{...body,width:900,height:1080},.97);assert.ok(Math.abs(scaled.y+1080*.97-840)<=.5);
 assert.equal(groundPosition({...work,height:1000},body,.97).y,floor.y-40);
 assert.equal(groundPosition(work,{...body,x:-2200},.97).x,work.x);
 const from={x:-800,y:-400},samples=Array.from({length:11},(_,i)=>fallPosition(from,floor,i*60,600));
 assert.deepEqual(samples[0],from);assert.deepEqual(samples[10],floor);
 for(let i=1;i<10;i++){assert.ok(samples[i].y>=samples[i-1].y && samples[i].y<floor.y);if(i>1)assert.ok(samples[i].y-samples[i-1].y>samples[i-1].y-samples[i-2].y,'gravity accelerates the fall');}
 assert.deepEqual(fallPosition(from,floor,-50,600),from);
 assert.deepEqual(fallPosition(from,floor,0,600,true),floor);
 assert.deepEqual(fallPosition({...from,y:floor.y+200},floor,0,600),floor,'never stay below the floor');
});

test('seated compression reaches the visible raw rig and restores native torso samples',()=>{
 const hips=new THREE.Bone(),spine=new THREE.Bone();hips.position.y=1;hips.add(spine);spine.position.y=.2;
 const rawParent=new THREE.Bone(),rawSpine=new THREE.Bone();rawParent.add(rawSpine);rawParent.rotation.set(.2,-.4,.3);rawParent.scale.setScalar(.01);rawSpine.position.set(2,20,1);
 const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>name==='hips'?hips:name==='spine'?spine:null,getRawBoneNode:()=>rawSpine}} as unknown as VRM;
 const pose=new PerchPose(vrm),before=rawSpine.position.clone();
 for(let i=0;i<144;i++){
  pose.restore();assert.ok(rawSpine.position.distanceTo(before)<1e-10,'restore the native raw torso before sampling');
  assert.equal(spine.position.y,.2);pose.update(true,1/30,false);
  const rawBefore=rawSpine.getWorldPosition(new THREE.Vector3());pose.applyTorso();
  const actual=rawSpine.getWorldPosition(new THREE.Vector3()).sub(rawBefore);
  const expected=new THREE.Vector3(0,spine.position.y-.2,0).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(actual.distanceTo(expected)<1e-10,'visible raw torso receives exactly the normalized compression, including scaled/rotated source parents');
 }
 for(const seated of [false,true]){pose.restore();pose.update(seated,0,true);pose.applyTorso();assert.equal(spine.position.y,.2);assert.ok(rawSpine.position.distanceTo(before)<1e-10,'reduced motion and leaving the seat clear both rigs');}
});


