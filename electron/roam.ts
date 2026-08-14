// Getting about.
//
// The window is the body. Everything here decides where that body should be and
// how fast it should get there; main owns the actual setBounds call, and the
// renderer is told only whether she is walking and which way she is facing so it
// can move her legs.
//
// Kept pure so the awkward parts — a second monitor, a taskbar, a destination
// that turns out to be off-screen — can be tested without watching a window
// stagger across a real desktop to find out.

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type RoamConfig = {
  enabled: boolean;
  /**
   * How often she takes herself somewhere, 0..1. Not a frequency in seconds
   * because the useful question is "how much does she move about", and the
   * mapping from that to a delay is this module's business.
   */
  restlessness: number;
  /** Whether she keeps out of the way of whatever is fullscreen. */
  avoidFullscreen: boolean;
};

export const DEFAULT_ROAM: RoamConfig = { enabled: false, restlessness: 0.35, avoidFullscreen: true };

export function readRoamConfig(saved: unknown): RoamConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_ROAM;
  const record = saved as Partial<RoamConfig>;
  return {
    enabled: record.enabled === true,
    restlessness: typeof record.restlessness === 'number' ? Math.max(0, Math.min(1, record.restlessness)) : DEFAULT_ROAM.restlessness,
    avoidFullscreen: record.avoidFullscreen !== false,
  };
}

// Walking pace in pixels a second, before energy scales it. Slow on purpose: a
// window that crosses a 4K screen in two seconds does not read as somebody
// walking, it reads as a bug in the compositor.
const BASE_SPEED = 118;
const MIN_SPEED = 42;

/** How fast she walks given how much energy she has left. */
export function speedFor(energy: number) {
  return MIN_SPEED + (BASE_SPEED - MIN_SPEED) * Math.max(0, Math.min(1, energy));
}

// Between one wander and the next. Restlessness picks a point in this range,
// and the actual wait is randomised around it so she is not metronomic.
const IDLE_GAP_MIN_MS = 25_000;
const IDLE_GAP_MAX_MS = 5 * 60_000;

export function nextWanderDelay(restlessness: number, random = Math.random) {
  const eager = Math.max(0, Math.min(1, restlessness));
  const centre = IDLE_GAP_MAX_MS - (IDLE_GAP_MAX_MS - IDLE_GAP_MIN_MS) * eager;
  // ±40%, so two waits in a row are never the same length.
  return Math.round(centre * (0.6 + random() * 0.8));
}

/**
 * Somewhere else along the floor. She walks rather than flies, so only x really
 * moves; y is nudged only to stay seated on the bottom of the work area, which
 * is what keeps her standing on the taskbar instead of drifting mid-screen.
 *
 * Rejects destinations that are barely anywhere — a four-pixel shuffle is not a
 * journey, and starting a walk cycle for one looks broken.
 */
export function pickDestination(work: Rect, body: Rect, random = Math.random): Point | null {
  const floorY = work.y + work.height - body.height;
  const leftMost = work.x;
  const rightMost = work.x + work.width - body.width;
  if (rightMost <= leftMost) return null;
  const target = leftMost + random() * (rightMost - leftMost);
  // At least a body's width away, or it is not worth standing up for.
  if (Math.abs(target - body.x) < body.width * 0.75) return null;
  return { x: Math.round(target), y: Math.round(floorY) };
}

/**
 * Where a fullscreen window is, and therefore where she should not be. Returns
 * the nearer bottom corner of the display she is on — out of the way, but still
 * visible, because hiding entirely is what the pin toggle is for.
 */
export function refugeFrom(work: Rect, body: Rect): Point {
  const centre = body.x + body.width / 2;
  const onTheLeft = centre < work.x + work.width / 2;
  return {
    x: onTheLeft ? work.x + 8 : work.x + work.width - body.width - 8,
    y: work.y + work.height - body.height,
  };
}

export type Walk = { position: Point; arrived: boolean; facing: -1 | 0 | 1 };

/**
 * One frame of walking. Moves toward the target at a fixed speed rather than
 * easing into it: an eased approach means the last twenty pixels take as long as
 * the first two hundred, and she appears to give up just short of where she was
 * going.
 */
export function step(from: Point, to: Point, speed: number, deltaMs: number): Walk {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const travel = (speed * deltaMs) / 1000;
  // Snapped rather than overshot, so she cannot oscillate around the target on
  // a slow frame.
  if (distance <= travel || distance < 1) return { position: { x: to.x, y: to.y }, arrived: true, facing: 0 };
  return {
    position: { x: from.x + (dx / distance) * travel, y: from.y + (dy / distance) * travel },
    arrived: false,
    facing: dx > 0 ? 1 : -1,
  };
}

/**
 * Whether she is willing to wander right now. Every one of these is a case where
 * moving would be actively wrong rather than merely unnecessary — dragging her
 * somewhere is an instruction, and walking off mid-sentence looks like she lost
 * interest in her own point.
 */
export function mayWander(state: {
  enabled: boolean;
  speaking: boolean;
  dragging: boolean;
  listening: boolean;
  fullscreen: boolean;
  sinceUserMovedMs: number;
}) {
  if (!state.enabled) return false;
  if (state.speaking || state.dragging || state.listening) return false;
  // Put somewhere by hand, she stays put for a while. Wandering off thirty
  // seconds after being placed reads as her ignoring you.
  if (state.sinceUserMovedMs < 90_000) return false;
  return true;
}
