import {screenPolicy} from './core-screen-policy';
// Noticing that you took a screenshot.
//
// Deliberately local-only, and not configurable to be otherwise. Screenshots are
// the most sensitive pictures on a machine — passwords, bank details, private
// messages, half-written emails — and unlike showing her a photograph, this
// fires without anybody choosing the image first. Sending those to a company
// automatically is not a trade worth offering, so the looking stays on this
// machine whatever the chat model is set to.

export type ScreenshotConfig = {
  enabled: boolean;
  /** Where the operating system drops them. Empty means the usual place. */
  folder: string;
  /** Minutes she must leave between remarks, however many are taken. */
  quietMinutes: number;
};

export const DEFAULT_SCREENSHOTS: ScreenshotConfig = { enabled: false, folder: '', quietMinutes: 3 };

export function readScreenshotConfig(saved: unknown): ScreenshotConfig {
 return screenPolicy('screenshots',[saved]);
}

const PICTURE = /\.(png|jpe?g)$/i;

/** Windows writes the file before it has finished writing it, so a watcher that
 *  reads immediately gets a truncated image. Settled means the size stopped
 *  changing between two looks. */
export const SETTLE_MS = 400;
export const SETTLE_TRIES = 12;

export function looksLikeScreenshot(name: string): boolean {
 return screenPolicy('looks',[name]);
}

/**
 * Whether she may remark on this one.
 *
 * Bursts are the normal way people screenshot — three of a conversation, five of
 * a bug — and a companion who says something about each is unusable. One remark
 * per quiet period, and the newest image wins, because by the time she speaks
 * the interesting one is the last.
 */
export function maySpeak(config: ScreenshotConfig, lastSpokeAt: number, now: number): boolean {
 return screenPolicy('maySpeak',[config,lastSpokeAt,now]);
}

/**
 * What she is told about it. Framed as having glanced at their screen, because
 * that is what happened — she is not being handed a photograph to admire, she
 * noticed something go past.
 */
export function screenshotPrompt(description: string, name: string): string {
 return screenPolicy('shotPrompt',[description,name]);
}
