import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCallCheck, saveCallCheck, callCheckResults, callCheckPage, callCheckWorklet } from '../electron/call-check';
const good = { version: 1, elapsedMs: 10000, microphoneRate: 48000, outputRate: 48000, audioWorklet: true, outputTimestamp: true, echoCancellation: true, heardReply: 'yes', interruption: 'worked', turns: [{ microphoneToPcmMs: 1200, microphoneToScheduledPlaybackMs: 1280, timestampMethod: 'output-timestamp' }], interruptions: 1, errors: 0, playbackGaps: 0, hidden: false };
test('diagnostic data accepts bounded measurements, never audio, transcript or arbitrary fields', () => {
  assert.ok(readCallCheck(good));
  for (const value of [null, {}, {...good, transcript:'private'}, {...good, audio:'AAAA'}, {...good, elapsedMs:Infinity}, {...good, turns:[{...good.turns[0],microphoneToPcmMs:-1}]}, {...good, turns:[{...good.turns[0],text:'private'}]}, {...good, turns:Array(13).fill(good.turns[0])}]) assert.equal(readCallCheck(value),null);
});
test('reports survive reopening and use private file permissions', () => {
  const dir = mkdtempSync(join(tmpdir(),'call-check-'));
  try { const file=join(dir,'results.jsonl'); saveCallCheck(readCallCheck(good)!,file); assert.equal(callCheckResults(file)[0].heardReply,'yes'); assert.equal(statSync(file).mode&0o777,0o600); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
test('browser and worklet scripts parse; page distinguishes scheduled output from physical sound', () => {
  const html=callCheckPage(); new Script(html.match(/<script>([\s\S]*)<\/script>/)![1]); new Script(callCheckWorklet());
  assert.match(html,/not a measurement of sound leaving the speaker/);
  assert.match(html,/\/api\/call\/session/);
});
