import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { fairyMotion, speechJaw, sleepMotion } from '../src/companion/idle';

test('moods change flight speed, happy hops, depth and glow; speech settles the flight', () => {
  const distance = (mood: string, talk = 0) => {
    let sum = 0, previous = fairyMotion(0, mood, talk);
    for (let t = 16; t < 60000; t += 16) {
      const p = fairyMotion(t, mood, talk);
      assert.ok(Object.values(p).every(Number.isFinite));
      assert.ok(Math.abs(p.flightX) <= 1 && Math.abs(p.flightY) <= 1 && Math.abs(p.z) <= .12);
      assert.ok(p.glow >= .12 && p.glow <= .4);
      if (mood === 'happy') assert.ok(p.y <= 0);
      sum += Math.hypot(p.flightX - previous.flightX, p.flightY - previous.flightY); previous = p;
    }
    return sum;
  };
  assert.ok(distance('angry') > distance('happy') * 1.5);
  assert.ok(distance('happy') > distance('sleepy') * 4);
  assert.ok(distance('happy', 1) < distance('happy') * .25);
  assert.notEqual(fairyMotion(1000,'neutral',0).glow, fairyMotion(3000,'neutral',0).glow);
  for (const fps of [30,60,144]) {
    let jaw = 0;
    for(let i=0;i<fps;i++) jaw=speechJaw(.8,1,jaw,1/fps);
    assert.ok(Math.abs(jaw-.8)<.001);
    for(let i=0;i<fps/2;i++) jaw=speechJaw(0,0,jaw,1/fps);
    assert.ok(jaw<.003);
  }
});

test('desktop flight is bounded, yields to interaction, and rejects stale or invalid device commands', async () => {
  const source = readFileSync('src/CompanionWindow.tsx','utf8');
  const code = source.slice(source.indexOf('  function floatAcrossDesktop('),source.indexOf('  function onPointerDown('));
  let at=100; const calls:number[][]=[];
  const c:any={flightSample:{current:null},flightPending:{current:false},dragging:{current:false},asking:false,caption:null,lastPointerOver:{current:false},
    performance:{now:()=>at},screen:{availWidth:1920,availHeight:1080},window:{haru:{companion:{floatBy:(x:number,y:number)=>{calls.push([x,y]);return Promise.resolve();}}}}};
  vm.runInNewContext(stripTypeScriptTypes(code)+';globalThis.float=floatAcrossDesktop',c);
  c.float(0,0,true);assert.equal(calls.length,0);
  at+=33;c.float(1,-1,true);assert.deepEqual(calls[0],[80,-80]);
  await new Promise(resolve=>setImmediate(resolve));
  c.dragging.current=true;at+=33;c.float(.5,.5,true);assert.equal(calls.length,1);
  c.dragging.current=false;at+=33;c.float(.5,.5,true);assert.equal(calls.length,1);
  c.float(0,0,false);assert.equal(c.flightSample.current,null);
  at+=500;c.float(1,1,true);assert.equal(calls.length,1);
  const main=readFileSync('electron/main.ts','utf8');
  const handler=main.slice(main.indexOf("  ipcMain.handle('companion:floatBy'"),main.indexOf("  ipcMain.handle('companion:moveBy'"));
  let invoke:any;const positions:number[][]=[];const sender={};
  const m:any={ipcMain:{handle:(_:string,f:any)=>invoke=f},companionWindow:{webContents:sender,isVisible:()=>true,getBounds:()=>({x:100,y:200,width:300,height:300})},
    desktopBusy:()=>false,walkingTo:null,perched:null,perchMove:null,perchFall:null,
    clampCompanionPosition:(x:number,y:number)=>({x,y}),positionCompanion:(...p:number[])=>positions.push(p)};
  vm.runInNewContext(stripTypeScriptTypes(handler),m);
  invoke({sender},20,-30);assert.deepEqual(positions,[[120,170]]);
  invoke({sender:{}},10,10);invoke({sender},NaN,10);invoke({sender},121,0);
  m.desktopBusy=()=>true;invoke({sender},10,10);assert.equal(positions.length,1);
});

test('phone jaw reads the playing speech waveform and disposal preserves audio output', async () => {
  const source=readFileSync('src/companion/phoneSpeech.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function');
  const events=new Map<string,Function>();let created=0,level=0,closed=0;
  const connections:unknown[]=[];const destination={};
  const audio={paused:false,ended:false,muted:false,volume:1,readyState:4,addEventListener:(n:string,f:Function)=>events.set(n,f),removeEventListener:(n:string)=>events.delete(n)};
  class AudioContext {
    state='running';destination=destination;
    constructor(){created++;} async resume(){} async close(){closed++;}
    createAnalyser(){return {fftSize:0,connect(){},disconnect(){},getFloatTimeDomainData:(a:Float32Array)=>a.fill(level)};}
    createMediaElementSource(){return {connect:(n:unknown)=>connections.push(n),disconnect(){}};}
  }
  const c:any={window:{AudioContext},console,document:{addEventListener:(n:string,f:Function)=>events.set(n,f),removeEventListener:(n:string)=>events.delete(n)}};
  vm.runInNewContext(stripTypeScriptTypes(source)+';globalThis.create=createPhoneSpeech',c);
  const meter=c.create(audio);assert.equal(created,0);assert.equal(meter.read().open,0);
  await events.get('pointerdown')!();assert.equal(created,1);
  level=.1;assert.ok(meter.read().open>.5);assert.equal(meter.read().weight,1);
  level=0;assert.equal(meter.read().open,0);
  audio.paused=true;level=.1;assert.equal(meter.read().weight,0);audio.paused=false;
  audio.muted=true;assert.equal(meter.read().open,0);audio.muted=false;
  meter.dispose();assert.equal(meter.read().open,0);assert.equal(connections.at(-1),destination);assert.equal(closed,0);assert.equal(events.size,0);
});


test('sleep breathing, tired nods and dream twitches stay small and vanish when awake', () => {
  let min=1,max=0,nods=0;const ears=new Set<string>();
  for(let t=0;t<60000;t+=33){
    const awake=sleepMotion(t,0),asleep=sleepMotion(t,1),tired=sleepMotion(t,.55);
    assert.ok(awake.lift===0);assert.equal(awake.roll,0);assert.equal(awake.stretch,1);assert.equal(awake.lid,1);
    for(const p of [asleep,tired]){assert.ok(Object.values(p).every(Number.isFinite));assert.ok(Math.abs(p.lift)<.04 && p.stretch>.97 && p.stretch<1.05 && p.lid>=.02);}
    min=Math.min(min,asleep.lift);max=Math.max(max,asleep.lift);if(tired.lift>.008)nods++;
    ears.add(asleep.ear.toFixed(1));
  }
  assert.ok(max-min>.012);assert.ok(nods>0);assert.ok(ears.size>10);
  assert.ok(Object.values(sleepMotion(NaN,Infinity)).every(Number.isFinite));
});
