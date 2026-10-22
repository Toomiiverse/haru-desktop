import test from 'node:test';
import assert from 'node:assert/strict';
import { noteDeviceFrame, drivingNow } from '../electron/core-ios';

test('the car screen state rides the phone heartbeat; only a conversation state counts as driving', () => {
  assert.equal(drivingNow(), false);
  noteDeviceFrame(JSON.stringify({ type: 'heartbeat', foreground: true, callActive: false }));
  assert.equal(drivingNow(), false);
  noteDeviceFrame(JSON.stringify({ type: 'heartbeat', foreground: true, callActive: false, carPlay: 'ready', route: 'CarAudio' }));
  assert.equal(drivingNow(), false);
  noteDeviceFrame(JSON.stringify({ type: 'heartbeat', foreground: true, callActive: true, carPlay: 'listening', route: 'CarAudio' }));
  assert.equal(drivingNow(), true);
  noteDeviceFrame('{not json "carPlay"');
  assert.equal(drivingNow(), true);
  noteDeviceFrame(JSON.stringify({ type: 'result', carPlay: 'ready' }));
  assert.equal(drivingNow(), true);
  noteDeviceFrame(JSON.stringify({ type: 'heartbeat', carPlay: 'disconnected', route: 'Speaker' }));
  assert.equal(drivingNow(), false);
});
