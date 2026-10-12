import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { facialClip, performancePack } from '../src/companion/performances';
test('preset pack accepts paired local files and rejects mismatched paths, unknown events and duplicate IDs',()=>{
 const clip={id:'happy-idle',label:'Happy Idle',body:'presets/happy-idle.vrma',face:'presets/happy-idle.face.json'};
 assert.equal(performancePack({version:1,clips:[clip],events:{happy:'happy-idle'}}).clips.length,1);
 for(const value of [null,{}, {version:1,clips:[clip,clip],events:{}},{version:1,clips:[clip],events:{happy:'missing'}},...['../x.face.json','https://example.com/a.face.json','presets/other.face.json'].map(face=>({version:1,clips:[{...clip,face}],events:{}}))]) assert.throws(()=>performancePack(value));
});

test('preset pack accepts the combined 39-clip library and keeps a bounded size',()=>{
 const clips=Array.from({length:65},(_,i)=>({id:`motion-${i}`,label:`Motion ${i}`,body:`presets/motion-${i}.vrma`,face:`presets/motion-${i}.face.json`}));
 assert.equal(performancePack({version:1,clips:clips.slice(0,39),events:{neutral:'motion-0'}}).clips.length,39);
 assert.equal(performancePack({version:1,clips:clips.slice(0,64),events:{}}).clips.length,64);
 assert.throws(()=>performancePack({version:1,clips,events:{}}));
});

test('native clothing tracks bind only matching rig nodes and keep sample validation',async()=>{
 const names=['Belt.L','Belt.L.2','Belt_Close.L.3','Belt.4.R','ZipTab','JacketFrontString.L'];
 const face=new THREE.Mesh();face.morphTargetInfluences=[];
 const avatar={parser:{json:{nodes:[{name:'Body'},...names.map(name=>({name}))]},getDependency:async(_kind:string,index:number)=>index===0?face:new THREE.Bone()}} as unknown as GLTF;
 const bones=names.map((name,i)=>({name,node:i+1,position:[0,0,0,0,0,0],quaternion:[0,0,0,1,0,0,0,1],scale:[1,1,1,1,1,1]}));
 const value={version:1,fps:30,frames:2,morphNode:0,morphs:[],values:[],bones};
 assert.equal((await facialClip(value,avatar,1/30)).clip.tracks.length,names.length*3);
 for(const broken of [{...bones[0],name:'Belt.Unknown'},{...bones[0],node:999},{...bones[0],quaternion:[0,0,0,2,0,0,0,1]}])
  await assert.rejects(facialClip({...value,bones:[broken]},avatar,1/30));
 for(const name of ['BeltRoot','ZipTabUnexpected','Body']){
  const badAvatar={parser:{json:{nodes:[{name:'Body'},{name}]},getDependency:async()=>new THREE.Bone()}} as unknown as GLTF;
  await assert.rejects(facialClip({...value,bones:[{...bones[0],name}]},badAvatar,1/30));
 }
});
