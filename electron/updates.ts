// Getting the next version onto a machine that is not this one.
//
// She is developed on one desktop and also lives on a laptop, and until now the
// only way the laptop saw a change was somebody copying an installer to it. The
// server has never had this problem — update.sh pulls, builds and restarts it —
// but that path needs a git checkout and a toolchain, which is not what a laptop
// running the packaged app has.
//
// So the packaged app checks a feed and replaces itself. Where that feed is
// lives in electron-builder.config.cjs, because the same setting has to decide
// where a build is published and where it later looks: two settings would be two
// places to get it wrong, and getting it wrong is silent — the laptop would poll
// an address nothing was ever uploaded to and report, quite correctly, that it is
// up to date.
//
// Nothing here restarts her. A companion that vanishes mid-sentence to install
// something is worse than one that is a week behind, so the download happens
// quietly and the swap happens on the next quit, which is a moment the user chose.

/** What the window is told, and all it is told. */
export type UpdateState =
  | { stage: 'idle' }
  /** Asking the feed. Never surfaced loudly — this is the common case and it is boring. */
  | { stage: 'checking' }
  | { stage: 'current' }
  | { stage: 'downloading'; version: string; percent: number }
  /** On disk and waiting for a quit she will not perform herself. */
  | { stage: 'ready'; version: string }
  | { stage: 'failed'; because: string };

/**
 * Whether checking is worth doing at all.
 *
 * Running from source there is no installer to replace, and electron-updater
 * does not merely decline — it throws on the app-update.yml that only exists
 * inside a packaged build. Every developer meets this once and concludes the
 * feature is broken, so it is refused here with a reason rather than left to
 * fail somewhere less obvious.
 */
export function whyNotCheck(packaged: boolean, platform: string): string | null {
  if (!packaged) return 'running from source — there is no installer to replace';
  // Linux has no packaged target here, and the server updates itself by pulling
  // and rebuilding, which is a better mechanism than this one anyway.
  if (platform !== 'win32') return `nothing is packaged for ${platform} — update by pulling and rebuilding`;
  return null;
}

/** How often a long-running companion asks again. */
export const CHECK_EVERY_MS = 24 * 60 * 60_000;

/**
 * A download reported at a rate a person can read.
 *
 * The progress event fires many times a second; forwarding all of them across
 * the bridge to move a number is a lot of traffic for something nobody is
 * watching. Whole percents are as fine-grained as this is ever displayed.
 */
export function progressStep(previous: number, percent: number): number | null {
  const now = Math.max(0, Math.min(100, Math.round(percent)));
  return now === previous ? null : now;
}

/**
 * What the settings panel says about it.
 *
 * Deliberately quiet at both ends. "Up to date" is the answer to a question
 * nobody asked, and a failure to reach the feed is not something the user can
 * act on — she still works, she is simply the version she already was.
 */
export function describeUpdate(state: UpdateState, version: string): string {
  switch (state.stage) {
    case 'checking': return 'Checking for a newer version…';
    case 'downloading': return `Downloading ${state.version} — ${state.percent}%`;
    case 'ready': return `Version ${state.version} is ready. It will finish installing next time you close her.`;
    case 'failed': return `Could not check for updates — ${state.because}. She still works; this is version ${version}.`;
    case 'current':
    case 'idle':
    default: return `Version ${version}.`;
  }
}
