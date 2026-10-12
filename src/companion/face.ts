// How a face changes its mind.
//
// Taken frame by frame from a Zenless expression test (blender/reference-faces.md):
// a change of expression is not a crossfade. The eyes go first, the brows two
// frames later, the mouth two after that; each moves in pulses of two frames
// with a still frame between, which is what makes it read as animation rather
// than as a blend. Between two expressions that are both "something", she
// blinks, and the swap happens under the closed lids. The head is the slowest
// layer and always finishes last.
//
// This knows nothing about three.js or VRM. It takes a clock and hands back
// weights, a blink, and a head turn; whoever owns the model applies them.

export type HeadTurn = { yaw: number; pitch: number };
export type FaceOutput = {
  /** Expression name -> weight. Includes the outgoing face at whatever it has faded to, so a caller can apply every entry and never leaves a stale one on. */
  weights: Record<string, number>;
  /** The cut's blink, 0-1. Take the max with the idle blink; do not add. */
  blink: number;
  /** Additive, in degrees. yaw > 0 turns toward her left, pitch > 0 drops the chin. */
  head: HeadTurn;
};
/** The one question asked of the model: does an expression by this name exist. */
export type FaceModel = { has(name: string): boolean };

export const PARTS = ['eyes', 'brows', 'mouth'] as const;
export const FRAME_MS = 1000 / 30;
// Twos at 30fps. A pulse is two frames; a channel takes two pulses to arrive.
export const STEP_MS = 2 * FRAME_MS;
export const RAMP_MS = 4 * FRAME_MS;
export const STAGGER_MS = 2 * FRAME_MS;
export const BLINK_CLOSE_MS = 2 * FRAME_MS;
export const BLINK_HOLD_MS = 2 * FRAME_MS;
export const BLINK_OPEN_MS = 2 * FRAME_MS;
// The head starts after the eyes and eases out over most of half a second.
export const HEAD_DELAY_MS = 2 * FRAME_MS;
export const HEAD_MS = 400;

export const NO_TURN: HeadTurn = { yaw: 0, pitch: 0 };

// Every held face in the reference had its own head angle: turned away and up
// for talking, swung and tilted for laughing, straight on and down for the pout,
// three-quarter and lowered for the glare. These are the moods the idle layer
// speaks, given a head to go with them.
export const HEAD_FOR_MOOD: Record<'neutral' | 'happy' | 'sleepy' | 'curious', HeadTurn> = {
  neutral: NO_TURN,
  happy: { yaw: 12, pitch: -4 },
  sleepy: { yaw: 4, pitch: 10 },
  curious: { yaw: -10, pitch: -5 },
};

/** Progress quantised to pulses: with two steps, 0 then 0.5 then 1, never 0.37. */
export function stepped(progress: number, steps = 2): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return Math.floor(progress * steps + 1e-9) / steps;
}

/** The channels an expression is driven through: its parts if the model ships them, else the whole face as one. */
export function channelsOf(model: FaceModel, name: string | null): string[] {
  if (name === null) return [];
  const parts = PARTS.map(part => `${name}.${part}`).filter(part => model.has(part));
  return parts.length ? parts : [name];
}

function easeOut(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return 1 - (1 - c) ** 3;
}

export class FaceDriver {
  private shown: string | null = null;
  private target: string | null = null;
  private startedAt = -Infinity;
  private cut = false;
  private headFrom: HeadTurn = NO_TURN;
  private headTo: HeadTurn = NO_TURN;

  constructor(private readonly model: FaceModel) {}

  /** Begin moving to an expression (null is a bare face). Calling again mid-move treats where she was heading as where she is. */
  show(name: string | null, head: HeadTurn = NO_TURN, now: number): void {
    if (name === this.target && head.yaw === this.headTo.yaw && head.pitch === this.headTo.pitch) return;
    this.headFrom = this.headAt(now);
    this.shown = this.target;
    this.target = name;
    this.startedAt = now;
    // A blink hides the distance between two real faces. Coming from or going
    // to nothing, there is no distance to hide, and a blink would read as a tic.
    this.cut = this.shown !== null && name !== null && this.shown !== name;
    this.headTo = head;
  }

  get current(): string | null {
    return this.target;
  }

  update(now: number): FaceOutput {
    const t = now - this.startedAt;
    const weights: Record<string, number> = {};

    let blink = 0;
    if (this.cut) {
      if (t < BLINK_CLOSE_MS) blink = stepped(t / BLINK_CLOSE_MS);
      else if (t < BLINK_CLOSE_MS + BLINK_HOLD_MS) blink = 1;
      else if (t < BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS) blink = 1 - stepped((t - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS);
    }
    // Under a cut the channels wait for the lids; otherwise they go at once.
    const local = t - (this.cut ? BLINK_CLOSE_MS : 0);

    const incoming = channelsOf(this.model, this.target);
    const outgoing = channelsOf(this.model, this.shown);
    // Same name both ways happens when only the head changed: hold the face.
    const sameFace = this.shown === this.target;
    incoming.forEach((channel, i) => {
      weights[channel] = sameFace ? 1 : stepped((local - i * STAGGER_MS) / RAMP_MS);
    });
    outgoing.forEach((channel, i) => {
      if (sameFace) return;
      const gone = stepped((local - i * STAGGER_MS) / RAMP_MS);
      weights[channel] = Math.min(weights[channel] ?? 1, 1 - gone);
    });

    const hp = easeOut((t - HEAD_DELAY_MS) / HEAD_MS);
    const head = {
      yaw: this.headFrom.yaw + (this.headTo.yaw - this.headFrom.yaw) * hp,
      pitch: this.headFrom.pitch + (this.headTo.pitch - this.headFrom.pitch) * hp,
    };
    return { weights, blink, head };
  }

  private headAt(now: number): HeadTurn {
    return this.update(now).head;
  }
}
