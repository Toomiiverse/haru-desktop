import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopAnchor, panelContact } from '../src/companion/placement';
import { desktopScene } from '../electron/desktopAwareness';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

test('her favourite corner and exposed edges are stable, preserve manual home, and stay on negative-coordinate monitors', () => {
  const work={x:-1200,y:-200,width:1200,height:900},body={x:-800,y:100,width:200,height:200};
  const scene=desktopScene([],work,body,2);
  assert.deepEqual(desktopAnchor(scene),{x:-212,y:488});
  const windows=[{id:'1:1',eligible:true,x:-500,y:0,width:500,height:700}];
  const busy=desktopScene(windows,work,body,2),point=desktopAnchor(busy)!;
  assert.ok(point.x+body.width<=windows[0].x || point.y+body.height<=windows[0].y);
  assert.deepEqual(desktopAnchor(busy),point,'no timer or random destination');
  assert.deepEqual(desktopAnchor(scene,{x:-1000,y:0}),{x:-1000,y:0});
  assert.deepEqual(desktopAnchor(desktopScene([{...windows[0],...work}],work,body,2)),desktopAnchor(scene),'a covered corner stays home behind the window');
  assert.equal(desktopAnchor({...scene,workArea:undefined}),null,'older geometry cannot move her blindly');
});

test('phone artwork contacts left, right and top; oversized framing centres without a collision loop', () => {
  const panel={x:0,y:0,width:390,height:260};
  for(const [body,wall] of [[{x:-12,y:30,width:140,height:140},'left'],[{x:300,y:30,width:140,height:140},'right'],[{x:100,y:-15,width:140,height:140},'top']] as const){
    const contact=panelContact(body,panel);assert.equal(contact.wall,wall);
    const corrected={...body,x:body.x+contact.x,y:body.y+contact.y};
    assert.equal(panelContact(corrected,panel).wall,'');
    assert.ok(corrected.x>=0 && corrected.x+corrected.width<=390 && corrected.y>=0);
  }
  assert.equal(panelContact({x:-100,y:-50,width:600,height:600},panel).wall,'');
});

test('desktop window masks combine overlap, relinquish hit testing and reveal only during engagement', () => {
  const source=readFileSync('src/components/SvgAvatarCanvas.tsx','utf8');
  const fn=source.slice(source.indexOf('    function maskDesktop('),source.indexOf('    function idleFor('));
  const style={maskImage:''};
  const c:any={container:{style,getBoundingClientRect:()=>({x:0,y:0,width:300,height:300})},window:{screenX:100,screenY:200},maskedWindows:[],maskKey:'',dragPoint:null,claim:null,claimUntil:0};
  vm.runInNewContext(stripTypeScriptTypes(fn)+';globalThis.mask=maskDesktop',c);
  const reading={mouth:{open:0,weight:0},desktop:{windows:[{x:120,y:210,width:400,height:400},{x:200,y:250,width:200,height:200}]}};
  c.mask(0,reading);const mask=decodeURIComponent(style.maskImage);
  assert.equal((mask.match(/fill="black"/g)||[]).length,2);assert.ok(mask.includes('mask="url(#m)"'));
  assert.equal(c.maskedWindows.length,2);
  c.mask(0,{...reading,engaged:true});assert.equal(style.maskImage,'');assert.equal(c.maskedWindows.length,0);
  c.mask(0,reading);assert.ok(style.maskImage);c.claim={why:'talking'};c.claimUntil=1000;c.mask(10,reading);assert.equal(style.maskImage,'');
});

test('one wall bump produces one squash, even when the squash briefly breaks contact', () => {
  const source=readFileSync('src/components/SvgAvatarCanvas.tsx','utf8');
  const fn=source.slice(source.indexOf('    function constrainPanel('),source.indexOf('    function maskDesktop('));
  let width=110, now=0, bumps=0;
  const c:any={callbacks:{current:{roam:true}},front:0,correction:{x:0,y:0},contactWall:'',contactUntil:0,
    boundary:{style:{}},body:{},reduced:false,panelContact,clock:()=>now,animate:()=>bumps++,
    container:{getBoundingClientRect:()=>({x:0,y:0,width:390,height:260})}};
  const svg={getScreenCTM:()=>c.correction,getBBox:()=>({x:300,y:40,width,height:140})};
  c.faces=[{querySelector:()=>svg}];c.DOMPoint=class {constructor(public x:number,public y:number){} matrixTransform(m:any){return {x:this.x+m.x,y:this.y+m.y,w:1};}};
  vm.runInNewContext(stripTypeScriptTypes(fn)+';globalThis.contact=constrainPanel',c);
  c.contact();assert.equal(bumps,1);width=80;now=80;c.contact();width=110;now=200;c.contact();now=500;c.contact();assert.equal(bumps,1);
  width=80;now=800;c.contact();width=110;now=900;c.contact();assert.equal(bumps,2,'a later genuine impact can squish again');
});
