// Poses as blend values rather than named expressions. An expression file is
// all-or-nothing — she wears it or she does not — which cannot express a slight
// smile, half-lidded eyes and a small tilt at once. These are continuous
// channels that layer and add up, so several behaviours can be visible together
// and each can fade independently.
//
// Channels are semantic. The mapping to Live2D parameters happens once, at the
// bottom, with fallbacks — nothing above this line knows a parameter name.

export type Pose = {
  /** -1 frown, 0 neutral, 1 broad smile. */
  smile?: number;
  /** 0 closed, 1 wide open. */
  mouthOpen?: number;
  /** Multiplier on eyelid openness: 1 leaves blinking alone, 0 shuts them. */
  eyesOpen?: number;
  /** Crinkle at the corners of the eyes — what separates a real smile. */
  eyeSmile?: number;
  /** -1 knitted, 0 neutral, 1 raised. */
  browsRaised?: number;
  /** Degrees of head roll. Negative tilts one way, positive the other. */
  headTilt?: number;
  /** -1 pulls back, 1 leans in. */
  lean?: number;
};

export type WeightedPose = { pose: Pose; weight: number };

const ADDITIVE: (keyof Pose)[] = ['smile', 'mouthOpen', 'eyeSmile', 'browsRaised', 'headTilt', 'lean'];

/**
 * Combines poses into one. Additive channels are weighted-averaged so two
 * half-strength smiles do not become a grin, while eye openness multiplies —
 * anything wanting the eyes closed wins, which is what makes a blink survive
 * whatever else is happening.
 */
export function blendPoses(entries: WeightedPose[]): Pose {
  const active = entries.filter(entry => entry.weight > 0);
  if (!active.length) return {};
  const result: Pose = {};
  for (const channel of ADDITIVE) {
    let total = 0;
    let weight = 0;
    for (const entry of active) {
      const value = entry.pose[channel];
      if (typeof value !== 'number') continue;
      total += value * entry.weight;
      weight += entry.weight;
    }
    if (weight > 0) result[channel] = total / weight;
  }
  let eyes = 1;
  for (const entry of active) {
    const value = entry.pose.eyesOpen;
    if (typeof value !== 'number') continue;
    // Eased by weight so a fading pose releases the eyes gradually.
    eyes *= 1 - (1 - value) * Math.min(1, entry.weight);
  }
  if (eyes !== 1) result.eyesOpen = eyes;
  return result;
}

/**
 * The face she wears when nothing else is happening.
 *
 * Rigs are drawn at rest with a pleasant neutral — a slight smile, open brows —
 * because that is what suits most characters. It does not suit this one: she
 * spent a whole conversation demanding to know whether her nagging had been
 * wasted while wearing a gentle smile, and the mismatch reads as the face not
 * being connected to the voice at all.
 *
 * Applied continuously underneath everything else rather than as an expression,
 * because expressions are beats that end. This is what she looks like between
 * them. Emotional poses still layer on top and can pull the mouth back up, so a
 * genuine laugh is not blocked by it — it just starts from further down.
 */
export const RESTING: Pose = {
  smile: -0.45,
  browsRaised: -0.3,
  // A multiplier, so this narrows the eyes without preventing a blink from
  // closing them completely.
  eyesOpen: 0.88,
};

// Named so the vocabulary reads as behaviour rather than as parameter soup.
export const POSES: Record<string, Pose> = {
  smile: { smile: 0.45, eyeSmile: 0.4, browsRaised: 0.1 },
  grin: { smile: 0.8, eyeSmile: 0.6, browsRaised: 0.2, mouthOpen: 0.2 },
  yawn: { mouthOpen: 0.85, eyesOpen: 0.1, browsRaised: 0.35 },
  sigh: { mouthOpen: 0.25, browsRaised: -0.3, lean: -0.2, smile: -0.15 },
  stretch: { browsRaised: 0.45, lean: -0.4, mouthOpen: 0.15 },
  tilt: { headTilt: -9, browsRaised: 0.35 },
  fidget: { headTilt: 7, browsRaised: 0.1 },
  think: { browsRaised: -0.25, eyesOpen: 0.65, headTilt: 4 },
  'lean-in': { lean: 0.45, browsRaised: 0.25, eyesOpen: 1 },
  settle: { eyesOpen: 0.75, browsRaised: -0.1, smile: 0.1 },
  doze: { eyesOpen: 0.05, browsRaised: -0.2, mouthOpen: 0.05 },
  // A deliberate, slow blink — distinct from the runtime's automatic ones, and
  // what reads as listening rather than as a twitch.
  blink: { eyesOpen: 0 },
  sparkle: { eyeSmile: 0.55, browsRaised: 0.3, smile: 0.3 },
  narrow: { eyesOpen: 0.55, browsRaised: -0.35 },
  // Swearing at you. Eyes down to a slit, brows hard down, mouth set, and leaning
  // in rather than back — the difference between being cross and being cross
  // with someone in particular.
  seething: { eyesOpen: 0.32, browsRaised: -0.7, smile: -0.6, lean: 0.2, eyeSmile: -0.3 },
  upset: { smile: -0.4, browsRaised: -0.45, eyesOpen: 0.8 },
  // Being prodded. Pulls back and away rather than making a face about it — the
  // point is that the click lands on a body, not just on a mood.
  flinch: { lean: -0.55, eyesOpen: 0.3, browsRaised: 0.45, mouthOpen: 0.3, headTilt: -6 },
  // The same contact once she has stopped being surprised by it: braced and
  // narrowed instead of startled.
  recoil: { lean: -0.4, eyesOpen: 0.5, browsRaised: -0.5, smile: -0.5, headTilt: 5 },
};

// How each behaviour is shaped over time: how long it lasts, and how sharply it
// arrives. A yawn should bloom and linger; a blink should snap.
export const POSE_TIMING: Record<string, { durationMs: number; attack: number }> = {
  smile: { durationMs: 2600, attack: 0.3 },
  grin: { durationMs: 2200, attack: 0.2 },
  yawn: { durationMs: 2800, attack: 0.35 },
  sigh: { durationMs: 2000, attack: 0.25 },
  stretch: { durationMs: 2600, attack: 0.3 },
  tilt: { durationMs: 2400, attack: 0.25 },
  fidget: { durationMs: 1600, attack: 0.25 },
  think: { durationMs: 3000, attack: 0.3 },
  'lean-in': { durationMs: 2400, attack: 0.2 },
  settle: { durationMs: 3200, attack: 0.4 },
  doze: { durationMs: 6000, attack: 0.5 },
  blink: { durationMs: 420, attack: 0.35 },
  sparkle: { durationMs: 1800, attack: 0.2 },
  narrow: { durationMs: 2000, attack: 0.3 },
  // Longer than the others and quick to arrive: it should still be on her face
  // by the end of the sentence that earned it.
  seething: { durationMs: 4200, attack: 0.12 },
  upset: { durationMs: 2600, attack: 0.25 },
  // Sharp in, quick out. A flinch that eases in is not a flinch.
  flinch: { durationMs: 700, attack: 0.08 },
  recoil: { durationMs: 900, attack: 0.1 },
};

/**
 * How strongly a pose applies at this point through its life: in over `attack`,
 * held briefly, then out. Returns 0 outside the window so a finished pose stops
 * contributing entirely.
 */
export function poseStrength(progress: number, attack: number) {
  if (progress <= 0 || progress >= 1) return 0;
  if (progress < attack) return progress / attack;
  const release = 1 - attack * 0.6;
  if (progress > release) return Math.max(0, (1 - progress) / (1 - release));
  return 1;
}

// Several candidates per channel because parameter naming is only loosely
// standard; whichever the model actually defines is the one written to.
const CHANNEL_PARAMS: Record<keyof Pose, { ids: string[]; scale: number; mode: 'add' | 'multiply' }> = {
  smile: { ids: ['ParamMouthForm'], scale: 1, mode: 'add' },
  mouthOpen: { ids: ['ParamMouthOpenY'], scale: 1, mode: 'add' },
  eyesOpen: { ids: ['ParamEyeLOpen', 'ParamEyeROpen'], scale: 1, mode: 'multiply' },
  eyeSmile: { ids: ['ParamEyeLSmile', 'ParamEyeRSmile'], scale: 1, mode: 'add' },
  browsRaised: { ids: ['ParamBrowLY', 'ParamBrowRY'], scale: 1, mode: 'add' },
  headTilt: { ids: ['ParamAngleZ'], scale: 1, mode: 'add' },
  lean: { ids: ['ParamBodyAngleY'], scale: 10, mode: 'add' },
};

type Core = {
  getParameterValueById(id: string): number;
  setParameterValueById(id: string, value: number): void;
  addParameterValueById(id: string, value: number): void;
};

export function applyPose(core: Core, pose: Pose) {
  for (const [channel, value] of Object.entries(pose) as [keyof Pose, number][]) {
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    const spec = CHANNEL_PARAMS[channel];
    if (!spec) continue;
    for (const id of spec.ids) {
      try {
        if (spec.mode === 'multiply') core.setParameterValueById(id, core.getParameterValueById(id) * value);
        else core.addParameterValueById(id, value * spec.scale);
      } catch {
        // A model without this parameter simply does not get this channel.
      }
    }
  }
}
