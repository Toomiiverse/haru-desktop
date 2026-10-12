import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseLockedDisplay,clampAvatar,surfacesOnDisplay,desktopScene,chooseVisit,visitTarget} from '../electron/desktopAwareness';

const main={id:1,bounds:{x:0,y:0,width:2560,height:1440},workArea:{x:0,y:0,width:2560,height:1400}};
const portrait={id:2,bounds:{x:-1440,y:-652,width:1440,height:2560},workArea:{x:-1440,y:-652,width:1440,height:2520}};
const body={x:400,y:700,width:300,height:400},metrics={head:.08,seat:.52,feet:.95,halfWidth:.19};
const surface=(id:string,x:number,y:number,width=700,height=800,eligible=true)=>({id,x,y,width,height,eligible});

test('monitor lock captures current display, survives a dragged target, and falls back on disconnect',()=>{
 assert.equal(chooseLockedDisplay([main,portrait],undefined,body).id,1);
 const other={...body,x:-900,y:100};
 assert.equal(chooseLockedDisplay([main,portrait],undefined,other).id,2,'current monitor wins over primary');
 assert.equal(chooseLockedDisplay([main,portrait],1,other).id,1,'dragging cannot change a saved lock');
 assert.equal(chooseLockedDisplay([portrait],1,body).id,2,'removing the locked display picks the surviving monitor');
 for(const display of [main,portrait])for(const x of [-10000,-1400,200,10000])for(const y of [-10000,0,10000]){
  const p=clampAvatar(display.workArea,{...body,x,y},metrics),work=display.workArea;
  assert.ok(p.x>=work.x && p.x+body.width<=work.x+work.width);
  assert.ok(p.y+body.height*metrics.head>=work.y-1 && p.y+body.height*metrics.feet<=work.y+work.height+1,'head and soles stay on chosen display');
 }
});

test('window count and occupied area use only this display and do not double-count overlapping windows',()=>{
 const work={x:-500,y:-500,width:1000,height:1000};
 const surfaces=[surface('1:1',-450,-450,100,100),surface('2:2',-400,-450,100,100),surface('3:3',1000,1000)];
 const scene=desktopScene(surfaces,work,body,2);
 assert.equal(scene.windowCount,2);assert.equal(scene.crowding,.015,'negative monitor coordinates retain correct union area');
 assert.deepEqual(scene.occluders,[],'ordinary idle remains in front');
 assert.equal(surfacesOnDisplay([surface('4:4',499,0,100,100)],work).length,0,'one-pixel border overlap is not a local window');
});

test('hiding respects front-to-back windows and clears when its window disappears',()=>{
 const front=surface('1:1',300,100),target=surface('2:2',500,300),back=surface('3:3',100,100),other=surface('4:4',-1200,0);
 const scene=desktopScene([front,other,target,back],main.workArea,body,1,null,target.id);
 assert.equal(scene.windowCount,3);assert.equal(scene.occluders.length,2,'target and windows in front conceal the avatar');
 assert.deepEqual(scene.focus,{x:850,y:480});
 assert.deepEqual(desktopScene([front,back],main.workArea,body,1,null,target.id).occluders,[],'closing target removes all visit occlusion');
 assert.ok(scene.occluders.every(r=>r.x>=0 && r.x+r.width<=2560));
});

test('visits use exposed edges with room on the selected display',()=>{
 const target=surface('1:1',700,450,800,900),other=surface('2:2',-1200,200);
 const scene=[target,other];
 for(const choice of [0,.3,.6,.99]){
  const visit=chooseVisit(scene,main.workArea,body,metrics,()=>choice);assert.ok(visit);assert.equal(visit.id,target.id);
  const p=visitTarget(target,visit.edge,main.workArea,body,metrics,visit.offset);assert.ok(p);
  assert.deepEqual(p,clampAvatar(main.workArea,{...body,...p},metrics));
 }
 assert.equal(chooseVisit([surface('3:3',0,0,2560,1400,false),target],main.workArea,body,metrics),null,'covered edges cannot be visited');
 assert.equal(visitTarget(surface('4:4',0,300),'left',main.workArea,body,metrics),null,'no side peek through monitor boundary');
 assert.equal(visitTarget(surface('5:5',400,0),'top',main.workArea,body,metrics),null,'no top peek without headroom');
 assert.equal(visitTarget(surface('6:6',400,100,600,200),'left',main.workArea,body,metrics),null,'floor-level side peek needs a window at face height');
 assert.equal(chooseVisit([other],main.workArea,body,metrics),null,'other monitor is never a destination');
});

test('ongoing visit targets become invalid when a foreground window covers their edge',()=>{
 const target=surface('1:1',700,450,800,900),cover=surface('2:2',600,300,1000,1100,false);
 for(const edge of ['left','right','top'] as const){
  assert.ok(visitTarget(target,edge,main.workArea,body,metrics,.5,[target,cover]),'a background window leaves the edge exposed');
  assert.equal(visitTarget(target,edge,main.workArea,body,metrics,.5,[cover,target]),null,'bringing it forward invalidates the current edge');
 }
 const shoulderCover=surface('3:3',1120,400,100,200,false);
 assert.equal(visitTarget(target,'top',main.workArea,body,metrics,.5,[shoulderCover,target]),null,'top peeks need room for the body width, not only its center');
});
