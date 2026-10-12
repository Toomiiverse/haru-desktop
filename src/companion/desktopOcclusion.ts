import * as THREE from 'three';
import type { DesktopScene } from '../../electron/desktopAwareness';

/** Intersections expressed in the companion window's 0..1 screen coordinates. */
export function desktopOccluders(desktop: DesktopScene | null | undefined) {
  const avatar = desktop?.avatar;
  if (!avatar || ![avatar.x, avatar.y, avatar.width, avatar.height].every(Number.isFinite) || avatar.width <= 0 || avatar.height <= 0) return [];
  return desktop!.occluders.flatMap(rect => {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return [];
    const x = Math.max(avatar.x, rect.x), y = Math.max(avatar.y, rect.y);
    const right = Math.min(avatar.x + avatar.width, rect.x + rect.width), bottom = Math.min(avatar.y + avatar.height, rect.y + rect.height);
    return right > x && bottom > y ? [{x: (x-avatar.x)/avatar.width, y: (y-avatar.y)/avatar.height, width: (right-x)/avatar.width, height: (bottom-y)/avatar.height}] : [];
  });
}

/** Write only depth, leaving covered pixels transparent for the real desktop. */
export class DesktopOcclusion {
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly material = new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide});
  private readonly planes: THREE.Mesh[] = [];
  private rectangles: ReturnType<typeof desktopOccluders> = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'Haru desktop occlusion';
    scene.add(this.group);
  }

  update(desktop: DesktopScene | null | undefined, camera: THREE.OrthographicCamera) {
    this.rectangles = desktopOccluders(desktop);
    while (this.planes.length < this.rectangles.length) {
      const plane = new THREE.Mesh(this.geometry, this.material);
      plane.name = 'Haru window depth mask'; plane.userData.desktopOccluder = true;
      plane.renderOrder = -10000; plane.frustumCulled = false;
      this.group.add(plane); this.planes.push(plane);
    }
    camera.updateWorldMatrix(true, false);
    const rotation = camera.getWorldQuaternion(new THREE.Quaternion());
    const inward = new THREE.Vector3(0, 0, -camera.near*.5).applyQuaternion(rotation);
    this.planes.forEach((plane, i) => {
      const rect = this.rectangles[i]; plane.visible = !!rect;
      if (!rect) return;
      plane.position.set(2*(rect.x+rect.width/2)-1, 1-2*(rect.y+rect.height/2), -1).unproject(camera).add(inward);
      plane.quaternion.copy(rotation);
      plane.scale.set(rect.width*(camera.right-camera.left)/camera.zoom, rect.height*(camera.top-camera.bottom)/camera.zoom, 1);
    });
  }

  contains(x: number, y: number, width: number, height: number) {
    if (width <= 0 || height <= 0) return false;
    return this.rectangles.some(rect => x/width >= rect.x && x/width <= rect.x+rect.width && y/height >= rect.y && y/height <= rect.y+rect.height);
  }

  dispose() {
    this.group.removeFromParent(); this.group.clear(); this.planes.length = 0;
    this.geometry.dispose(); this.material.dispose(); this.rectangles = [];
  }
}
