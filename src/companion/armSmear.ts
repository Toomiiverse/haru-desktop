import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

const materials = (mesh: THREE.Mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material];
type History = {source: THREE.Skeleton; previous: THREE.Matrix4[]; frames: THREE.Skeleton[]};
type Trail = {
  source: THREE.SkinnedMesh; side: number; geometry: THREE.BufferGeometry;
  frames: THREE.SkinnedMesh[]; originals: THREE.Material[];
  previous: THREE.Matrix4; morphs: number[];
};

/** Two faint, localized drawings from the preceding arm poses during fast sweeps. */
export class ArmSmear {
  private readonly group = new THREE.Group();
  private readonly arms;
  private readonly histories = new Map<THREE.Skeleton, History>();
  private readonly trails: Trail[] = [];
  private ready = false;

  constructor(private readonly vrm: VRM) {
    this.group.name = 'Haru arm smears';
    this.arms = (['left', 'right'] as const).map(side => {
      const members = new Set<THREE.Object3D>();
      vrm.humanoid.getRawBoneNode(`${side}UpperArm`)?.traverse(node => members.add(node));
      return {members, hand: vrm.humanoid.getRawBoneNode(`${side}Hand`), previous: new THREE.Vector3()};
    });
    vrm.scene.traverse(node => {
      const source = node as THREE.SkinnedMesh;
      if (!source.isSkinnedMesh || !source.skeleton) return;
      const skin = source.geometry.getAttribute('skinIndex'), weights = source.geometry.getAttribute('skinWeight');
      if (!skin || !weights) return;
      for (let side = 0; side < 2; side++) {
        const own = source.skeleton.bones.map(bone => this.arms[side].members.has(bone));
        const selected = new Uint8Array(skin.count);
        for (let v = 0; v < skin.count; v++) {
          let weight = 0;
          for (let k = 0; k < 4; k++) if (own[skin.getComponent(v, k)]) weight += weights.getComponent(v, k);
          selected[v] = Number(weight >= .65);
        }
        const geometry = new THREE.BufferGeometry(), index = source.geometry.index, kept: number[] = [];
        const groups = source.geometry.groups.length ? source.geometry.groups : [{start: 0, count: index?.count ?? skin.count, materialIndex: 0}];
        for (const group of groups) {
          const material = materials(source)[group.materialIndex ?? 0];
          if (material && 'isOutline' in material && material.isOutline) continue;
          const start = kept.length;
          for (let i = group.start; i < group.start + group.count; i += 3) {
            const a = index?.getX(i) ?? i, b = index?.getX(i + 1) ?? i + 1, c = index?.getX(i + 2) ?? i + 2;
            // Every corner must belong to this arm: never trail the torso or opposite sleeve.
            if (selected[a] && selected[b] && selected[c]) kept.push(a, b, c);
          }
          if (kept.length > start) geometry.addGroup(start, kept.length - start, group.materialIndex);
        }
        if (!kept.length) continue;
        for (const [name, attribute] of Object.entries(source.geometry.attributes)) geometry.setAttribute(name, attribute);
        geometry.morphAttributes = source.geometry.morphAttributes;
        geometry.morphTargetsRelative = source.geometry.morphTargetsRelative;
        geometry.setIndex(kept);
        let history = this.histories.get(source.skeleton);
        if (!history) {
          history = {source: source.skeleton, previous: source.skeleton.bones.map(bone => bone.matrixWorld.clone()),
            frames: [0, 1].map(() => new THREE.Skeleton(source.skeleton.bones.map(() => new THREE.Bone()), source.skeleton.boneInverses))};
          this.histories.set(source.skeleton, history);
        }
        const frames = history.frames.map((skeleton, age) => {
          const mesh = new THREE.SkinnedMesh(geometry, materials(source).map(material => this.cloneMaterial(material)));
          mesh.name = `Haru ${side ? 'right' : 'left'} arm smear ${age + 1}`;
          mesh.userData.haruArmSmear = {side: side ? 'right' : 'left', age: age + 1};
          mesh.bindMode = source.bindMode;
          mesh.bind(skeleton, source.bindMatrix);
          mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
          mesh.renderOrder = source.renderOrder;
          this.group.add(mesh);
          return mesh;
        });
        this.trails.push({source, side, geometry, frames, originals: [...materials(source)], previous: source.matrixWorld.clone(), morphs: [...source.morphTargetInfluences ?? []]});
      }
    });
  }

  private cloneMaterial(source: THREE.Material) {
    const material = source.clone();
    material.transparent = true; material.opacity = 0; material.depthWrite = false;
    material.forceSinglePass = true;
    if ('outlineWidthMode' in material) material.outlineWidthMode = 'none';
    material.needsUpdate = true;
    return material;
  }

  update(active: boolean, delta: number, reduced: boolean) {
    const parent = this.vrm.scene.parent;
    if (parent && this.group.parent !== parent) parent.add(this.group);
    const valid = active && !reduced && Number.isFinite(delta) && delta > 0 && delta <= .05 && !!parent;
    const strength = this.arms.map(arm => {
      const position = arm.hand?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
      const speed = this.ready && valid ? position.distanceTo(arm.previous) / delta : 0;
      arm.previous.copy(position);
      return THREE.MathUtils.clamp((speed - .9) / 2.2, 0, 1);
    });
    if (!valid) {
      for (const trail of this.trails) for (const mesh of trail.frames) mesh.visible = false;
      this.ready = false;
      return;
    }
    this.vrm.scene.updateWorldMatrix(true, true);
    const inverse = parent!.matrixWorld.clone().invert();
    for (const history of this.histories.values()) {
      for (let i = 0; i < history.source.bones.length; i++) {
        if (!this.ready) {
          history.previous[i].copy(history.source.bones[i].matrixWorld);
          history.frames[0].bones[i].matrixWorld.copy(history.previous[i]);
        }
        history.frames[1].bones[i].matrixWorld.copy(history.frames[0].bones[i].matrixWorld);
        history.frames[0].bones[i].matrixWorld.copy(history.previous[i]);
        history.previous[i].copy(history.source.bones[i].matrixWorld);
      }
    }
    for (const trail of this.trails) {
      const {source, frames} = trail, currentMaterials = materials(source);
      if (!this.ready) {
        trail.previous.copy(source.matrixWorld);
        frames[0].matrix.copy(inverse).multiply(trail.previous);
        source.morphTargetInfluences?.forEach((value, i) => trail.morphs[i] = value);
        frames[0].morphTargetInfluences?.forEach((_, i, values) => values[i] = trail.morphs[i]);
      }
      if (currentMaterials.some((material, i) => material !== trail.originals[i]) || currentMaterials.length !== trail.originals.length) {
        for (const mesh of frames) {
          materials(mesh).forEach(material => material.dispose());
          mesh.material = currentMaterials.map(material => this.cloneMaterial(material));
        }
        trail.originals = [...currentMaterials];
      }
      let visible = true;
      for (let ancestor: THREE.Object3D | null = source; ancestor; ancestor = ancestor.parent) visible &&= ancestor.visible;
      for (let age = 1; age >= 0; age--) {
        const mesh = frames[age];
        mesh.matrix.copy(age ? frames[0].matrix : inverse.clone().multiply(trail.previous));
        if (mesh.morphTargetInfluences) {
          const influences = age ? frames[0].morphTargetInfluences : trail.morphs;
          for (let i = 0; i < mesh.morphTargetInfluences.length; i++) mesh.morphTargetInfluences[i] = influences?.[i] ?? 0;
        }
        materials(mesh).forEach((material, i) => {
          const opacity = (age ? .055 : .13) * strength[trail.side];
          material.opacity = opacity * (currentMaterials[i]?.opacity ?? 1);
          material.alphaTest = opacity * (currentMaterials[i]?.alphaTest ?? 0);
          material.visible = currentMaterials[i]?.visible ?? false;
          // Cloned MToon materials are outside VRM.update's material list.
          if ('isMToonMaterial' in material && 'update' in material && typeof material.update === 'function') material.update(0);
        });
        mesh.visible = this.ready && visible && strength[trail.side] > 0;
      }
      trail.previous.copy(source.matrixWorld);
      source.morphTargetInfluences?.forEach((value, i) => trail.morphs[i] = value);
    }
    this.ready = true;
  }

  dispose() {
    this.group.removeFromParent();
    for (const {geometry, frames} of this.trails) {
      // Attribute buffers and textures belong to the original model.
      for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
      geometry.morphAttributes = {};
      geometry.dispose();
      for (const mesh of frames) materials(mesh).forEach(material => material.dispose());
    }
    for (const history of this.histories.values()) history.frames.forEach(skeleton => skeleton.dispose());
    this.trails.length = 0; this.histories.clear(); this.group.clear();
  }
}
