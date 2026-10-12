import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export type PerformanceEntry = { id: string; label: string; body: string; face: string; loop?: boolean };
export function performancePack(value: unknown): { clips: PerformanceEntry[]; events: Record<string, string> } {
  const v = value as { version?: unknown; clips?: PerformanceEntry[]; events?: Record<string, string> };
  if (!v || v.version !== 1 || !Array.isArray(v.clips) || !v.clips.length || v.clips.length > 64 || !v.events || typeof v.events !== 'object' || Array.isArray(v.events)) throw Error('Invalid preset animation pack.');
  const ids = new Set<string>();
  for (const c of v.clips) {
    if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(c.id) || ids.has(c.id) || typeof c.label !== 'string' || !c.label.trim() || c.label.length > 80 || c.body !== 'presets/' + c.id + '.vrma' || c.face !== 'presets/' + c.id + '.face.json' || (c.loop !== undefined && typeof c.loop !== 'boolean')) throw Error('Invalid preset animation entry.');
    ids.add(c.id);
  }
  for (const [event, id] of Object.entries(v.events)) if (!/^[a-z][a-z0-9-]*$/.test(event) || !ids.has(id)) throw Error('Invalid preset animation event.');
  return { clips: v.clips, events: v.events };
}

// Bind through the loaded avatar's node indices, never guessed Blender object names.
export async function facialClip(value: unknown, avatar: GLTF, duration: number) {
  const v = value as {version:number; fps:number; frames:number; morphNode:number; morphs:string[]; values:number[]; bones:{node:number;name:string;position:number[];quaternion:number[];scale:number[]}[]};
  if (!v || v.version !== 1 || v.fps !== 30 || !Number.isInteger(v.frames) || v.frames < 2 || v.frames > 18000 || Math.abs((v.frames - 1) / 30 - duration) > .001 || !Array.isArray(v.morphs) || v.morphs.length > 128 || !v.morphs.every(n=>typeof n==='string') || !Array.isArray(v.bones) || v.bones.length > 256) throw Error('Invalid facial animation timing.');
  const times = Float32Array.from({length:v.frames},(_,i)=>i/30), tracks: THREE.KeyframeTrack[] = [];
  function numbers(values:number[], width:number) {
    if (!Array.isArray(values) || values.length !== v.frames * width || !values.every(x=>typeof x==='number' && Number.isFinite(x) && Math.abs(x)<1000)) throw Error('Invalid facial animation samples.');
    return values;
  }
  async function node(i:number) {
    if (!Number.isInteger(i) || i<0 || !avatar.parser.json.nodes[i]) throw Error('Facial animation joint is missing.');
    return await avatar.parser.getDependency('node',i) as THREE.Object3D;
  }
  const seen = new Set<number>();
  for (const b of v.bones) {
    if (seen.has(b.node) || avatar.parser.json.nodes[b.node]?.name !== b.name || !/^(DEF-|MCH-|Eye|Jaw|Lip|Teeth|Tongue|Breast\.|Hair|Ear\.|Tail\.|Jacket|HoodBone|TagBone|Belt[._]|ZipTab$)/.test(b.name)) throw Error('Facial animation belongs to a different avatar.');
    seen.add(b.node); const target = await node(b.node);
    for (const property of ['position','quaternion','scale'] as const) {
      const values = numbers(b[property], property==='quaternion'?4:3);
      if (property==='quaternion') for(let i=0;i<values.length;i+=4) if(Math.abs(Math.hypot(...values.slice(i,i+4))-1)>.01) throw Error('Invalid facial rotation.');
      tracks.push(property==='quaternion' ? new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',times,values) : new THREE.VectorKeyframeTrack(target.uuid+'.'+property,times,values));
    }
  }
  const values = numbers(v.values,v.morphs.length), meshes: THREE.Mesh[] = [];
  (await node(v.morphNode)).traverse(o=>{if((o as THREE.Mesh).morphTargetInfluences)meshes.push(o as THREE.Mesh)});
  if (!meshes.length) throw Error('Facial animation has no matching face mesh.');
  const mouth: {mesh:THREE.Mesh;index:number}[] = [];
  for (const mesh of meshes) for (const [i,name] of v.morphs.entries()) {
    const index = mesh.morphTargetDictionary?.[name];
    if (index === undefined) throw Error('The avatar is missing facial feature '+name+'.');
    tracks.push(new THREE.NumberKeyframeTrack(mesh.uuid+'.morphTargetInfluences['+index+']',times,Array.from(times,(_,f)=>values[f*v.morphs.length+i])));
    if (/^Fac_(Mth|Tooth)/.test(name)) mouth.push({mesh,index});
  }
  return { clip:new THREE.AnimationClip('face',duration,tracks), mouth };
}
