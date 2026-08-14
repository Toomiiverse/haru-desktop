// The movement that happens when nothing is happening.
//
// A model that only moves when told to sits perfectly still between beats, and
// perfectly still reads as switched off rather than as calm. This is the layer
// that keeps her alive in the gaps: breathing, weight shifting, the small
// constant adjustments a person makes without deciding to.
//
// Built from sines at deliberately incommensurate frequencies. Anything on
// related frequencies resynchronises on a short cycle, and a loop the eye can
// spot is worse than no motion at all — it reads as a machine idling rather than
// a person waiting. The ratios here share no small common factor, so the
// combined pattern takes many minutes to come close to repeating.
//
// Applied before physics, which is what makes it worth doing: the model's own
// physics rig turns body movement into hair, clothes and accessory motion for
// free, so a few degrees of sway buys far more than a few degrees of sway.

/** Only the parts of her state that should change how she carries herself. */
export type IdleVitals = { energy: number; sleepiness: number; stress: number };

export type IdleMotion = {
  /** 0..1, the model's own breath parameter. */
  breath: number;
  /** Degrees, added to whatever tracking and gestures already wanted. */
  bodyX: number;
  bodyY: number;
  bodyZ: number;
  headX: number;
  headY: number;
  headZ: number;
  /** 0..1, how hard the tail should be wagging. */
  tail: number;
  /**
   * Where she should actually be, as a fraction of the stage. Her rig has no
   * parameter that moves her — body X/Y/Z are rotations about the hips — so a
   * bounce built out of them is not a bounce, it is a torso rocking on its axis.
   * These move the whole sprite instead.
   */
  driftX: number;
  bounceY: number;
};

const TAU = Math.PI * 2;

function wave(seconds: number, hz: number, phase: number) {
  return Math.sin(TAU * hz * seconds + phase);
}

/**
 * A sine with a second harmonic folded in. A pure sine turns around gently at
 * both extremes, which reads as floating; adding the overtone sharpens the
 * turnaround and leaves a little overshoot behind it, which is what makes the
 * same amplitude read as spring rather than drift. It is also what the physics
 * rig responds to — a sharper change in angle throws the hair and skirt harder
 * than a slow one of the same size.
 */
function springy(seconds: number, hz: number, phase: number) {
  return (Math.sin(TAU * hz * seconds + phase) + Math.sin(TAU * hz * 2 * seconds + phase + 0.6) * 0.4) / 1.4;
}

// Roughly 13 breaths a minute at rest, rising with effort. Kept as its own
// figure because breathing is the one channel a viewer will notice is wrong.
const BREATH_HZ = 0.22;

/**
 * How much she moves at all. Tired shrinks everything toward stillness; stress
 * adds a little restlessness rather than energy, which is the difference between
 * fidgeting and being lively.
 */
export function liveliness({ energy, sleepiness, stress }: IdleVitals) {
  return Math.max(0.15, Math.min(1.25, 0.4 + energy * 0.7 - sleepiness * 0.45 + stress * 0.15));
}

export function idleMotion(elapsedMs: number, vitals: IdleVitals): IdleMotion {
  const t = elapsedMs / 1000;
  const scale = liveliness(vitals);
  // Breathing quickens with energy and stress but never stops.
  const breathHz = BREATH_HZ * (0.75 + vitals.energy * 0.4 + vitals.stress * 0.25);

  // Slow lateral drift is the weight shift — leaning on one leg, then the other.
  const shift = springy(t, 0.037, 0.7);
  const drive = Math.max(0, vitals.energy - vitals.sleepiness * 0.8);
  // The vertical channel, and the one that has to stay small.
  //
  // It was written as a bounce on the belief that the physics rig would throw
  // hair and skirt from it, the way the rotations do. It does not: this ends up
  // on the sprite's position rather than on a parameter, and the rig only ever
  // sees parameters. So it bought none of the secondary motion it was paying
  // for, and all that was left was the movement itself — a whole character
  // sliding up and down the screen with her hair hanging perfectly still, which
  // reads as a sprite being animated rather than as a person standing there.
  //
  // Now it is just the lift of breathing: the same frequency as the breath, a
  // plain sine rather than the springy overtone that made the turnaround snap,
  // and roughly a quarter of the travel. Everything that actually carries life
  // is in the rotations below, which do reach the rig.
  const lift = wave(t, breathHz, 1.1) * (0.6 + drive * 0.4);

  return {
    // Offset to 0..1: the parameter is a lung, not a pendulum, so it should
    // never read as negative.
    breath: (wave(t, breathHz, 0) + 1) / 2,
    // Rotations stay modest. These are angles about the hips, and pushed hard
    // they read as a torso swivelling rather than a person moving — and with
    // cursor tracking added on top they reach the rig's limit and stick there,
    // which looks like she is jammed against something.
    bodyX: (shift * 2.2 + springy(t, 0.079, 1.3) * 1.3) * scale,
    // Pitch, not height: leaning fractionally forward and back. The bounce
    // deliberately does not come through here.
    bodyY: (wave(t, 0.053, 2.6) * 1.1) * scale,
    bodyZ: (shift * 1.2 + springy(t, 0.067, 0.2) * 0.7) * scale,
    // The head counters the body rather than following it — a person swaying
    // keeps their head roughly level, and matching the two exactly is what makes
    // a model look like it is being moved rather than moving.
    headX: (springy(t, 0.091, 4.1) * 2.0 - shift * 1.1) * scale,
    headY: (wave(t, 0.113, 0.9) * 1.5) * scale,
    headZ: (springy(t, 0.061, 3.3) * 1.7 - shift * 0.8) * scale,
    // Her rig wires the tail wag straight into physics, so this costs one
    // parameter and buys constant motion down her whole back.
    tail: Math.max(0, Math.min(1, 0.35 + drive * 0.65)),
    // In fractions of the stage. The lateral drift is unchanged — a slow lean is
    // what standing still actually looks like — but the vertical is now a
    // fraction of what it was, closer to a chest rising than to a bob.
    driftX: shift * 0.009 * scale,
    bounceY: lift * 0.003 * scale,
  };
}
