// The physics/gesture layer. This replaces the runtime's own focus application
// rather than correcting it afterwards, and the ordering is the whole reason:
//
//   updateFocus()            <- head and eye parameters written here
//   updateNaturalMovements()
//   physics.evaluate()       <- derives secondary params (ParamAngleX2, hair...)
//   emit('beforeModelUpdate')
//   model.update()
//
// Scaling the head down in `beforeModelUpdate` came too late: physics had
// already carried the full swing into the secondary parameters, so the head kept
// following at full travel no matter what the primary was reduced to.

import { GESTURE_DURATION_MS, gestureOffset, type Gesture } from './behaviour';
import { applyPose, blendPoses, RESTING, type WeightedPose } from './pose';
import type { MouthReading } from './mouth';
import { idleMotion, type IdleVitals } from './idle';

// The runtime moves the head a full ±30° to follow the pointer while the eyes
// only move ±1, which is why she turned to look instead of glancing. Eyes are
// left at full travel and the head is cut right back, so the eyes lead and the
// head drifts after them the way someone actually tracks a cursor.
const HEAD_FOLLOW = 0.16;
const BODY_FOLLOW = 0.22;

// Matches the runtime's own constants, so damping is expressed as a fraction of
// normal travel rather than as magic numbers.
const HEAD_DEGREES = 30;
const BODY_DEGREES = 10;

type CoreModel = {
  addParameterValueById(id: string, value: number): void;
  getParameterValueById(id: string): number;
  setParameterValueById(id: string, value: number): void;
};
type Internal = {
  coreModel?: CoreModel;
  focusController?: { x: number; y: number };
  updateFocus?: () => void;
  on?(event: string, handler: () => void): void;
};

export type GestureRef = { current: { name: Gesture; startedAt: number } | null };
/** Supplies whatever poses are currently active, resolved fresh each frame. */
export type PoseSource = () => WeightedPose[];
/** Supplies how far open speech wants the mouth, read fresh each frame. */
export type MouthSource = () => MouthReading;
/** Supplies how energetic she currently is, so idle movement can follow it. */
export type VitalsSource = () => IdleVitals;
/** Supplies the chosen outfit as parameter values, read fresh each frame. */
export type WardrobeSource = () => Record<string, number>;

// A mouth open wide is also a mouth pulled slightly narrow, so a little form
// comes off as she opens. Small on purpose — enough that speech is not a plain
// jaw hinge, not enough to fight whatever expression she is wearing.
const SPEECH_MOUTH_FORM = 0.18;

// This model exposes its tail wag as physics inputs rather than as an angle to
// drive. Named here rather than in idle.ts, which deals in body movement and
// should not know what a particular rig calls its tail.
const TAIL_WAG_IDS = ['wagspeed1on2', 'wagspeed1on'];

export function attachParameterLayer(model: unknown, gesture: GestureRef, poses?: PoseSource, mouth?: MouthSource, vitals?: VitalsSource, wardrobe?: WardrobeSource) {
  const internal = (model as { internalModel?: Internal })?.internalModel;
  const core = internal?.coreModel;
  const focus = internal?.focusController;
  // A model shaped differently simply keeps the stock behaviour rather than
  // losing focus tracking altogether.
  if (!internal || !core || !focus || typeof internal.updateFocus !== 'function') return;

  internal.updateFocus = () => {
    try {
      // Idle motion goes on first and additively, so tracking, gestures and poses
      // all layer over a body that is already moving. It lives in here rather
      // than in beforeModelUpdate for one reason: physics runs between the two,
      // and only movement written before it reaches the hair and clothes.
      if (vitals) {
        // Raw clock, not time-since-attach: the window applies the same motion's
        // translation from its own loop, and any offset between the two clocks
        // would leave her leaning one way while drifting the other.
        const idle = idleMotion(performance.now(), vitals());
        // Added as a deviation from mid-breath, not set outright. The runtime runs
        // its own breath controller straight after this and adds to whatever is
        // here, so writing an absolute 0..1 would stack with it and sit clipped at
        // full inhale. This deepens the runtime's breathing instead of fighting it.
        core.addParameterValueById('ParamBreath', (idle.breath - 0.5) * 0.7);
        core.addParameterValueById('ParamBodyAngleX', idle.bodyX);
        core.addParameterValueById('ParamBodyAngleY', idle.bodyY);
        core.addParameterValueById('ParamBodyAngleZ', idle.bodyZ);
        core.addParameterValueById('ParamAngleX', idle.headX);
        core.addParameterValueById('ParamAngleY', idle.headY);
        core.addParameterValueById('ParamAngleZ', idle.headZ);
        // Wired directly into her physics rig, so a wagging tail also swings
        // everything the tail is attached to. Set rather than added, since it is
        // a rate switch and not an angle. Models without it lose nothing.
        for (const id of TAIL_WAG_IDS) core.setParameterValueById(id, idle.tail);
      }

      const x = focus.x ?? 0;
      const y = focus.y ?? 0;
      // Eyes at full travel: this is the part that should carry the tracking.
      core.addParameterValueById('ParamEyeBallX', x);
      core.addParameterValueById('ParamEyeBallY', y);
      core.addParameterValueById('ParamAngleX', x * HEAD_DEGREES * HEAD_FOLLOW);
      core.addParameterValueById('ParamAngleY', y * HEAD_DEGREES * HEAD_FOLLOW);
      core.addParameterValueById('ParamAngleZ', x * y * -HEAD_DEGREES * HEAD_FOLLOW);
      core.addParameterValueById('ParamBodyAngleX', x * BODY_DEGREES * BODY_FOLLOW);

      // Gestures go in here too, ahead of physics, so hair and accessories
      // follow a nod instead of staying rigid through it.
      const playing = gesture.current;
      if (!playing) return;
      const progress = (performance.now() - playing.startedAt) / GESTURE_DURATION_MS[playing.name];
      if (progress >= 1) return;
      const { pitch, yaw } = gestureOffset(playing.name, progress);
      if (pitch) core.addParameterValueById('ParamAngleY', pitch);
      if (yaw) core.addParameterValueById('ParamAngleX', yaw);
    } catch {
      // Never take the render loop down over a missing parameter.
    }
  };

  // Poses go on last, after focus and gestures, so a yawn can close eyes that
  // tracking has just been moving and win.
  internal.on?.('beforeModelUpdate', () => {
    try {
      // Her resting face goes on first, under everything: expressions and poses
      // both add to it, so an emotional beat starts from unimpressed and moves
      // away from it rather than replacing a neutral she never actually has.
      applyPose(core, RESTING);
      const active = poses?.() ?? [];
      if (active.length) applyPose(core, blendPoses(active));

      // Speech goes after the poses and blends towards its value rather than
      // adding to it, so a yawn arriving mid-sentence is overridden instead of
      // stacking with it into a howl. The weight is what hands the mouth back:
      // while she is talking it is hers, and it releases once she stops.
      const speech = mouth?.();
      if (speech && speech.weight > 0) {
        const open = core.getParameterValueById('ParamMouthOpenY');
        core.setParameterValueById('ParamMouthOpenY', open + (speech.open - open) * speech.weight);
        core.addParameterValueById('ParamMouthForm', -speech.open * SPEECH_MOUTH_FORM * speech.weight);
      }

      // The outfit goes on last and absolutely. Written here rather than once on
      // selection because expressions are applied every frame and would otherwise
      // put the default clothes back the moment she pulled a face.
      const chosen = wardrobe?.();
      if (chosen) for (const [id, value] of Object.entries(chosen)) core.setParameterValueById(id, value);
    } catch {
      // Never take the render loop down over a missing parameter.
    }
  });
}
