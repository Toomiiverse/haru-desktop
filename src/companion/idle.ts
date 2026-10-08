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

/** Small physics steps keep follow-through consistent on slow and fast displays. */
export function settleSpring(value: number, speed: number, target: number, stiffness: number, damping: number, dt: number): [number, number] {
  if (!Number.isFinite(dt) || dt <= 0 || dt > .1) return [value, 0];
  const steps = Math.ceil(dt * 120), step = dt / steps;
  for (let i = 0; i < steps; i++) {
    speed += ((target - value) * stiffness - speed * damping) * step;
    value += speed * step;
  }
  return [value, speed];
}

/** Head motion drives local lag; gravity keeps a held tilt from looking rigid. */
export function hairMotionTarget(roll: number, turn: number, vx: number, vy: number, ear: boolean, side: number, limit: number) {
  const angle = -roll * (ear ? .18 : .45) - turn * (ear ? .085 : .13)
    - vx * (ear ? .012 : .022) + vy * side * (ear ? .012 : .018);
  return { angle: Math.max(-limit, Math.min(limit, angle)),
    stretch: Math.max(-.025, Math.min(.025, -vy * (ear ? .00004 : .00012))) };
}

/** Bounded directional stretch, in avatar lengths per second, independent of screen size. */
export function dragMotionTarget(vx: number, vy: number, size: number, held: boolean): number[] {
  if (!held || ![vx, vy, size].every(Number.isFinite) || size <= 0) return [1, 0, 1, 0];
  const speed = Math.hypot(vx, vy), amount = Math.min(.3, speed / size * .045);
  const x = speed ? vx / speed : 0, y = speed ? vy / speed : 0;
  return [.97 + amount * (2 * x * x - 1), amount * 2 * x * y,
    1.03 + amount * (2 * y * y - 1), Math.max(-12, Math.min(12, vx / size * 1.8))];
}

/** Depth has a reason: attention or rest; gaze turns never change her size. */
export function depthMotionTarget(time: number, x: number, y: number, attentive: boolean, quiet: boolean): number[] {
  if (![time, x, y].every(Number.isFinite)) return [0, 0, 0];
  return [attentive ? .1 : quiet ? -.04 : 0,
    -Math.max(-1, Math.min(1, y)) * 7,
    Math.max(-1, Math.min(1, x)) * 10];
}

/** Buoyant local hover; mood changes the pace without choosing a new destination. */
export function fairyMotion(time: number, emotion: string, speaking: number) {
  const t = Number.isFinite(time) ? time / 1000 : 0;
  const talk = Number.isFinite(speaking) ? Math.max(0, Math.min(1, speaking)) : 0;
  const angry = ['angry','rage','annoyed','irritated'].includes(emotion);
  const happy = ['happy','excited','playful','triumph','laughing','silly'].includes(emotion);
  const quiet = ['sleepy','drowsy','sad','disappointed','sick','crying','content'].includes(emotion);
  const curious = ['curious','thinking','pensive','confused','skeptical'].includes(emotion);
  const pace = angry ? 2.8 : happy ? 1.7 : quiet ? .4 : curious ? .85 : 1;
  const amount = (quiet ? .38 : happy || angry ? 1 : .7) * (1 - talk * .8);
  const burst = .3 + .7 * Math.pow(Math.max(0, Math.sin(t * .32)), 2);
  const phase = t * pace;
  const lift = Math.sin(phase * 1.65) * .075 + Math.sin(phase * 3.3 + .65) * .009;
  const hop = happy ? -Math.pow(Math.abs(Math.sin(phase * 2.2)), 1.5) * .09 : lift;
  const dart = angry ? Math.tanh(Math.sin(phase * .55) * 2.5) : Math.sin(phase * .47);
  const breath = (Math.sin(t * 1.3) + 1) / 2;
  return { x: (Math.sin(phase * .825 + .7) * .035 + Math.sin(phase * 1.65) * .009) * amount, y: hop * amount,
    z: Math.sin(phase * .53) * .12 * amount, bank: Math.cos(phase * .825 + .7) * (angry ? 7 : happy ? 4.5 : 3) * amount,
    flightX: dart * amount * burst, flightY: Math.sin(phase * (curious ? .47 : .31) + 1) * amount * burst,
    glow: .12 + breath * .13 + burst * amount * .11 + talk * .04 };
}

/** Frame-rate independent jaw attack/release follows audio, never a fake syllable clock. */
export function speechJaw(open: number, weight: number, previous: number, dt: number): number {
  const target = Number.isFinite(open) && Number.isFinite(weight) ? Math.max(0, Math.min(1, open)) * Math.max(0, Math.min(1, weight)) : 0;
  if (!Number.isFinite(dt) || dt <= 0) return previous;
  return previous + (target - previous) * (1 - Math.exp(-Math.min(dt, .1) / (target > previous ? .035 : .085)));
}

/** Actual travel/deformation and audio feed a fast attack, soft release envelope. */
export function glowMotion(previous: { phase: number; energy: number; voice: number; intensity: number }, dt: number,
  emotion: string, speed: number, audio: number, rest: number) {
  const unit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  const step = Number.isFinite(dt) && dt > 0 && dt <= .1 ? dt : 0;
  const asleep = unit(rest);
  const follow = (value: number, target: number, attack: number, release: number) =>
    value + (target - value) * (1 - Math.exp(-step / (target > value ? attack : release)));
  const energy = follow(previous.energy, unit(speed / 1.8), .07, .42);
  const voice = follow(previous.voice, unit(audio), .028, .14);
  const angry = ['angry', 'rage', 'annoyed', 'irritated'].includes(emotion);
  const lively = ['happy', 'excited', 'playful', 'triumph', 'laughing'].includes(emotion);
  const hz = ((angry ? .52 : lively ? .30 : .22) + energy * .14) * (1 - asleep) + asleep / 5.4;
  const phase = (previous.phase + step * hz * TAU) % TAU;
  const breath = (1 - Math.cos(phase)) / 2;
  const awake = .025 + breath * (angry ? .14 : .045) + energy * .43 + voice * (angry ? .36 : .30);
  const intensity = follow(previous.intensity, Math.min(.92, awake * (1 - asleep) + (.005 + breath * .009) * asleep), .045, .18);
  return { phase, energy, voice, intensity, breath };
}

/** Presentation only: breathing, fighting a nod, and an occasional dream twitch. */
export function sleepMotion(time: number, level: number, breathing?: number) {
  const t = Number.isFinite(time) ? time / 1000 : 0;
  const amount = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const breath = breathing ?? (1 - Math.cos(t * Math.PI * 2 / 5.4)) / 2;
  const nod = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 13)), 10);
  const dream = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 19)), 32) * Math.sin(t * 17);
  const tired = Math.max(0, 1 - Math.max(0, amount - .55) / .45);
  const yawn = tired * Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 23 + 2)), 18);
  return { lift: amount * (-.014 * breath + .025 * nod * tired - .018 * yawn),
    roll: amount * (2.2 + Math.sin(t * .39) * 1.1 + nod * tired * 5),
    stretch: 1 + amount * (.018 * breath - .025 * nod * tired + .035 * yawn),
    lid: 1 - amount * Math.min(.98, .25 + .73 * nod * tired + .7 * yawn),
    ear: amount * (2.4 + dream * 1.5), glow: .14 + breath * .075 };
}

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

/**
 * How much of the idle drift to take away while she is talking, 0 to 1.
 *
 * Someone speaking to you is not standing there swaying. The slow channels here
 * — the weight shift from one leg to the other, the long lean, the sprite drift
 * across the stage — are what standing about looks like, and running them under
 * speech is what reads as floaty: she appears to be idling with a voice coming
 * out of her rather than addressing anyone.
 *
 * Deliberately not a mute. Speech is not less movement, it is different
 * movement: the slow sways go and the small quick ones come up, because a person
 * making a point moves their head more, not less, just faster and over a shorter
 * distance. Damping everything equally would swap floaty for embalmed.
 */
const SETTLE_SLOW = 0.85;
const SETTLE_QUICK = 0.3;

export function idleMotion(elapsedMs: number, vitals: IdleVitals, speaking = 0): IdleMotion {
  const t = elapsedMs / 1000;
  const settle = Math.max(0, Math.min(1, speaking));
  // The slow, wandering channels lose most of their travel.
  const slow = 1 - settle * SETTLE_SLOW;
  // The fast ones gain a little, so what is left reads as emphasis.
  const quick = 1 + settle * SETTLE_QUICK;
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
    // shift is the weight change from leg to leg — the slowest thing here and
    // the single biggest contributor to looking adrift. It is what goes first.
    bodyX: (shift * 2.2 * slow + springy(t, 0.079, 1.3) * 1.3 * quick) * scale,
    // Pitch, not height: leaning fractionally forward and back. The bounce
    // deliberately does not come through here.
    // The long forward-and-back lean, slower still than the weight shift.
    bodyY: (wave(t, 0.053, 2.6) * 1.1 * slow) * scale,
    bodyZ: (shift * 1.2 * slow + springy(t, 0.067, 0.2) * 0.7 * quick) * scale,
    // The head counters the body rather than following it — a person swaying
    // keeps their head roughly level, and matching the two exactly is what makes
    // a model look like it is being moved rather than moving.
    // Head keeps most of its own motion — this is where speech actually lives —
    // but stops counter-rolling against a sway that is no longer happening.
    headX: (springy(t, 0.091, 4.1) * 2.0 * quick - shift * 1.1 * slow) * scale,
    headY: (wave(t, 0.113, 0.9) * 1.5 * quick) * scale,
    headZ: (springy(t, 0.061, 3.3) * 1.7 * quick - shift * 0.8 * slow) * scale,
    // Her rig wires the tail wag straight into physics, so this costs one
    // parameter and buys constant motion down her whole back.
    tail: Math.max(0, Math.min(1, 0.35 + drive * 0.65)),
    // In fractions of the stage. The lateral drift is unchanged — a slow lean is
    // what standing still actually looks like — but the vertical is now a
    // fraction of what it was, closer to a chest rising than to a bob.
    // Sliding across the stage while making a point is the most obviously wrong
    // of the lot, so it is damped hardest.
    driftX: shift * 0.009 * scale * slow,
    // Breathing stays: she does not stop breathing to talk, and the chest lift
    // is the thing keeping her alive on screen once the swaying is gone.
    bounceY: lift * 0.003 * scale,
  };
}
