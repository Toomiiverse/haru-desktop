/** Authenticated, opt-in handset diagnostics. Never stores audio or transcripts. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type CallCheck = {
  version: 1; elapsedMs: number; microphoneRate: number; outputRate: number;
  audioWorklet: boolean; outputTimestamp: boolean; echoCancellation: boolean;
  heardReply: 'yes' | 'no' | 'not-tested'; interruption: 'worked' | 'failed' | 'not-tested';
  turns: { microphoneToPcmMs: number; microphoneToScheduledPlaybackMs: number; timestampMethod: 'output-timestamp' | 'context-estimate' }[];
  interruptions: number; errors: number; playbackGaps: number; hidden: boolean;
};
const fields = ['version','elapsedMs','microphoneRate','outputRate','audioWorklet','outputTimestamp','echoCancellation','heardReply','interruption','turns','interruptions','errors','playbackGaps','hidden'];
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function readCallCheck(value: unknown): CallCheck | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== fields.length || Object.keys(v).some(k => !fields.includes(k))) return null;
  if (v.version !== 1 || !finite(v.elapsedMs, 0, 600_000) || !finite(v.microphoneRate, 8000, 192000) || !finite(v.outputRate, 8000, 192000)) return null;
  if (['audioWorklet','outputTimestamp','echoCancellation','hidden'].some(k => typeof v[k] !== 'boolean')) return null;
  if (!['yes','no','not-tested'].includes(String(v.heardReply)) || !['worked','failed','not-tested'].includes(String(v.interruption))) return null;
  if (['interruptions','errors','playbackGaps'].some(k => !finite(v[k],0,10000) || !Number.isInteger(v[k]))) return null;
  if (!Array.isArray(v.turns) || v.turns.length > 12 || v.turns.some(t => !t || typeof t !== 'object' || Object.keys(t).sort().join(',') !== 'microphoneToPcmMs,microphoneToScheduledPlaybackMs,timestampMethod' || !finite(t.microphoneToPcmMs,0,120000) || !finite(t.microphoneToScheduledPlaybackMs,0,120000) || !['output-timestamp','context-estimate'].includes(t.timestampMethod))) return null;
  return JSON.parse(JSON.stringify(v)) as CallCheck;
}
const defaultFile = () => join(homedir(), '.config/haru-desktop/call-check-results.jsonl');
export function saveCallCheck(result: CallCheck, file = defaultFile()) {
  // Fixed path and bounded retention. No request-selected filenames or prose.
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (existsSync(file) && statSync(file).size > 262144) writeFileSync(file, readFileSync(file,'utf8').trim().split('\n').slice(-32).join('\n')+'\n', { mode: 0o600 });
  const saved = { at: new Date().toISOString(), ...result };
  appendFileSync(file, JSON.stringify(saved)+'\n', { mode: 0o600 });
  return saved;
}
export function callCheckResults(file = defaultFile()) {
  return existsSync(file) ? readFileSync(file,'utf8').trim().split('\n').filter(Boolean).slice(-12).map(line => JSON.parse(line)) : [];
}

export function callCheckWorklet(): string {
  return `class Capture extends AudioWorkletProcessor {
    constructor(){super();this.samples=new Float32Array(1024);this.n=0;}
    process(inputs){const a=inputs[0]&&inputs[0][0];if(a)for(let i=0;i<a.length;i++){this.samples[this.n++]=a[i];if(this.n===1024){this.port.postMessage(this.samples,[this.samples.buffer]);this.samples=new Float32Array(1024);this.n=0;}}return true;}
  }registerProcessor('haru-call-capture',Capture);`;
}

export function callCheckPage(): string { return String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Haru · Call check</title>
<style>body{font:17px/1.5 system-ui;color:#efeafa;background:#171029;max-width:680px;margin:auto;padding:24px}button,select{font:inherit;border:1px solid #9985bf;border-radius:12px;padding:12px;background:#302040;color:inherit;margin:6px 6px 6px 0}button:disabled{opacity:.5}p,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 system-ui}a{color:#d9c2ff}label{display:block;margin-top:16px}.card{padding:18px;background:#231a35;border-radius:18px;margin:18px 0}small{color:#c1b5d3}</style>
<h1>Call check</h1><p>Use your usual iPhone speaker or headphones. Start, allow the microphone, and ask a short question. Then try speaking over a longer reply.</p>
<p>This is a normal Haru call and uses your usual conversation history. Keep this page in the foreground. The diagnostic report contains timings and your choices, without audio or conversation text.</p>
<button id="start">Start call</button><button id="stop" disabled>End call</button><p id="status" role="status">Ready.</p>
<div class="card"><p id="heard"></p><p id="reply"></p><pre id="timings">No measurements yet.</pre></div>
<label>Could you hear her reply clearly? <select id="heardReply"><option value="not-tested">Not tested</option><option value="yes">Yes</option><option value="no">No</option></select></label>
<label>Did she stop when you interrupted? <select id="interruption"><option value="not-tested">Not tested</option><option value="worked">Yes</option><option value="failed">No</option></select></label>
<button id="save" disabled>Save test results</button><p><small>The timings run from the last microphone frame classified as speech to PCM arrival and estimated playback scheduling in this browser. Room noise, capture buffering and device output can affect them. They are not a measurement of sound leaving the speaker.</small></p><p><a href="/">Back to Haru</a></p>
<script>
(()=>{'use strict';
const el=id=>document.getElementById(id);let ctx,stream,source,capture,mute,ws,timer,started=0,ended=0,ready=false,running=false,opening=false,currentIsFiller=false,lastVoice=0,turn=null,tail=0,speaking=false,carry=[],position=0,sources=new Set(),rate=24000,report;
function status(t){el('status').textContent=t;}
function send(v){if(ws&&ws.readyState===1)ws.send(JSON.stringify(v));}
function her(v){if(speaking!==v){speaking=v;send({type:'her',speaking:v});}}
function flush(){for(const s of sources){s.onended=null;try{s.stop();}catch{}}sources.clear();tail=ctx?ctx.currentTime:0;her(false);}
function captureFrame(samples){if(!running||!ready||!ctx)return;let energy=0;for(const x of samples)energy+=x*x;if(!speaking&&Math.sqrt(energy/samples.length)>.012)lastVoice=performance.now();
carry.push(...samples);const step=ctx.sampleRate/16000,out=[];while(position+step<=carry.length){const index=Math.floor(position),next=Math.min(index+1,carry.length-1),fraction=position-index;const v=Math.max(-1,Math.min(1,carry[index]*(1-fraction)+carry[next]*fraction));out.push(v<0?v*32768:v*32767);position+=step;}const used=Math.floor(position);carry=carry.slice(used);position-=used;
if(out.length&&ws&&ws.readyState===1){if(ws.bufferedAmount>256000){report.errors++;status('Network too slow; call ended.');stop();return;}const b=new ArrayBuffer(out.length*2),d=new DataView(b);out.forEach((v,i)=>d.setInt16(i*2,v,true));ws.send(b);}}
function play(raw){if(!running||!ctx||raw.byteLength<2)return;const now=performance.now(),d=new DataView(raw),n=Math.floor(raw.byteLength/2),b=ctx.createBuffer(1,n,rate),a=b.getChannelData(0);let first=-1;for(let i=0;i<n;i++){a[i]=d.getInt16(i*2,true)/32768;if(first<0&&Math.abs(a[i])>.002)first=i;}
const at=Math.max(ctx.currentTime+.035,tail);if(tail&&ctx.currentTime>tail+.03&&speaking)report.playbackGaps++;const s=ctx.createBufferSource();s.buffer=b;s.connect(ctx.destination);sources.add(s);s.onended=()=>{sources.delete(s);if(!sources.size)her(false);};s.start(at);tail=at+b.duration;her(true);
if(turn&&!turn.recorded&&!currentIsFiller&&first>=0){turn.recorded=true;let estimate=now+(at+first/rate-ctx.currentTime)*1000+(ctx.baseLatency||0)*1000+(ctx.outputLatency||0)*1000,method='context-estimate';if(ctx.getOutputTimestamp){const ts=ctx.getOutputTimestamp();if(ts.performanceTime>0){estimate=ts.performanceTime+(at+first/rate-ts.contextTime)*1000;method='output-timestamp';}}
const one={microphoneToPcmMs:Math.round(now-turn.end),microphoneToScheduledPlaybackMs:Math.round(estimate-turn.end),timestampMethod:method};if(one.microphoneToPcmMs>=0&&one.microphoneToPcmMs<=120000&&one.microphoneToScheduledPlaybackMs>=0&&one.microphoneToScheduledPlaybackMs<=120000&&report.turns.length<12)report.turns.push(one);el('timings').textContent=report.turns.map((t,i)=>'Turn '+(i+1)+': PCM '+(t.microphoneToPcmMs/1000).toFixed(2)+' s; estimated playback '+(t.microphoneToScheduledPlaybackMs/1000).toFixed(2)+' s').join('\n');}}
function event(e){if(e.data instanceof ArrayBuffer){play(e.data);return;}let v;try{v=JSON.parse(e.data);}catch{return;}switch(v.type){case 'ready':ready=true;status('Listening. Ask a short question.');break;case 'user_message':el('heard').textContent='You: '+(v.text||'');if(!v.interim&&lastVoice)turn={end:lastVoice,recorded:false};break;case 'filler':currentIsFiller=true;break;case 'assistant_message':currentIsFiller=false;el('reply').textContent='Haru: '+(v.text||'');break;case 'audio_start':if(Number.isFinite(v.sampleRate)&&v.sampleRate>=8000&&v.sampleRate<=96000)rate=v.sampleRate;break;case 'user_interruption':report.interruptions++;flush();break;case 'error':case 'refused':report.errors++;status(v.message||v.reason||'Call failed.');stop();break;case 'ended':status('Call ended.');stop();break;}}
function stop(){if(!running)return;running=false;ready=false;ended=performance.now();clearTimeout(timer);send({type:'stop'});flush();if(ws)ws.close();if(capture)capture.disconnect();if(source)source.disconnect();if(mute)mute.disconnect();if(stream)stream.getTracks().forEach(t=>t.stop());if(ctx)void ctx.close();el('start').disabled=opening;el('stop').disabled=true;el('save').disabled=!report||!report.microphoneRate;}
async function start(){if(running||opening)return;opening=true;running=true;ready=false;currentIsFiller=false;status('Opening the microphone…');el('start').disabled=true;el('save').disabled=true;el('stop').disabled=false;lastVoice=0;turn=null;tail=0;carry=[];position=0;sources=new Set();started=performance.now();report={version:1,elapsedMs:0,microphoneRate:0,outputRate:0,audioWorklet:false,outputTimestamp:false,echoCancellation:false,heardReply:'not-tested',interruption:'not-tested',turns:[],interruptions:0,errors:0,playbackGaps:0,hidden:false};
try{const Audio=window.AudioContext||window.webkitAudioContext;ctx=new Audio({latencyHint:'interactive'});await ctx.resume();stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false});if(!running){stream.getTracks().forEach(t=>t.stop());return;}report.microphoneRate=ctx.sampleRate;report.outputRate=ctx.sampleRate;report.outputTimestamp=typeof ctx.getOutputTimestamp==='function';report.echoCancellation=stream.getAudioTracks()[0].getSettings().echoCancellation===true;source=ctx.createMediaStreamSource(stream);mute=ctx.createGain();mute.gain.value=0;
if(ctx.audioWorklet){await ctx.audioWorklet.addModule('/call-check-worklet.js');capture=new AudioWorkletNode(ctx,'haru-call-capture');capture.port.onmessage=e=>captureFrame(e.data);report.audioWorklet=true;}else{capture=ctx.createScriptProcessor(1024,1,1);capture.onaudioprocess=e=>captureFrame(e.inputBuffer.getChannelData(0));}if(!running)return;source.connect(capture);capture.connect(mute);mute.connect(ctx.destination);
ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/api/call/session');ws.binaryType='arraybuffer';ws.onopen=()=>send({type:'hello',pcm:true});ws.onmessage=event;ws.onerror=()=>{report.errors++;status('Connection failed. Sign in and try again.');stop();};ws.onclose=()=>{if(running){status('Connection ended.');stop();}};timer=setTimeout(()=>{status('Five-minute check complete.');stop();},300000);status('Connecting…');}catch(e){report.errors++;status(e.message||'Microphone unavailable.');stop();}finally{opening=false;el('start').disabled=running;}}
el('start').onclick=start;el('stop').onclick=()=>{status('Call ended. Choose your results below.');stop();};el('save').onclick=async()=>{report.elapsedMs=Math.round((ended||performance.now())-started);report.heardReply=el('heardReply').value;report.interruption=el('interruption').value;try{const r=await fetch('/api/call-check/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});if(!r.ok)throw Error('Save failed ('+r.status+').');status('Results saved. Thank you.');el('save').disabled=true;}catch(e){status(e.message);}};
document.addEventListener('visibilitychange',()=>{if(running&&document.hidden)report.hidden=true;});window.addEventListener('pagehide',stop);
})();</script></html>`; }
