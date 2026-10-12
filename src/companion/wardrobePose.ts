import * as THREE from 'three';

/** Restore the sampled idle before evaluating a held hand pose each frame. */
export class WardrobePose {
  private readonly bones;
  private readonly target = new THREE.Quaternion();
  constructor(nodes: Map<string, THREE.Object3D>) {
    this.bones = [...nodes].map(([name, bone]) => ({ name, bone, base: bone.quaternion.clone(), current: bone.quaternion.clone(), active: false }));
  }
  restore() { for (const b of this.bones) if (b.active) b.bone.quaternion.copy(b.base); }
  update(targets: Record<string, [number, number, number, number]>, dt: number, reduced: boolean) {
    for (const b of this.bones) {
      b.base.copy(b.bone.quaternion);
      const q = targets[b.name];
      if (!q && !b.active) continue;
      if (!b.active) b.current.copy(b.base);
      if (q) this.target.fromArray(q); else this.target.copy(b.base);
      b.current.slerp(this.target, reduced ? 1 : 1 - Math.exp(-12 * dt));
      b.bone.quaternion.copy(b.current);
      b.active = !!q || b.current.angleTo(b.base) > .0001;
      if (!b.active) b.bone.quaternion.copy(b.base);
    }
  }
}
