import test from 'node:test';
import assert from 'node:assert/strict';
import {callTelemetry} from '../electron/call-telemetry';
test('playback estimates require an announced non-filler reply and are bounded and numeric',()=>{
 const rows:object[]=[];const t=callTelemetry(row=>rows.push(row));
 const report={turn:1,id:'x',captureToRenderEstimateMs:1500,outputLatencyMs:15,primeMs:240,underruns:0,privateText:'omit'};
 t.receive(report);assert.equal(rows.length,0);
 t.event({type:'audio_start',turn:1,id:'x',filler:true});t.receive(report);assert.equal(rows.length,0);
 t.event({type:'audio_start',turn:1,id:'x',filler:false});t.receive({...report,primeMs:NaN});assert.equal(rows.length,0);
 t.receive(report);t.receive(report);assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('omit'));
});
