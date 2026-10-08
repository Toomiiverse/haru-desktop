import type { DesktopScene } from '../../electron/desktopAwareness';
import type { Point, Rect } from '../../electron/roam';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Stable layout anchor: her corner, or the nearest exposed window edge. */
export function desktopAnchor(scene: DesktopScene, home?: Point | null): Point | null {
  const work = scene.workArea, windows = scene.windows;
  if (!work || !windows) return null;
  const { width, height } = scene.avatar;
  const fit = (p: Point) => ({ x: Math.max(work.x, Math.min(work.x + work.width - width, p.x)), y: Math.max(work.y, Math.min(work.y + work.height - height, p.y)) });
  const favourite = fit(home ?? { x: work.x + work.width - width - 12, y: work.y + work.height - height - 12 });
  const candidates = [favourite];
  for (const w of windows) candidates.push(
    fit({ x: w.x - width - 8, y: favourite.y }), fit({ x: w.x + w.width + 8, y: favourite.y }),
    fit({ x: favourite.x, y: w.y - height - 8 }), fit({ x: favourite.x, y: w.y + w.height + 8 }));
  return candidates.filter(p => !windows.some(w => overlaps({ ...p, width, height }, w)))
    .sort((a, b) => Math.hypot(a.x - favourite.x, a.y - favourite.y) - Math.hypot(b.x - favourite.x, b.y - favourite.y))[0] ?? favourite;
}

/** Clamp the visible artwork, including animated hair, to the phone panel. */
export function panelContact(body: Rect, panel: Rect) {
  const dx = body.width > panel.width ? panel.x + (panel.width - body.width) / 2 - body.x
    : Math.max(panel.x - body.x, Math.min(0, panel.x + panel.width - body.x - body.width));
  const dy = body.height > panel.height ? panel.y - body.y
    : Math.max(panel.y - body.y, Math.min(0, panel.y + panel.height - body.y - body.height));
  return { x: dx, y: dy, wall: body.width > panel.width || body.height > panel.height ? '' : dx > .5 ? 'left' : dx < -.5 ? 'right' : dy > .5 ? 'top' : '' };
}
