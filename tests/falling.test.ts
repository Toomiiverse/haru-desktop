import {chooseLockedDisplay,clampAvatar,surfacesOnDisplay,desktopScene,chooseVisit,visitTarget,type DesktopVisit} from "../electron/desktopAwareness";
import {readRoamConfig,mayWander,pickDestination,refugeFrom,speedFor,step,nextWanderDelay,type Rect} from "../electron/roam";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fallFrame,fallPosition,landingDuration,groundPosition,jumpFrame,jumpPosition,readPerchMetrics,choosePerch as realChoosePerch,perchPosition as realPerchPosition,type PerchFall,type PerchState,type DesktopSurface} from '../electron/perching';

test('fall timing waits for observed contact and gives landing its full recovery',()=>{
  const falling:PerchFall={started:1000,duration:600,strength:.65};
  assert.deepEqual(fallFrame(falling,900),{phase:'fall',progress:0,strength:.65});
  assert.equal(fallFrame(falling,1300).progress,.5);
  assert.deepEqual(fallFrame(falling,5000),{phase:'fall',progress:1,strength:.65},'a delayed native move cannot land by timer');
  const landed={...falling,landed:5100};
  const duration=landingDuration(landed.strength),end=landed.landed+Math.ceil(duration);
  assert.deepEqual(fallFrame(landed,5100),{phase:'land',progress:0,strength:.65});
  assert.ok(Math.abs(fallFrame(landed,landed.landed+duration/2).progress-.5)<1e-12);
  assert.equal(fallFrame(landed,end-1).phase,'land');
  assert.equal(fallFrame(landed,end).phase,'done');
  assert.equal(fallFrame({...falling,landed:0},400).phase,'land','a zero contact timestamp is valid');
  assert.equal(fallFrame(falling,1100,true).phase,'done');
  assert.equal(fallFrame({...falling,duration:0},1100).progress,1);
  const oldState:PerchState={seated:false,jump:null};assert.equal(oldState.fall,undefined);
});

test('one-foot balance recovery grows smoothly from small to high drops',()=>{
  for(const strength of [-1,0,.2])assert.equal(landingDuration(strength),1000);
  assert.ok(Math.abs(landingDuration(.6)-1600)<1e-10);
  for(const strength of [1,2])assert.equal(landingDuration(strength),2200);
  let previous=1000;
  for(let i=0;i<=100;i++) {
    const duration=landingDuration(i/100);
    assert.ok(duration>=previous && duration>=1000 && duration<=2200);previous=duration;
  }
  for(const strength of [.2,1]) {
    const fall={started:0,duration:500,strength,landed:1000},end=1000+landingDuration(strength);
    assert.equal(fallFrame(fall,end-1).phase,'land');assert.equal(fallFrame(fall,end).phase,'done');
  }
});

// Execute only the actual movement functions/IPC handlers, with an asynchronous
// native-window fixture. Importing main itself would launch Electron and services.
function lifecycle() {
  const source=readFileSync(resolve(__dirname,'../../electron/main.ts'),'utf8').replaceAll('\r\n','\n');
  const part=(start:string,end:string)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0 && b>a,`main lifecycle section ${start}`);return source.slice(a,b);};
  const handlers=new Map<string,(...args:any[])=>unknown>(),settings=new Map<string,unknown>([['roam',{enabled:true,restlessness:.8,avoidFullscreen:true}],['avatar.kind','model']]);
  let now=1000,body={x:200,y:200,width:300,height:400},pending:{x:number;y:number}|null=null,checks=0,random=.5;
  const work={x:0,y:0,width:1600,height:1000},metrics={head:.1,seat:.52,feet:.95,halfWidth:.19};
  let displays=[{id:1,bounds:work,workArea:work},{id:2,bounds:{x:1600,y:0,width:1200,height:1000},workArea:{x:1600,y:0,width:1200,height:1000}}];
  const events:PerchState[]=[];
  const contents={on:(name:string,cb:()=>void)=>handlers.set(name,cb)};
  const companionWindow={webContents:contents,getBounds:()=>({...body}),isDestroyed:()=>false,isVisible:()=>true,setIgnoreMouseEvents:()=>{},setBounds:(value:typeof body)=>{body={...value};},setPosition:(x:number,y:number)=>{pending={x,y};}};
  const context={
    Date:{now:()=>now},Math:Object.assign(Object.create(Math),{random:()=>random}),process:{platform:'linux'},console:{log:()=>{}},companionWindow,
    screen:{getAllDisplays:()=>displays,getPrimaryDisplay:()=>displays[0],getDisplayMatching:(r:typeof body)=>chooseLockedDisplay(displays,undefined,r),screenToDipRect:(_w:unknown,r:unknown)=>r,on:(name:string,callback:(...args:any[])=>void)=>handlers.set(name,callback)},
    currentModelPath:()=> 'Wolfram.vrm',store:{get:(name:string,fallback?:unknown)=>settings.has(name)?settings.get(name):fallback,set:(name:string,value:unknown)=>settings.set(name,value)},BrowserWindow:{getAllWindows:()=>[]},
    groundPosition,fallPosition,fallFrame,jumpFrame,jumpPosition,readPerchMetrics,chooseLockedDisplay,clampAvatar,surfacesOnDisplay,desktopScene,chooseVisit,visitTarget,
    readRoamConfig,mayWander,pickDestination:(work:Rect,body:Rect)=>pickDestination(work,body,()=>.99),refugeFrom,speedFor,step,nextWanderDelay,
    choosePerch:()=>{checks++;return null;},perchPosition:()=>({x:200,y:100}),
    reportWalk:()=>{},sendToWindows:(_name:string,state:PerchState)=>{if(_name==='companion:perching')events.push(structuredClone(state));},
    COMPANION_ASPECT:4/3,COMPANION_MIN_WIDTH:96,COMPANION_MAX_WIDTH:1000,ROAM_TICK_MS:30,
    setInterval:()=>1,ipcMain:{handle:(name:string,handler:(...args:any[])=>unknown)=>handlers.set(name,handler)},api:null as any,
  };
  const code=`let desktopSurfaces=[],surfacesAt=0,perchMetrics=${JSON.stringify(metrics)},perched=null,perchMove=null,perchFall=null;
    let perchHoldUntil=0,nextPerchCheck=0,companionDragging=false,perchReducedMotion=false,ignoringCompanionMouse=false;
    let summonOpen=false,speakingNow=false,microphoneListening=false,walkingTo=null,lastUserMovedAt=0,nextWanderAt=0,lastWalkAt=0,roamTimer=null,watchingScreen=null;
    ${part('let desktopVisit:', 'function freshSurfaces()')}
    ${part('function freshSurfaces()', 'function positionCompanion(')}
    ${part('function positionCompanion(', 'function perchTick(')}
    ${part('function perchTick(', '/** Tells the renderer')}
    ${part('function walkTo(', 'function broadcastLive2DChange(')}
    ${part('function clampCompanionWidth(', '/**\n * Where she comes back to.')}
    ${part('function broadcastLive2DChange(', 'function broadcastChatReset(')}
    ${['moveBy','resizeBy','placement','dragging'].map(name=>part(`  ipcMain.handle('companion:${name}'`, '\n  });')+'\n  });').join('\n')}
    ${part("  companionWindow.webContents.on('did-start-loading'",'\n  });')+'\n  });'}
    globalThis.api={settleOnGround,detachPerch,attachPerch,broadcastLive2DChange,state:perchState,tick:()=>perchTick(Date.now(),companionWindow.getBounds()),
      roamTick,startRoaming,beginDesktopVisit,visit:()=>visitTick(Date.now(),companionWindow.getBounds()),reconcileCompanionDisplay,
      setSurfaces:rows=>{desktopSurfaces=rows;surfacesAt=Date.now();},visitState:()=>desktopVisit,
      setBusy:(name,value)=>{if(name==='speaking')speakingNow=value;if(name==='listening')microphoneListening=value;if(name==='summon')summonOpen=value;},
      clamp:clampCompanionPosition,display:companionDisplay,walkTo,desktopGeometryNote,
      scheduleWander:()=>{lastUserMovedAt=0;nextWanderAt=Date.now();perchHoldUntil=Date.now()+100_000;},walkTarget:()=>walkingTo};`;
  runInNewContext(stripTypeScriptTypes(code,{mode:'strip'}),context);
  return {
    api:context.api as {settleOnGround(react?:boolean):void;detachPerch(land:boolean):void;attachPerch(perch:{id:string;offset:number}):void;broadcastLive2DChange(model:null):void;state():PerchState;tick():boolean;
      roamTick():void;startRoaming():void;beginDesktopVisit(visit:DesktopVisit,body:Rect):boolean;visit():boolean;reconcileCompanionDisplay():void;setSurfaces(rows:DesktopSurface[]):void;visitState():any;setBusy(name:string,value:boolean):void;clamp(x:number,y:number,w:number,h:number):{x:number;y:number};display(body?:Rect):{id:number};walkTo(point:{x:number;y:number}):void;desktopGeometryNote():string;scheduleWander():void;walkTarget():{x:number;y:number}|null},
    events,metrics,settings,get body(){return {...body};},get pending(){return pending;},get checks(){return checks;},
    time:(value:number)=>{now=value;},place:(value:Partial<typeof body>)=>{body={...body,...value};},
    displays:(ids:number[])=>{displays=displays.filter(d=>ids.includes(d.id));},random:(value:number)=>{random=value;},
    acknowledge:()=>{assert.ok(pending);body={...body,...pending};pending=null;},
    call:(name:string,...args:unknown[])=>handlers.get('companion:'+name)!({sender:contents},...args),
    reload:()=>handlers.get('did-start-loading')!(),
  };
}

test('real movement lifecycle reports start, actual ground contact and recovery end',()=>{
  const f=lifecycle();f.api.settleOnGround();const started=f.api.state().fall!;
  assert.equal(started.started,1000);assert.ok(started.strength>.9 && started.strength<1);assert.equal(started.landed,undefined);
  const target=groundPosition({x:0,y:0,width:1600,height:1000},f.body,.95);
  f.time(started.started+started.duration/2);assert.equal(f.api.tick(),true);
  const expected=fallPosition(f.body,target,started.duration/2,started.duration);
  assert.deepEqual(f.pending,{x:Math.round(expected.x),y:Math.round(expected.y)},'native gravity interpolation is retained');
  f.time(5000);f.api.tick();assert.equal(f.api.state().fall!.landed,undefined,'a dispatched final position is not observed contact');
  assert.equal(f.events.length,1);f.acknowledge();f.time(5030);f.api.tick();
  assert.equal(f.api.state().fall!.landed,5030);assert.equal(f.events.length,2);
  const end=5030+Math.ceil(landingDuration(started.strength));
  f.time(end-1);assert.equal(f.api.tick(),true);assert.equal(f.checks,0,'landing blocks roaming and automatic reseating');
  f.time(end);assert.equal(f.api.tick(),false);assert.equal(f.api.state().fall,null);assert.equal(f.events.length,3);assert.equal(f.checks,1);
});

test('measured drop height distinguishes small, medium and high falls at any avatar size',()=>{
  const ratios=[.1,.4,.8,1.1,1.5];
  for(const height of [200,400,800]) {
    const measured=ratios.map(ratio=>{
      const f=lifecycle();f.place({height,y:1000-height*.95-height*ratio});f.api.settleOnGround();
      const strength=f.api.state().fall!.strength;
      assert.ok(Math.abs(strength-Math.min(1,Math.sqrt(ratio/1.1)))<1e-12);
      return strength;
    });
    assert.ok(measured[0]<measured[1] && measured[1]<measured[2] && measured[2]<measured[3]);
    assert.ok(Math.abs(measured[3]-1)<1e-12);assert.equal(measured[4],1);
    assert.ok(landingDuration(measured[0])<landingDuration(measured[1]) && landingDuration(measured[1])<landingDuration(measured[2]));
  }
});

test('floor corrections and reduced motion do not trigger surprise',()=>{
  for(const distance of [-80,0,3,8]) {
    const f=lifecycle();f.place({y:620-distance});f.api.settleOnGround();assert.equal(f.api.state().fall,null,`correction ${distance}px`);
  }
  const small=lifecycle();small.place({y:611});small.api.settleOnGround();assert.equal(small.api.state().fall!.strength,.2);
  const reduced=lifecycle();reduced.call('placement',{...reduced.metrics,reduced:true});reduced.api.settleOnGround();assert.equal(reduced.api.state().fall,null);
});

test('dragging, manual moves, resizing, reloads, models, reduced motion and reseating cancel a fall',()=>{
  const cancel=[
    (f:ReturnType<typeof lifecycle>)=>f.call('dragging',true,false),
    (f:ReturnType<typeof lifecycle>)=>f.call('moveBy',10,10),
    (f:ReturnType<typeof lifecycle>)=>f.call('resizeBy',1.1),
    (f:ReturnType<typeof lifecycle>)=>f.reload(),
    (f:ReturnType<typeof lifecycle>)=>f.api.broadcastLive2DChange(null),
    (f:ReturnType<typeof lifecycle>)=>f.call('placement',{...f.metrics,reduced:true}),
    (f:ReturnType<typeof lifecycle>)=>f.api.attachPerch({id:'10:20',offset:.5}),
  ];
  for(const action of cancel)for(const landed of [false,true]) {
    const f=lifecycle();f.api.settleOnGround();assert.ok(f.api.state().fall);
    if(landed){f.time(5000);f.api.tick();f.acknowledge();f.time(5030);f.api.tick();assert.ok(f.api.state().fall!.landed);}
    action(f);
    assert.equal(f.api.state().fall,null);assert.equal(f.events.at(-1)!.fall,null,'renderer is told about cancellation');
  }
  const resize=lifecycle();resize.api.settleOnGround();resize.call('resizeBy',1.1);resize.api.tick();
  assert.equal(resize.api.state().fall,null,'resize correction remains quiet on the next movement tick');
  const seat=lifecycle();seat.api.attachPerch({id:'10:20',offset:.5});seat.api.detachPerch(true);
  assert.equal(seat.api.state().seated,false);assert.ok(seat.api.state().fall,'getting down begins a genuine descent');
});

test('native drag, resize, walking and monitor removal retain the chosen display',()=>{
  const f=lifecycle();f.place({y:620});assert.equal(f.api.display(f.body).id,1);
  f.call('moveBy',2200,2000);f.acknowledge();assert.equal(f.body.x,1300);assert.equal(f.body.y,620);
  f.call('resizeBy',2);assert.ok(f.body.x>=0 && f.body.x+f.body.width<=1600);
  f.api.walkTo({x:2400,y:300});f.time(3000);f.api.roamTick();if(f.pending)f.acknowledge();
  assert.ok(f.body.x+f.body.width<=1600);assert.equal(f.settings.get('companion.displayId'),1);
  f.displays([2]);f.api.reconcileCompanionDisplay();assert.equal(f.settings.get('companion.displayId'),2);
  assert.ok(f.body.x>=1600 && f.body.x+f.body.width<=2800);assert.equal(f.api.state().fall,null);
});

test('window-edge seats agree with the single-monitor movement clamp',()=>{
  const work={x:-1440,y:-652,width:1440,height:2560},body={x:-1440,y:150,width:400,height:480},metrics={head:.1,seat:.52,feet:.95,halfWidth:.19};
  const window={id:'10:20',eligible:true,x:-1500,y:500,width:900,height:600};
  const target=realChoosePerch([window],body,metrics,[work],false);assert.ok(target);
  const point=realPerchPosition(target,[window],body,metrics,[work]);assert.ok(point);
  assert.deepEqual(clampAvatar(work,{...body,...point},metrics),point,'perching never requests a position the native clamp must change');
  assert.equal(realPerchPosition({id:window.id,offset:.05},[window],body,metrics,[work]),null,'a moving window cannot pull the attached canvas beyond the monitor');
});

test('automatic walking migration applies once and honors later user toggles',()=>{
  const fresh=lifecycle();fresh.settings.set('roam',{enabled:false});fresh.api.startRoaming();
  assert.equal((fresh.settings.get('roam') as {enabled:boolean}).enabled,true);assert.equal(fresh.settings.get('companion.desktopRoamVersion'),1);
  fresh.settings.set('roam',{enabled:false});fresh.api.startRoaming();assert.equal((fresh.settings.get('roam') as {enabled:boolean}).enabled,false);
  const resumed=lifecycle();resumed.settings.set('companion.desktopRoamVersion',1);resumed.settings.set('roam',{enabled:false});resumed.api.startRoaming();assert.equal((resumed.settings.get('roam') as {enabled:boolean}).enabled,false);
});

const visitSurface:DesktopSurface={id:'10:20',x:500,y:200,width:600,height:800,eligible:true};
test('side and top visits hide, peek, and return with normal jump/fall ownership',()=>{
  for(const edge of ['left','top'] as const){
    const f=lifecycle();f.place({y:620});f.api.setSurfaces([visitSurface,{...visitSurface,id:'20:30',x:1900}]);
    assert.equal(f.api.beginDesktopVisit({id:visitSurface.id,edge,offset:.5},f.body),true);
    let sawPeek=false,sawJump=false,sawFall=false,ended=false;
    for(let now=1030;now<50_000;now+=30){
      f.time(now);f.api.setSurfaces([visitSurface]);f.api.roamTick();if(f.pending)f.acknowledge();
      const state=f.api.state();sawJump ||= !!state.jump;sawFall ||= !!state.fall;
      if(state.desktop?.peek){sawPeek=true;assert.equal(state.desktop.peek.edge,edge);assert.equal(state.seated,false);assert.equal(state.jump,null);assert.equal(state.fall,null);assert.ok(state.desktop.occluders.length>0);}
      assert.ok(f.body.x>=0 && f.body.x+f.body.width<=1600,'every native move remains on the chosen monitor');
      if(!f.api.visitState()){ended=true;break;}
    }
    assert.ok(sawPeek && ended,`${edge} visit completes`);assert.equal(sawJump,edge==='top');assert.equal(sawFall,edge==='top');
    assert.ok(Math.abs(f.body.x-200)<=2 && Math.abs(f.body.y-620)<=2,'she walks back to the original floor position');
  }
});

test('conversation, missing windows and disabled roaming cancel visits',()=>{
  for(const reason of ['speaking','listening','summon','missing','disabled'] as const){
    const f=lifecycle();f.place({y:620});f.api.setSurfaces([visitSurface]);f.api.beginDesktopVisit({id:visitSurface.id,edge:'left',offset:.5},f.body);
    if(reason==='missing')f.api.setSurfaces([]);else if(reason==='disabled')f.settings.set('roam',{enabled:false});else f.api.setBusy(reason,true);
    f.api.visit();assert.equal(f.api.visitState(),null);assert.equal(f.api.state().desktop?.peek,null);
  }
});

test('covering an active peek clears its mask and lowers an elevated avatar',()=>{
 for(const edge of ['left','top'] as const){
  const f=lifecycle();f.place({y:620});f.api.setSurfaces([visitSurface]);
  f.api.beginDesktopVisit({id:visitSurface.id,edge,offset:.5},f.body);
  for(let now=1030;now<50_000 && !f.api.state().desktop?.peek;now+=30){
   f.time(now);f.api.setSurfaces([visitSurface]);f.api.roamTick();if(f.pending)f.acknowledge();
  }
  assert.ok(f.api.state().desktop?.peek,'the visit reaches its intended peek');
  f.api.setSurfaces([{id:'30:40',x:0,y:0,width:1600,height:1000,eligible:false},visitSurface]);f.api.visit();
  assert.equal(f.api.visitState(),null);assert.equal(f.api.state().desktop?.peek,null);
  assert.equal(f.api.state().desktop?.occluders.length,0,'new foreground coverage cannot leave her indefinitely hidden');
  assert.equal(!!f.api.state().fall,edge==='top','top peeks return to the floor through the existing fall animation');
  assert.equal(f.api.walkTarget(),null);
 }
});

test('crowding reduces exploratory visits and shortens ordinary walks',()=>{
  const choose=(crowded:boolean,random:number)=>{
    const f=lifecycle();f.place({y:620});f.time(100_000);f.random(random);
    f.api.setSurfaces([visitSurface,...crowded?[{id:'30:40',x:0,y:0,width:1600,height:1000,eligible:false}]:[]]);
    f.api.scheduleWander();f.api.roamTick();return f;
  };
  assert.ok(choose(false,.4).api.visitState(),'an uncrowded desktop can invite a window visit');
  assert.equal(choose(true,.4).api.visitState(),null,'the same decision favors ordinary walking on a crowded desktop');
  const normal=choose(false,.99),crowded=choose(true,.99);
  assert.equal(normal.api.visitState(),null,'some ordinary walks remain available between visits');
  assert.ok(crowded.api.walkTarget()!.x-200<(normal.api.walkTarget()!.x-200)*.7,'clutter shortens the actual native walking target');
});
