import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { WardrobePose } from './wardrobePose';
import { vrmWardrobe } from '../../electron/vrmWardrobe';

export async function bindWardrobe(data: unknown, loaded: GLTF) {
  const controls = vrmWardrobe(data);
  const materials = new Set<THREE.Material>();
  const additive = new Map<string, { mesh: THREE.Mesh; index: number; base: number }>();
  const poseBones = new Map<string, THREE.Object3D>();
  for (const control of controls) for (const option of control.options) for (const name of Object.keys(option.bones ?? {})) {
    const bone = (loaded.userData.vrm as VRM).humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
    if (!bone) throw Error('Wardrobe bone is missing: ' + name);
    poseBones.set(name, bone);
  }
  const pose = new WardrobePose(poseBones);
  function selected<T extends { id: string; default: number; options: unknown[] }>(control: T, values: Record<string, number>) {
    const i = values[control.id];
    return Number.isInteger(i) && i >= 0 && i < control.options.length ? i : control.default;
  }
  async function node(name: string): Promise<THREE.Object3D> {
    const index = loaded.parser.json.nodes?.findIndex((n: { name?: string }) => n.name === name) ?? -1;
    if (index < 0) throw Error('Wardrobe mesh is missing: ' + name);
    return loaded.parser.getDependency('node', index);
  }
  const bindings = [] as { id: string; default: number; options: (() => void)[][] }[];
  for (const control of controls) {
    const options = [] as (() => void)[][];
    for (const option of control.options) {
      const actions: (() => void)[] = [];
      for (const [name, visible] of Object.entries(option.visible ?? {})) {
        const target = await node(name);
        actions.push(() => { target.visible = visible; });
      }
      for (const [name, index] of Object.entries(option.materials ?? {})) {
        if (!loaded.parser.json.materials?.[index]) throw Error('Wardrobe material is missing.');
        const target = await node(name);
        const material: THREE.Material = await loaded.parser.getDependency('material', index);
        materials.add(material);
        target.traverse(object => {
          if (object instanceof THREE.Mesh) {
            const mesh = object;
            actions.push(() => { if (Array.isArray(mesh.material)) mesh.material[0] = material; else mesh.material = material; });
          }
        });
      }
      for (const [name, weights] of Object.entries(option.morphs ?? {})) {
        const target = await node(name);
        for (const [morph, weight] of Object.entries(weights)) {
          let found = false;
          target.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const index = object.morphTargetDictionary?.[morph];
            if (index === undefined || !object.morphTargetInfluences) return;
            found = true;
            actions.push(() => { object.morphTargetInfluences![index] = weight; });
          });
          if (!found) throw Error('Wardrobe shape is missing: ' + morph);
        }
      }
      for (const [name, weights] of Object.entries(option.additiveMorphs ?? {})) {
        const target = await node(name);
        for (const [morph, weight] of Object.entries(weights)) {
          let found = false;
          target.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const index = object.morphTargetDictionary?.[morph];
            if (index === undefined || !object.morphTargetInfluences) return;
            found = true;
            const key = object.uuid + ':' + index;
            if (!additive.has(key)) additive.set(key, { mesh: object, index, base: object.morphTargetInfluences[index] });
            actions.push(() => { object.morphTargetInfluences![index] = Math.min(1, object.morphTargetInfluences![index] + weight); });
          });
          if (!found) throw Error('Wardrobe shape is missing: ' + morph);
        }
      }
      options.push(actions);
    }
    bindings.push({ id: control.id, default: control.default, options });
  }
  return {
    hands: controls.find(control => control.id === 'hands')?.options ?? [],
    restore() {
      pose.restore();
      for (const { mesh, index, base } of additive.values()) mesh.morphTargetInfluences![index] = base;
    },
    applyPose(values: Record<string, number> = {}, dt: number, reduced: boolean) {
      const targets = Object.assign({}, ...controls.map(c => c.options[selected(c, values)].bones ?? {}));
      pose.update(targets, dt, reduced);
    },
    apply(values: Record<string, number> = {}) {
      for (const state of additive.values()) state.base = state.mesh.morphTargetInfluences![state.index];
      for (const control of bindings) {
        const value = values[control.id];
        const index = Number.isInteger(value) && value >= 0 && value < control.options.length ? value : control.default;
        for (const action of control.options[index]) action();
      }
    },
    dispose() { for (const material of materials) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); } },
  };
}
