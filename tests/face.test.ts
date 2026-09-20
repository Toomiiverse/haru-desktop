import test from 'node:test';
import assert from 'node:assert/strict';
import { BLINK_CLOSE_MS, BLINK_HOLD_MS, BLINK_OPEN_MS, FRAME_MS, FaceDriver, HEAD_DELAY_MS, HEAD_MS, RAMP_MS, STAGGER_MS, channelsOf, stepped } from '../src/companion/face';

// A model that ships happy in parts and everything else whole.
const model = { has: (name: string) => ['happy', 'happy.eyes', 'happy.brows', 'happy.mouth', 'angry', 'sleepy'].includes(name) };

function sample(driver: FaceDriver, from: number, to: number, every = FRAME_MS) {
  const out = [];
  for (let t = from; t <= to; t += every) out.push({ t, ...driver.update(t) });
  return out;
}

test('progress lands only on pulses', () => {
  assert.deepEqual([0, 0.2, 0.49, 0.5, 0.74, 0.99, 1, 2].map(p => stepped(p)), [0, 0, 0, 0.5, 0.5, 0.5, 1, 1]);
});

test('an expression is driven through its parts when the model has them, else whole', () => {
  assert.deepEqual(channelsOf(model, 'happy'), ['happy.eyes', 'happy.brows', 'happy.mouth']);
  assert.deepEqual(channelsOf(model, 'angry'), ['angry']);
  assert.deepEqual(channelsOf(model, null), []);
});

test('from nothing to happy: eyes first, brows two frames later, mouth two after that, no blink', () => {
  const driver = new FaceDriver(model);
  driver.show('happy', { yaw: 10, pitch: 0 }, 1000);
  const frames = sample(driver, 1000, 1000 + RAMP_MS + 2 * STAGGER_MS + FRAME_MS);
  assert.ok(frames.every(f => f.blink === 0));
  const arrival = (channel: string) => frames.find(f => f.weights[channel] === 1)!.t - 1000;
  assert.ok(Math.abs(arrival('happy.eyes') - RAMP_MS) < 0.01, `eyes land after one ramp, not ${arrival('happy.eyes')}`);
  assert.ok(arrival('happy.brows') > arrival('happy.eyes'));
  assert.ok(arrival('happy.mouth') > arrival('happy.brows'));
  // Only pulse values on the way up, never a lerp.
  for (const f of frames) for (const w of Object.values(f.weights)) assert.ok([0, 0.5, 1].includes(w), `weight ${w}`);
});

test('between two real faces she blinks and the swap happens under the lids', () => {
  const driver = new FaceDriver(model);
  driver.show('angry', undefined, 0);
  driver.update(5000);
  driver.show('happy', undefined, 5000);
  const closing = driver.update(5000 + BLINK_CLOSE_MS);
  assert.equal(closing.blink, 1);
  assert.equal(closing.weights['angry'], 1, 'the old face is still on when the lids close');
  assert.equal(closing.weights['happy.eyes'], 0);
  const opened = driver.update(5000 + BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS);
  assert.equal(opened.blink, 0);
  assert.equal(opened.weights['happy.eyes'], 1, 'she opens already wearing the new eyes');
  assert.equal(opened.weights['angry'], 0);
});

test('to or from a bare face there is no blink to hide behind', () => {
  const driver = new FaceDriver(model);
  driver.show('angry', undefined, 0);
  driver.update(1000);
  driver.show(null, undefined, 1000);
  assert.ok(sample(driver, 1000, 1400).every(f => f.blink === 0));
  assert.equal(driver.update(1000 + RAMP_MS).weights['angry'], 0);
});

test('the head starts after the eyes and is the last thing to arrive', () => {
  const driver = new FaceDriver(model);
  driver.show('happy', { yaw: 20, pitch: -6 }, 0);
  assert.equal(driver.update(HEAD_DELAY_MS).head.yaw, 0, 'not yet');
  const mid = driver.update(HEAD_DELAY_MS + HEAD_MS / 2).head.yaw;
  assert.ok(mid > 10 && mid < 20, `eased, past halfway: ${mid}`);
  const mouthDone = 2 * STAGGER_MS + RAMP_MS;
  assert.ok(driver.update(mouthDone).head.yaw < 20, 'still turning after the mouth has landed');
  const settled = driver.update(HEAD_DELAY_MS + HEAD_MS).head;
  assert.deepEqual(settled, { yaw: 20, pitch: -6 });
});

test('interrupted mid-turn, the head continues from where it was rather than snapping', () => {
  const driver = new FaceDriver(model);
  driver.show('happy', { yaw: 20, pitch: 0 }, 0);
  const partway = driver.update(150).head.yaw;
  driver.show('angry', { yaw: -20, pitch: 0 }, 150);
  assert.equal(driver.update(150).head.yaw, partway);
});

test('only the head changing keeps the face on', () => {
  const driver = new FaceDriver(model);
  driver.show('sleepy', { yaw: 0, pitch: 10 }, 0);
  driver.update(1000);
  driver.show('sleepy', { yaw: 5, pitch: 10 }, 1000);
  assert.equal(driver.update(1010).weights['sleepy'], 1);
  assert.equal(driver.update(1010).blink, 0);
});
