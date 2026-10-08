import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

test('the avatar focus cue requires keyboard navigation, clears on pointer or window blur, and cleans up listeners', () => {
  const source=readFileSync('src/CompanionWindow.tsx','utf8');
  const start=source.indexOf('  const [keyboardNavigation,');
  const code=source.slice(start,source.indexOf('  const [model,',start));
  const events=new Map<string,Function>();let keyboard=false,dispose:Function|undefined;
  const c={useState:()=>[false,(value:boolean)=>keyboard=value],useEffect:(fn:Function)=>dispose=fn(),
    window:{addEventListener:(name:string,fn:Function)=>events.set(name,fn),removeEventListener:(name:string)=>events.delete(name)}};
  vm.runInNewContext(stripTypeScriptTypes(code),c);
  assert.equal(keyboard,false,'native/programmatic focus alone never draws a box');
  events.get('keydown')!({key:'a'});assert.equal(keyboard,false);
  events.get('keydown')!({key:'Tab'});assert.equal(keyboard,true,'keyboard focus remains visible');
  events.get('pointerdown')!();assert.equal(keyboard,false);
  events.get('keydown')!({key:'Tab'});events.get('blur')!();assert.equal(keyboard,false);
  dispose!();assert.equal(events.size,0);
});

test('desktop routes taps once, tracks screen movement, and releases cancelled drags without a tap', () => {
  const source=readFileSync('src/CompanionWindow.tsx','utf8');
  const code=source.slice(source.indexOf('  function onPointerDown('),source.indexOf('  function onContextMenu('));
  const calls: unknown[][]=[];
  const context:any={dragging:{current:false},movedByHand:{current:false},press:{current:null},home:{current:null},asking:true,
    svgHandle:{current:{tap:()=>calls.push(['tap']),drag:(p:any)=>calls.push(['drag',p])}},performance:{now:()=>100},
    window:{haru:{companion:{dragging:(...args:any[])=>calls.push(['held',...args]),moveBy:(...args:any[])=>calls.push(['move',...args]),poke:()=>assert.fail('visual tap must not be replaced by a backend poke')}}}};
  vm.runInNewContext(stripTypeScriptTypes(code)+';globalThis.input={onPointerDown,onPointerMove,onPointerUp,cancelDrag}',context);
  const target={setPointerCapture(){},releasePointerCapture(){},hasPointerCapture:()=>true};
  const event=(x:number,y:number,id=1)=>({button:0,isPrimary:true,pointerId:id,screenX:x,screenY:y,currentTarget:target});
  const input=context.input;
  input.onPointerDown(event(100,100)); input.onPointerUp(event(102,100));
  assert.equal(calls.filter(c=>c[0]==='tap').length,1);
  input.onPointerDown(event(100,100)); input.onPointerMove(event(102,100));
  assert.equal(calls.filter(c=>c[0]==='move').length,0);
  input.onPointerMove(event(150,120,2)); assert.equal(calls.filter(c=>c[0]==='move').length,0);
  input.onPointerMove(event(150,120)); input.onPointerMove(event(160,115));
  assert.deepEqual(calls.filter(c=>c[0]==='move'),[['move',50,20],['move',10,-5]]);
  input.onPointerUp(event(160,115)); input.cancelDrag();
  assert.deepEqual(calls.at(-1),['held',false,true]);
  assert.equal(calls.filter(c=>c[0]==='tap').length,1);
  input.onPointerDown(event(100,100)); input.cancelDrag(); input.onPointerUp(event(100,100));
  assert.equal(context.dragging.current,false); assert.equal(context.press.current,null);
  assert.equal(calls.filter(c=>c[0]==='tap').length,1);
  assert.ok(calls.some(c=>c[0]==='drag' && c[1]===null));
});
