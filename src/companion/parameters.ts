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

type CoreModel = { addParameterValueById(id: string, value: number): void };
type Internal = {
  coreModel?: CoreModel;
  focusController?: { x: number; y: number };
  updateFocus?: () => void;
};

export type GestureRef = { current: { name: Gesture; startedAt: number } | null };

export function attachParameterLayer(model: unknown, gesture: GestureRef) {
  const internal = (model as { internalModel?: Internal })?.internalModel;
  const core = internal?.coreModel;
  const focus = internal?.focusController;
  // A model shaped differently simply keeps the stock behaviour rather than
  // losing focus tracking altogether.
  if (!internal || !core || !focus || typeof internal.updateFocus !== 'function') return;

  internal.updateFocus = () => {
    try {
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
}
