// The decisions that follow the power source, kept pure so they can be checked
// without a battery, a plug or a compositor.
//
// Both of these are the difference between a desktop and a laptop: how long the
// local model is held in the card's memory, and how often the pointer is read
// when nobody is moving it. Neither wants an Electron dependency to answer.

/** On mains: an always-on box does nothing else with that VRAM. */
export const KEEP_ALIVE_MAINS = -1;
/** On battery: long enough that a reply still starts talking, short enough that
 *  the card is released between conversations. */
export const KEEP_ALIVE_BATTERY = '5m';

/**
 * What to ask Ollama for. `HARU_OLLAMA_KEEP_ALIVE` wins over both if set — as
 * seconds ("0" unloads between turns) or a Go duration ("10m").
 */
export function resolveKeepAlive(override: string | undefined, onBattery: boolean): number | string {
  const value = (override ?? '').trim();
  if (value) return /^-?\d+$/.test(value) ? Number(value) : value;
  return onBattery ? KEEP_ALIVE_BATTERY : KEEP_ALIVE_MAINS;
}

export const CURSOR_POLL_ACTIVE_MS = 33;
export const CURSOR_POLL_IDLE_MS = 250;
export const CURSOR_IDLE_AFTER_S = 30;

/**
 * How long to wait before reading the pointer again. Following it is what makes
 * her feel present, but a thirty-hertz poll of the whole screen for a cursor
 * that is not moving is a battery cost with nothing to show for it.
 */
export function cursorPollDelay(
  idleSeconds: number,
  activeMs = CURSOR_POLL_ACTIVE_MS,
  idleMs = CURSOR_POLL_IDLE_MS,
  idleAfterS = CURSOR_IDLE_AFTER_S,
): number {
  return idleSeconds >= idleAfterS ? idleMs : activeMs;
}
