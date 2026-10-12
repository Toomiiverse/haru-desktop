import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { idleMotion, fairyMotion, settleSpring, hairMotionTarget, dragMotionTarget, depthMotionTarget } from '../src/companion/idle';

test('fairy hover stays local and fluid, yields to typing, and becomes faint during sleep', () => {
  const source=readFileSync('src/components/SvgAvatarCanvas.tsx','utf8');
  const code=source.slice(source.indexOf('      const idle = idleMotion('),source.indexOf('      const decay = dragPoint'));
  const sample=new vm.Script('(function(){'+stripTypeScriptTypes(code)+'})()');
  const range=(a:number[])=>Math.max(...a)-Math.min(...a);
  const run=(fps:number, rest=0, peek=false)=>{
    const c:any={idleMotion,fairyMotion,settleSpring,time:0,dt:1/fps,quiet:false,fallingAsleep:0,mouth:{weight:0},claim:null,claimUntil:0,
      glow:{breath:.5},restAmount:rest,dragPoint:null,reactionUntil:0,flightX:0,box:{style:{}},reading:{peek},engine:{emotion:()=> 'neutral'},hoverPose:[0,0,0],hoverSpeed:[0,0,0]};
    const context=vm.createContext(c),x:number[]=[],y:number[]=[],angles:number[]=[];
    for(let i=0;i<fps*30;i++){
      c.time=i*1000/fps;sample.runInContext(context);
      const shape=c.box.style.transform;
      assert.ok(shape.startsWith('translateX(0px)'),'chosen destination stays fixed');
      x.push(Number(shape.match(/translate\(calc\(var\(--avatar-size\) \* ([-.\d]+)/)[1])*300);
      y.push(Number(shape.match(/\+ var\(--avatar-size\) \* ([-.\d]+)/)[1])*300);
      angles.push(Number(shape.match(/rotate\(([-.\d]+)deg/)[1]));
      if(i) assert.ok(Math.abs(y[i]-y[i-1])<40/fps,'smooth travel, without a frame jump');
    }
    return {x,y,angles};
  };
  const awake=run(60),sleep=run(60,1),typing=run(60,0,true);
  assert.ok(range(awake.x)>12 && range(awake.x)<28,'small side arcs around home');
  assert.ok(range(awake.y)>25 && range(awake.y)<40,'a visible buoyant rise and dip');
  assert.ok(awake.angles.every(a=>Math.abs(a)<4.5),'gentle banking, never spinning');
  assert.ok(range(sleep.y)<range(awake.y)*.08,'sleep keeps only a faint hover');
  assert.ok(range(typing.y)<range(awake.y)*.3,'typing keeps her peek stable');
  for(const fps of [30,144]) assert.ok(Math.abs(range(run(fps).y)-range(awake.y))<.5,'consistent at different refresh rates');

});

test('hair follows a moving head, then settles consistently at different frame rates', () => {
  const trajectories = [30, 60, 144].map(fps => {
    let value = 0, speed = 0;
    const samples: number[] = [];
    for (let i = 1; i <= fps * 3; i++) {
      [value, speed] = settleSpring(value, speed, i <= fps ? 3 : 0, 95, 14, 1 / fps);
      assert.ok(Number.isFinite(value) && Math.abs(value) < 3.2);
      if (i % (fps / 2) === 0) samples.push(value);
    }
    assert.ok(samples[0] > 2.8, 'tuft follows the head');
    assert.ok(Math.abs(value) < .001 && Math.abs(speed) < .01, 'tuft returns to rest');
    return samples;
  });
  for (const samples of trajectories) samples.forEach((value, i) => assert.ok(Math.abs(value - trajectories[0][i]) < .04));
});

test('invalid or suspended frames cannot kick a strand out of place', () => {
  for (const dt of [0, -1, NaN, Infinity, 3]) assert.deepEqual(settleSpring(2, 15, -4, 95, 14, dt), [2, 0]);
});

test('fringe and tuft have different inertia, and a held tilt retains gravity', () => {
  const fringe = settleSpring(0, 0, 2, 210, 22, 1 / 30);
  const tuft = settleSpring(0, 0, 2, 95, 14, 1 / 30);
  assert.ok(fringe[0] > tuft[0], 'fringe catches up sooner');
  let value = 0, speed = 0;
  for (let i = 0; i < 120; i++) [value, speed] = settleSpring(value, speed, -.6, 95, 14, 1 / 60);
  assert.ok(Math.abs(value + .6) < .001, 'hair rests toward gravity during a held tilt');
});

test('idle channels stay subtle and do not repeat with the former 3.8-second loop', () => {
  const vitals = { energy: .55, sleepiness: .1, stress: 0 };
  let difference = 0;
  for (let t = 0; t < 60000; t += 50) {
    const a = idleMotion(t, vitals), b = idleMotion(t + 3800, vitals);
    assert.ok(a.breath >= 0 && a.breath <= 1 && Math.abs(a.driftX) < .01 && Math.abs(a.headZ) < 2.5);
    difference += Math.abs(a.headZ - b.headZ);
  }
  assert.ok(difference > 100);
});


test('head sway, tilt and nod drive both ears and hair, with lag and follow-through', () => {
  for (const ear of [false, true]) {
    const limit = ear ? 4 : 9;
    assert.ok(hairMotionTarget(0, 0, 60, 0, ear, 1, limit).angle < -.5, 'lags lateral travel');
    assert.ok(hairMotionTarget(8, 0, 0, 0, ear, 1, limit).angle < -1, 'held tilt retains gravity');
    assert.ok(hairMotionTarget(0, 40, 0, 0, ear, 1, limit).angle < -3, 'lags turning');
    const left = hairMotionTarget(0, 0, 0, 80, ear, -1, limit);
    const right = hairMotionTarget(0, 0, 0, 80, ear, 1, limit);
    assert.equal(left.angle, -right.angle, 'nod spreads opposite sides');
    assert.ok(left.stretch < 0, 'vertical travel compresses strands');
    let value = 0, speed = 0;
    for (let i = 0; i < 30; i++) [value, speed] = settleSpring(value, speed, left.angle, 100, 11, 1 / 60);
    const moving = value;
    [value, speed] = settleSpring(value, speed, 0, 100, 11, 1 / 60);
    assert.ok(Math.abs(value) > .5 * Math.abs(moving), 'does not snap when head stops');
    let crossed = false;
    for (let i = 0; i < 180; i++) {
      [value, speed] = settleSpring(value, speed, 0, 100, 11, 1 / 60);
      crossed ||= value > 0;
    }
    assert.ok(crossed && Math.abs(value) < .001, 'overshoots gently and settles');
    assert.equal(Math.abs(hairMotionTarget(0, 10000, 10000, 0, ear, 1, limit).angle), limit);
  }
});


test('drag deformation follows speed and direction, stays bounded and springs back on release', () => {
  const slow = dragMotionTarget(100, 0, 250, true), fast = dragMotionTarget(1500, 0, 250, true);
  assert.ok(fast[0] > slow[0] && fast[2] < slow[2], 'fast sideways motion stretches width');
  const vertical = dragMotionTarget(0, 1500, 250, true);
  assert.ok(vertical[2] > fast[2] && vertical[0] < fast[0]);
  assert.ok(dragMotionTarget(500, 500, 250, true)[1] > 0);
  assert.ok(dragMotionTarget(-500, 500, 250, true)[1] < 0);
  assert.deepEqual(dragMotionTarget(200, 0, 500, true), slow, 'same relative speed at another avatar size');
  for (const fps of [30,60,144]) {
    let values = [1,0,1,0], speeds = [0,0,0,0];
    for (let i=0;i<fps*4;i++) {
      const target = dragMotionTarget(100000, -100000, 250, i<fps);
      values = values.map((value,j) => {
        const next = settleSpring(value, speeds[j], target[j], 155, 15, 1/fps); speeds[j]=next[1]; return next[0];
      });
      assert.ok(values.every(Number.isFinite));
      assert.ok(values[0]*values[2]-values[1]*values[1] > .6, 'never flips or collapses');
    }
    values.forEach((v,i)=>assert.ok(Math.abs(v-[1,0,1,0][i])<.001, 'release returns to rest'));
  }
  assert.deepEqual(dragMotionTarget(NaN, 0, 250, true), [1,0,1,0]);
  assert.deepEqual(dragMotionTarget(10, 0, 0, true), [1,0,1,0]);
});


test('depth holds its size, looks toward gaze and leans forward only with attention', () => {
  const atRest=depthMotionTarget(0,0,0,false,false), near=depthMotionTarget(0,0,0,true,false), far=depthMotionTarget(0,0,0,false,true);
  assert.ok(near[0]>atRest[0] && far[0]<atRest[0]);
  assert.ok(depthMotionTarget(0,1,-1,false,false)[2]>0 && depthMotionTarget(0,-1,1,false,false)[1]<0);
  for(let t=0;t<60000;t+=33) {
    const pose=depthMotionTarget(t,10,-10,true,false);
    assert.ok(Math.abs(pose[0])<.15 && Math.abs(pose[1])<=8.5 && Math.abs(pose[2])<=12);
  }
  assert.deepEqual(depthMotionTarget(3000,0,0,false,false),atRest);
  assert.deepEqual(depthMotionTarget(NaN,0,0,false,false),[0,0,0]);
  // Same perspective ratio on desktop and phone: forward enlarges, retreat shrinks.
  for(const size of [128,250,600]) {
    const projected=(z:number)=>(size*2.8)/(size*2.8-size*z);
    assert.ok(projected(.82)>1.4 && projected(.82)<1.42);
    assert.ok(projected(-.95)>.74 && projected(-.95)<.75);
  }
});
