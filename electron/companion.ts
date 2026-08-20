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

// The single source of truth for "what should the companion's bounds be right
// now", used identically to decide whether a reclamp is needed and to perform
// one — so the two can never disagree about what "correct" means, which is
// exactly the bug an earlier version of this function had (see git history:
// the guard derived height from the window's own possibly-drifted bounds ratio
// while the executor derived it from the fixed aspect constant).
//
// `preferredWidth` is the size the user actually asked for — via an explicit
// scroll-wheel resize, or whatever was last on record — never a value an
// earlier automatic reclamp produced. Feeding a shrunk-to-fit width back in as
// next call's "preferred" would ratchet the size down a little more on every
// undock, with no way back to the original on redock.
//
// Anchored at bottom-center, matching the model's own anchor point, so
// growing/shrinking feels like the character scaling in place rather than
// jumping — including at launch, where `current` is the last saved bounds.
export function effectiveCompanionBounds(
  current: Bounds,
  preferredWidth: number,
  matchingDisplayWorkAreaWidth: number,
  allDisplays: DisplayBounds[],
  margin: number,
  widthMin: number,
  widthMax: number,
  maxFraction: number,
  aspect: number,
): Bounds {
  const width = clampCompanionWidthOnDisplay(preferredWidth, widthMin, widthMax, matchingDisplayWorkAreaWidth, maxFraction);
  const height = Math.round(width * aspect);
  const centerX = current.x + current.width / 2;
  const bottom = current.y + current.height;
  const { x, y } = clampCompanionPosition(Math.round(centerX - width / 2), Math.round(bottom - height), width, height, allDisplays, margin);
  return { x, y, width, height };
}

// True when `next` (an effectiveCompanionBounds result) actually differs from
// `current` — i.e. applying it would move or resize the window. Used to make
// the live display-change handler idempotent: `display-metrics-changed` fires
// for DPI/scale/rotation changes anywhere, including on a display the
// companion isn't on, so it must only touch the window when something would
// actually change.
export function companionNeedsReclamp(current: Bounds, next: Bounds): boolean {
  return current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height;
}

// Battery halves the poll rate rather than pausing it outright: eye-follow is
// cheap enough per-tick that halving the wakeups is most of the available saving,
// and pausing entirely would make the companion visibly stop tracking the cursor
// the moment the charger comes out.
export function cursorPollIntervalMs(onBattery: boolean, acMs: number, batteryMs: number) {
  return onBattery ? batteryMs : acMs;
}
