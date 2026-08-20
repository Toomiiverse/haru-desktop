// Pure geometry and timing helpers for the floating companion window.
// Deliberately free of electron imports (mirrors dates.ts) so sizing, clamping,
// and poll-rate logic can be exercised directly in plain Node.

export type Bounds = { x: number; y: number; width: number; height: number };
export type DisplayBounds = { x: number; y: number; width: number; height: number };

export function combinedDisplayBounds(displays: DisplayBounds[]) {
  return {
    minX: Math.min(...displays.map(d => d.x)),
    minY: Math.min(...displays.map(d => d.y)),
    maxX: Math.max(...displays.map(d => d.x + d.width)),
    maxY: Math.max(...displays.map(d => d.y + d.height)),
  };
}

export function clampCompanionWidth(width: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(width), min), max);
}

// Growing the companion (scroll-wheel) is capped to a fraction of the screen she's
// actually on, not just the flat ceiling above: a size that reads as reasonable on
// a desktop monitor can exceed a small laptop panel outright. `Math.max(…, min)`
// guards a pathologically narrow display from producing a ceiling below the floor.
export function clampCompanionWidthOnDisplay(width: number, min: number, max: number, displayWorkAreaWidth: number, maxFraction: number) {
  const displayCeiling = Math.max(Math.round(displayWorkAreaWidth * maxFraction), min);
  return Math.min(clampCompanionWidth(width, min, max), displayCeiling);
}

// A fresh install or an off-screen recovery gets a width relative to the primary
// display's work area, capped at `preferred` — a small laptop panel gets a corner
// companion that doesn't dominate the screen, while any display at or above
// roughly preferred/fraction in width is unaffected and keeps the familiar size.
export function defaultCompanionWidth(displayWorkAreaWidth: number, preferred: number, fraction: number, min: number, max: number) {
  return clampCompanionWidth(Math.min(preferred, Math.round(displayWorkAreaWidth * fraction)), min, max);
}

export function clampCompanionPosition(x: number, y: number, width: number, height: number, displays: DisplayBounds[], margin: number) {
  const { minX, minY, maxX, maxY } = combinedDisplayBounds(displays);
  return {
    x: Math.min(Math.max(x, minX - width + margin), maxX - margin),
    y: Math.min(Math.max(y, minY - height + margin), maxY - margin),
  };
}

// True when a window at `bounds` is no longer positioned/sized validly against
// `displays` — i.e. clamping it would actually move or resize it. Used to make
// the live display-change handler idempotent: `display-metrics-changed` fires for
// DPI/scale/rotation changes anywhere, including on a display the companion isn't
// on, so it must only touch the window when clamping would change something.
// `aspect` must be the same constant the caller's own setBounds derives height
// from (COMPANION_ASPECT) — deriving height from `bounds.height / bounds.width`
// instead reads back whatever the OS actually gave the window (frame/DPI
// rounding can drift this a pixel or two off the nominal ratio), which both
// checks a different position-clamp boundary than the executor will use and
// can never notice the drift itself, since nothing then compares against it.
export function companionNeedsReclamp(bounds: Bounds, displays: DisplayBounds[], margin: number, widthMin: number, widthMax: number, aspect: number): boolean {
  const width = clampCompanionWidth(bounds.width, widthMin, widthMax);
  const height = Math.round(width * aspect);
  const { x, y } = clampCompanionPosition(bounds.x, bounds.y, width, height, displays, margin);
  return x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height;
}

// Battery halves the poll rate rather than pausing it outright: eye-follow is
// cheap enough per-tick that halving the wakeups is most of the available saving,
// and pausing entirely would make the companion visibly stop tracking the cursor
// the moment the charger comes out.
export function cursorPollIntervalMs(onBattery: boolean, acMs: number, batteryMs: number) {
  return onBattery ? batteryMs : acMs;
}
