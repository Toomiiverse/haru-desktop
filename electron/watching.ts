// Actually watching you play.
//
// The window title is all she has had, and for a Telltale game that title is the
// publisher — so she has spent an evening saying "Telltale Games" at somebody
// playing The Walking Dead. A title tells you which program is open; it tells you
// nothing about what is happening in it.
//
// So this looks at the screen every few minutes and lets her say something about
// what she saw. Three costs make the design, and all three push the same way:
// looking costs GPU at exactly the moment the GPU is busiest, remarks cost
// attention during something you cannot pause, and a screen capture is the most
// invasive thing in the app. Rare, local, and off unless asked for.

export type WatchingConfig = {
  enabled: boolean;
  /** Minutes between looks. */
  everyMinutes: number;
  /** Only while something is detected as a game, rather than at any screen. */
  gamesOnly: boolean;
};

export const DEFAULT_WATCHING: WatchingConfig = { enabled: false, everyMinutes: 5, gamesOnly: true };

export function readWatchingConfig(saved: unknown): WatchingConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_WATCHING;
  const record = saved as Partial<WatchingConfig>;
  const everyMinutes = typeof record.everyMinutes === 'number' ? Math.max(2, Math.min(30, Math.round(record.everyMinutes))) : DEFAULT_WATCHING.everyMinutes;
  return { enabled: record.enabled === true, everyMinutes, gamesOnly: record.gamesOnly !== false };
}

/**
 * A capture wide enough to read a scene and small enough to think about quickly.
 *
 * 1280 across is the trade. The vision model's cost rises with pixels, this runs
 * while a game has the card, and nothing she needs to notice — who is on screen,
 * whether it is a menu, what the mood is — survives at 1280 but dies at 1920.
 */
export const CAPTURE_WIDTH = 1280;
export const CAPTURE_HEIGHT = 720;

export type Look = { at: number; description: string };

/**
 * Whether to take a look now.
 *
 * Deliberately several separate reasons to say no. The one that matters most is
 * the last: she must never be looking while she is already talking, because the
 * remark would arrive on top of the previous one.
 */
export function shouldLook(config: WatchingConfig, lastLookAt: number, now: number, gameOn: boolean, speaking: boolean): boolean {
  if (!config.enabled) return false;
  if (config.gamesOnly && !gameOn) return false;
  if (speaking) return false;
  return now - lastLookAt >= config.everyMinutes * 60_000;
}

/**
 * Whether what she saw is worth saying anything about.
 *
 * Most looks are not. A pause menu, a loading screen, an inventory, the same
 * corridor as four minutes ago — a companion who remarks on every one of those
 * is worse than one who says nothing, so the bar is "something is actually
 * happening" and the default is silence.
 */
const DULL = /\b(loading|please wait|main menu|pause menu|title screen|settings|options menu|black screen|blank|desktop|taskbar|no visible|nothing (is )?happening|empty)\b/i;

export function worthMentioning(description: string, previous: string): boolean {
  if (!description.trim()) return false;
  if (DULL.test(description)) return false;
  // Nearly the same scene as last time is not news. Compared on content words so
  // a shifted camera on the same corridor still counts as the same corridor.
  const words = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 3));
  const now = words(description);
  const before = words(previous);
  if (!before.size || !now.size) return true;
  const shared = [...now].filter(word => before.has(word)).length;
  return shared / now.size < 0.7;
}

/**
 * What she is told about what she saw.
 *
 * Framed as glancing over at their screen, because that is the fiction that
 * makes it bearable — not "here is a frame captured from your display", which is
 * both true and horrible.
 *
 * The hard part is not getting her to talk about the scene, it is stopping her
 * narrating it. Asked to say something about what is happening, she reliably
 * says what is happening — "they're hiding from walkers on the street" — which
 * is information the person playing already has, delivered by someone who was
 * meant to be reacting. So the instruction is not "comment on this", it is
 * "have an opinion about this", and the description is given to her as something
 * she has already seen rather than as the subject.
 */
/**
 * Seeing and reacting in one call.
 *
 * It used to be two: the vision model described the screen, then the chat model
 * wrote the line. Measured end to end that was eleven seconds, and only about a
 * second of it was work — gemma4 and the chat model are 8.5GB and 10GB against a
 * 16GB card, so each glance evicted one to load the other and then evicted it
 * back. A glance that arrives eleven seconds late is not a reaction to anything;
 * the scene has moved on and she is talking about the last room.
 *
 * One model, one call, and it holds its place in memory between glances: about a
 * second, measured.
 *
 * Both lines are needed. The description is not decoration — it is what decides
 * whether she speaks at all, since the dull-screen and same-scene filters run on
 * it. Asking for it first turned out to help the remark too: made to name what
 * it was looking at before reacting, the model stopped falling back on a stock
 * phrase, and distinct lines over eight runs went from 5/8 to 10/10.
 */
export function glancePrompt(title: string): string {
  return [
    `They are playing something${title ? ` — it is ${title}` : ''}, and you have just looked over at their screen.`,
    'Reply with exactly two lines and nothing else:',
    'SCENE: what is actually on screen, one plain sentence, no opinion.',
    'SAY: one short line — the thing you would say out loud watching this.',
    'The SAY line reacts, it does not narrate. They are looking at the same screen you are, so telling them what is on it is worse than saying nothing — have an opinion, take a side, wind them up, be unimpressed, worry at them about it.',
    'React to the scene in front of you, not to the name of the game. Never mention screenshots, captures, images or descriptions, and never ask them to explain the plot.',
  ].join(' ');
}

/**
 * Pulls the two lines back apart.
 *
 * Deliberately forgiving about spacing, case and quoting, and deliberately
 * unforgiving about a missing SAY: a half-parsed reply would have her read the
 * scene description out loud, which is the exact failure the prompt is for. No
 * SAY means she says nothing.
 */
export function splitGlance(reply: string): { scene: string; say: string } {
  const find = (label: string) => new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im').exec(reply)?.[1]?.trim() ?? '';
  return {
    scene: find('SCENE'),
    say: find('SAY').replace(/^["'“”]+|["'“”]+$/g, '').trim(),
  };
}

export function watchingPrompt(description: string, title: string): string {
  return [
    `They are playing something${title ? ` — the window is called "${title}"` : ''}, and you have just looked over at their screen.`,
    'You saw this:',
    description,
    'Say one short line — the thing you would actually say out loud watching this over their shoulder.',
    // The failure this whole prompt exists to prevent.
    'React to it. Do not narrate it. They are looking at the same screen you are, so telling them what is on it is worse than saying nothing — have an opinion, take a side, wind them up, be unimpressed, worry at them about it.',
    'React to the scene in front of you, not to the name of the game. Never mention screenshots, captures, images or descriptions, and never ask them to explain the plot.',
    'One line. A small remark is fine; a summary is not.',
  ].join(' ');
}
