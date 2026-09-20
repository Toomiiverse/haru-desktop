type Frame = {weight: number; channels: Record<string, number>};
const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const names = [
  'headX', 'headY', 'headZ', 'lean', 'turn', 'sway', 'chestLean', 'chestTurn', 'chestSway',
  'weightX', 'weightY', 'weightZ', 'hipPitch', 'hipYaw', 'hipRoll',
  ...['left', 'right'].flatMap(side => [side + 'ShoulderLift', side + 'ShoulderForward']), 'stillness',
];

/** Weighted body offsets only; the original sequence continues to own the face and hands. */
export class ReferenceBodyMotion {
  private readonly states = new Map(names.map(name => [name, {value: 0, speed: 0}]));
  private strength = 0;
  private strengthSpeed = 0;
  private groundFloat = 0;
  private phase = 0;

  get activity() { return clamp(this.strength); }

  update(frame: Frame, delta: number, reduced: boolean): Frame {
    if (reduced) {
      for (const state of this.states.values()) state.value = state.speed = 0;
      this.strength = this.strengthSpeed = this.groundFloat = 0;
      return {weight: 0, channels: {}};
    }
    const weight = clamp(frame.weight), dt = Math.max(0, Math.min(.25, Number.isFinite(delta) ? delta : 0));
    const steps = Math.max(1, Math.ceil(dt * 120)), step = dt / steps, omega = 2.7 * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      // Critical damping keeps the layer envelope within [0,1], even on replay.
      this.strengthSpeed += ((weight - this.strength) * 9.5 ** 2 - 2 * 9.5 * this.strengthSpeed) * step;
      this.strength += this.strengthSpeed * step;
      for (const [name, state] of this.states) {
        const source = frame.channels[name], target = (Number.isFinite(source) ? source : 0) * weight;
        const damping = name === 'stillness' ? 1 : .60;
        state.speed += ((target - state.value) * omega ** 2 - 2 * damping * omega * state.speed) * step;
        state.value += state.speed * step;
      }
    }
    if (!weight && this.activity < 1e-4 && Math.abs(this.strengthSpeed) < .001
      && [...this.states.values()].every(s => Math.abs(s.value) < 1e-5 && Math.abs(s.speed) < 1e-4)) {
      for (const state of this.states.values()) state.value = state.speed = 0;
      this.strength = this.strengthSpeed = this.groundFloat = 0;
      return {weight: 0, channels: {}};
    }
    this.phase = (this.phase + dt * Math.PI * 2 / 4.8) % (Math.PI * 2);
    const channels = Object.fromEntries([...this.states].map(([name, state]) => [name, state.value]));
    channels.stillness = clamp(channels.stillness);
    // Keep the arrived pose alive without translating the whole avatar. The
    // pelvis component passes through the existing planted-foot IK and guards.
    const float = this.activity;
    channels.chestLean += Math.sin(this.phase) * .0065 * float;
    channels.headX -= Math.sin(this.phase - .28) * .0045 * float;
    channels.leftShoulderLift += Math.sin(this.phase - .15) * .0055 * float;
    channels.rightShoulderLift += Math.sin(this.phase + .15) * .0055 * float;
    // Resume ground breathing gradually after the walking layer has stopped.
    if ((frame.channels.gait || 0) > 0) this.groundFloat = 0;
    else this.groundFloat += (float - this.groundFloat) * (1 - Math.exp(-7 * dt));
    channels.weightY -= (.5 - .5 * Math.cos(this.phase)) * .003 * this.groundFloat;
    return {weight: 1, channels};
  }
}
