import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { DesktopScene } from '../electron/desktopAwareness';
import { DesktopPose, desktopGaze } from '../src/companion/desktopPose';
import { DesktopOcclusion, desktopOccluders } from '../src/companion/desktopOcclusion';

const desktop = (peek: DesktopScene['peek'] = null): DesktopScene => ({displayId:1,windowCount:2,crowding:.4,avatar:{x:-600,y:100,width:400,height:600},occluders:[{x:-500,y:250,width:600,height:500}],focus:{x:0,y:200},peek});

test('window masks map desktop coordinates into transparent depth and pass covered clicks through', () => {
  const state = desktop(), rectangles = desktopOccluders(state);
  assert.deepEqual(rectangles,[{x:.25,y:.25,width:.75,height:.75}]);
  assert.deepEqual(desktopOccluders({...state,avatar:{...state.avatar,width:0}}),[]);
  const scene = new THREE.Scene(), mask = new DesktopOcclusion(scene), camera = new THREE.OrthographicCamera(-2,2,3,-3,.01,30);
  camera.position.set(0,1,8);camera.lookAt(0,1,0);camera.updateProjectionMatrix();
  mask.update(state,camera);scene.updateMatrixWorld(true);
  const group = scene.getObjectByName('Haru desktop occlusion')!, plane = group.children[0] as THREE.Mesh;
  const material = plane.material as THREE.Material;
  assert.equal(material.colorWrite,false);assert.equal(material.depthWrite,true);assert.equal(material.transparent,false);
  const point = plane.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(Math.abs(point.x-.25)<1e-10 && Math.abs(point.y+.25)<1e-10,'mask aligns with the covered screen rectangle');
  assert.ok(point.z>-1 && point.z<-.99,'depth is in front of the avatar without touching the near clip');
  assert.equal(mask.contains(150,200,400,600),true);assert.equal(mask.contains(60,100,400,600),false);
  assert.equal(mask.contains(300,400,800,1200),true,'DIP mapping stays stable when the canvas scales');
  mask.update(null,camera);assert.equal(plane.visible,false);assert.equal(mask.contains(150,200,400,600),false);
  mask.dispose();assert.equal(scene.getObjectByName('Haru desktop occlusion'),undefined);
});

test('desktop gaze blends gently and preserves conversation attention', () => {
  const gaze = {x:-.2,y:.1}, result = desktopGaze(desktop(),gaze,true);
  assert.ok(result.x>gaze.x && result.x<1);assert.ok(Math.abs(result.y)<=1);
  assert.deepEqual(desktopGaze(desktop(),gaze,false),gaze,'speaking/listening retains its original gaze');
});

test('walking alternates grounded steps, turns with travel, and releases cleanly before peeking or falling', () => {
  const nodes = new Map<string,THREE.Bone>();
  const add = (name:string,parent:string|null,x:number,y:number,z=0) => {const bone = new THREE.Bone();bone.position.set(x,y,z);nodes.set(name,bone);if(parent)nodes.get(parent)!.add(bone);return bone;};
  const hips = add('hips',null,0,1);add('spine','hips',0,.15);add('chest','spine',0,.10);add('neck','chest',0,.12);add('head','neck',0,.13);
  for (const [side,sign] of [['left',1],['right',-1]] as const) {
    add(side+'Shoulder','chest',sign*.055,.07);add(side+'UpperArm',side+'Shoulder',sign*.125,0);add(side+'LowerArm',side+'UpperArm',sign*.26,0);add(side+'Hand',side+'LowerArm',sign*.24,0);
    add(side+'UpperLeg','hips',sign*.07,-.06);add(side+'LowerLeg',side+'UpperLeg',0,-.38);add(side+'Foot',side+'LowerLeg',0,-.37);
    nodes.get(side+'UpperLeg')!.rotation.x=-.07;nodes.get(side+'LowerLeg')!.rotation.x=.16;
  }
  const point = (name:string) => nodes.get(name)!.getWorldPosition(new THREE.Vector3());
  const pose = new DesktopPose({humanoid:{getNormalizedBoneNode:(name:string)=>nodes.get(name)}} as unknown as VRM);
  const bases = new Map([...nodes].map(([name,bone])=>[name,{position:bone.position.clone(),rotation:bone.quaternion.clone()}]));
  const floor = Math.min(point('leftFoot').y,point('rightFoot').y), heights = {left:[] as number[],right:[] as number[]};
  const frame = (walk:number,state:DesktopScene|null,blocked=false,reduced=false,now=1000,speed?:number) => {pose.restore();pose.update(walk,state,blocked,1/60,now,reduced,speed);hips.updateMatrixWorld(true);};
  for(let i=0;i<180;i++){
    frame(1,null,false,false,i/60*1000);
    if(i>60)for(const side of ['left','right'] as const)heights[side].push(point(side+'Foot').y-floor);
    assert.ok(Math.min(point('leftFoot').y,point('rightFoot').y)-floor<.004,'each step has floor support');
    assert.ok(Math.min(point('leftFoot').y,point('rightFoot').y)>=floor-.004,'neither foot passes through the floor');
    for(const [name,bone] of nodes)if(name!=='hips')assert.ok(bone.position.distanceTo(bases.get(name)!.position)<1e-12,'limb lengths remain unchanged');
  }
  const forward = new THREE.Vector3(0,0,1).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(forward.x>.6,'walking right turns the body toward travel');
  for(const values of Object.values(heights))assert.ok(Math.max(...values)>.035 && Math.min(...values)<.004,'both feet lift and plant in alternating steps');
  assert.ok(heights.left.some((v,i)=>v>.025 && heights.right[i]<.004) && heights.right.some((v,i)=>v>.025 && heights.left[i]<.004));
  for(let i=0;i<100;i++)frame(0,null);
  assert.equal(pose.activity,0);for(const [name,bone] of nodes){assert.ok(bone.position.distanceTo(bases.get(name)!.position)<1e-12);assert.ok(bone.quaternion.angleTo(bases.get(name)!.rotation)<1e-6);}
  for(const edge of ['left','right','top'] as const){
    for(let i=0;i<90;i++)frame(0,desktop({edge,started:0,duration:5000}),false,false,1000+i*16);
    assert.ok(pose.peekWeight>.98);assert.equal(pose.walkWeight,0);
    for(const [side,sign] of [['left',1],['right',-1]] as const){
      assert.ok(point(side+'LowerArm').x*sign>point(side+'UpperArm').x*sign+.04,'peek elbows stay outside the shoulders');
      assert.ok(Math.abs(point(side+'Foot').y-floor)<.004,'peek retains foot support');
    }
    frame(1,desktop({edge,started:0,duration:5000}),true);assert.equal(pose.activity,0,'fall/jump/seated immediately own the body');
    for(const [name,bone] of nodes)assert.ok(bone.quaternion.angleTo(bases.get(name)!.rotation)<1e-6);
  }
  frame(1,null);frame(1,null,false,true);assert.equal(pose.activity,0,'reduced motion clears locomotion');
  const stepsAt = (speed:number) => {
    let steps=0,raised=false;
    for(let i=0;i<780;i++){
      frame(1,null,false,false,i*1000/60,speed);
      const next=point('leftFoot').y-floor>.02;
      if(i>=60 && next && !raised)steps++;
      raised=next;
    }
    return steps;
  };
  const slow=stepsAt(.2),fast=stepsAt(.4);
  assert.ok(slow>=4 && fast>=slow*1.6 && fast<=slow*2.4,'doubling travel speed roughly doubles visible steps instead of sliding at a fixed cadence');
});
