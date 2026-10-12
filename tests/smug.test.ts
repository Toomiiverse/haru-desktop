import test from 'node:test';
import assert from 'node:assert/strict';
import { SmugSequence, type SmugFrame } from '../src/companion/smug';

const channels = ['weight', 'eyes', 'smile', 'parted', 'pitch', 'yaw', 'roll'] as const;
const near = (a: SmugFrame, b: SmugFrame, tolerance: number, context: string) => {
  for (const channel of channels) {
    assert.ok(Number.isFinite(a[channel]), `${context}: finite ${channel}`);
    assert.ok(Math.abs(a[channel] - b[channel]) <= tolerance,
      `${context}: ${channel} changed from ${b[channel]} to ${a[channel]}`);
  }
};

test('the smug performance opens into a held smirk, survives interruptions, and releases cleanly', () => {
  const sequence = new SmugSequence();
  const rest = sequence.update(0);
  assert.ok(Object.values(rest).every(value => value === 0));
  sequence.start(1000);
  near(sequence.update(1000), rest, 0, 'entry starts at the current face');

  const closed = sequence.update(1350);
  const opening = sequence.update(1800);
  const lifted = sequence.update(2100);
  const settled = sequence.update(2850);
  assert.ok(closed.eyes > .95 && closed.pitch > 0, 'closed eyes and lowered chin introduce the beat');
  assert.ok(opening.eyes < closed.eyes && opening.eyes > lifted.eyes, 'eyes open gradually with the lift');
  assert.ok(lifted.eyes < .4 && lifted.pitch < 0 && lifted.roll > closed.roll, 'relaxed open eyes accompany the lifted, tilted head');
  assert.ok(settled.eyes > lifted.eyes && settled.eyes < .7, 'the held look narrows to half-lidded eyes');
  assert.ok(settled.smile > lifted.smile && settled.parted === 0, 'the final smirk settles with closed lips');
  assert.ok(sequence.update(1420).parted > 0 && sequence.update(2380).parted > 0, 'small lip beats occur before the hold');
  const held = sequence.update(3610);
  near(sequence.update(10000), held, 0, 'the final face holds instead of looping back');

  // A fresh trigger and a clear can arrive on any rendered frame, including
  // during release. They must begin from the visible pose, not a new baseline.
  for (const offset of [80, 420, 760, 1100, 1500, 2100, 3500]) {
    const interrupted = new SmugSequence();
    interrupted.start(0);
    const beforeRestart = interrupted.update(offset);
    interrupted.start(offset);
    near(interrupted.update(offset), beforeRestart, 1e-12, 'restart is continuous');
    near(interrupted.update(offset + 1000 / 60), beforeRestart, .035, 'first frame after restart');
    const clearAt = offset + 117;
    const beforeClear = interrupted.update(clearAt);
    interrupted.clear(clearAt);
    near(interrupted.update(clearAt), beforeClear, 1e-12, 'clear is continuous');
    near(interrupted.update(clearAt + 1000 / 60), beforeClear, .005, 'first frame after clear');
    const releaseAt = clearAt + 220;
    const duringRelease = interrupted.update(releaseAt);
    assert.ok(duringRelease.weight < beforeClear.weight, 'clear fades the visible performance');
    interrupted.start(releaseAt);
    near(interrupted.update(releaseAt), duringRelease, 1e-12, 'restart during release is continuous');
    const finalClear = releaseAt + 300;
    interrupted.clear(finalClear);
    interrupted.clear(finalClear + 100);
    near(interrupted.update(finalClear + 550), rest, 0, 'repeated clear does not postpone recovery');
    near(interrupted.update(finalClear + 10000), rest, 0, 'no stale expression or head offset remains');
  }

  let previous = rest;
  const continuous = new SmugSequence();
  continuous.start(0);
  for (let frame = 1; frame <= 180; frame++) {
    const current = continuous.update(frame * 1000 / 60);
    near(current, previous, .13, `sequence frame ${frame}`);
    for (const channel of ['weight', 'eyes', 'smile', 'parted'] as const)
      assert.ok(current[channel] >= 0 && current[channel] <= 1, `${channel} stays within the blend range`);
    previous = current;
  }

  const reduced = new SmugSequence();
  reduced.start(0, true);
  const quiet = reduced.update(0, true);
  assert.ok(quiet.weight === 1 && quiet.eyes > .4 && quiet.eyes < .7 && quiet.smile > .8, 'reduced motion shows the final facial expression');
  assert.deepEqual([quiet.pitch, quiet.yaw, quiet.roll], [0, 0, 0], 'reduced motion has no head travel');
  near(reduced.update(10000, true), quiet, 0, 'reduced motion remains still');
  reduced.clear(10000, true);
  near(reduced.update(10000, true), rest, 0, 'reduced motion clears without travel');
});
