import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export function watchDigits(date: Date): number[] {
  return [date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()].flatMap(n => [Math.floor(n / 10), n % 10]);
}

/** The source watch uses one morph per digit, in MM DD HH mm order. */
export async function bindWatch(loaded: GLTF) {
  const index = loaded.parser.json.nodes?.findIndex((n: { name?: string }) => n.name === 'Watch_Dial') ?? -1;
  if (index < 0) return undefined;
  const node: THREE.Object3D = await loaded.parser.getDependency('node', index);
  const meshes: THREE.Mesh[] = [];
  node.traverse(o => { if (o instanceof THREE.Mesh && o.morphTargetDictionary?.NO1_0 !== undefined) meshes.push(o); });
  let last = '';
  return { update(date = new Date()) {
    const digits = watchDigits(date), key = digits.join('');
    if (key === last) return;
    last = key;
    for (const mesh of meshes) for (let position = 0; position < 8; position++) for (let digit = 0; digit < 10; digit++) {
      const index = mesh.morphTargetDictionary?.[`NO${position + 1}_${digit}`];
      if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = digit === digits[position] ? 1 : 0;
    }
  } };
}
