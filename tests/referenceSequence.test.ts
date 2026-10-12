import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceSequence, type ReferenceFrame } from '../src/companion/referenceSequence';
import { referenceClips, type ReferenceClip } from '../src/companion/referenceClips';

const near=(a:ReferenceFrame,b:ReferenceFrame,tolerance=1e-10)=>{
  assert.ok(Math.abs(a.weight-b.weight)<=tolerance,`ownership changed ${b.weight} -> ${a.weight}`);
  for(const key of new Set([...Object.keys(a.channels),...Object.keys(b.channels)]))
    assert.ok(Math.abs((a.channels[key]??0)-(b.channels[key]??0))<=tolerance,`${key} changed ${b.channels[key]} -> ${a.channels[key]}`);
};

test('reference performances hold or loop as authored, interrupt continuously, and release',()=>{
  assert.equal(referenceClips.length,10,'every user reference is installed');
  assert.equal(new Set(referenceClips.map(clip=>clip.name)).size,10,'each performance has a unique name');
  const rest={weight:0,channels:{}};
  for(const clip of referenceClips) {
    const sequence=new ReferenceSequence();
    near(sequence.update(0),rest);
    assert.ok(clip.keys.length>0 && clip.duration>0 && clip.tag,'a clip has animation, duration, and an emotion tag');
    for(let i=0;i<clip.keys.length;i++) {
      assert.ok(Number.isFinite(clip.keys[i].t) && clip.keys[i].t>=0 && clip.keys[i].t<=clip.duration);
      if(i)assert.ok(clip.keys[i].t>clip.keys[i-1].t,'keyframe times are ordered');
      assert.ok(Object.values(clip.keys[i].channels).every(Number.isFinite),'all source channels are finite');
    }
    assert.equal(sequence.start(clip.name,1000),true);
    assert.equal(sequence.currentName,clip.name);
    assert.deepEqual(sequence.update(1000),{weight:0,channels:clip.keys[0].channels},'an initial hand target is seeded at the first pose');
    for(let elapsed=0;elapsed<=clip.duration*1000+1000;elapsed+=1000/60) {
      const frame=sequence.update(1000+elapsed);
      assert.ok(Number.isFinite(frame.weight) && frame.weight>=0 && frame.weight<=1,'ownership stays bounded');
      assert.ok(Object.values(frame.channels).every(Number.isFinite),'every rendered channel stays finite');
    }
    const end=1000+clip.duration*1000;
    const held=sequence.update(end);
    near(sequence.update(end+(clip.loop?clip.duration*1000:10000)),held);
    assert.equal(held.weight,1);
    near(held,{weight:1,channels:clip.keys.at(-1)!.channels});
    assert.equal(sequence.start('unknown reference',end),false);
    near(sequence.update(end),held);
    assert.equal(sequence.currentName,clip.name,'unknown names do not interrupt a performance');

    for(const elapsed of [80,350,clip.duration*500,clip.duration*1000+500]) {
      sequence.start(clip.name,0);
      const before=sequence.update(elapsed);
      sequence.start(clip.name,elapsed);
      near(sequence.update(elapsed),before);
      const clearAt=elapsed+75,cleared=sequence.update(clearAt);
      sequence.clear(clearAt);
      near(sequence.update(clearAt),cleared);
      assert.equal(sequence.currentName,undefined);
      const fading=sequence.update(clearAt+275);
      assert.ok(Math.abs(fading.weight-cleared.weight*.5)<1e-10,'release fades ownership');
      assert.deepEqual(fading.channels,cleared.channels,'release keeps raw hand targets stationary');
      sequence.start(clip.name,clearAt+275);
      near(sequence.update(clearAt+275),fading);
      sequence.clear(clearAt+375);
      sequence.clear(clearAt+500);
      near(sequence.update(clearAt+925),rest);
      near(sequence.update(clearAt+10000),rest);
    }

    const reduced=new ReferenceSequence();
    reduced.start(clip.name,0,true);
    const quiet=reduced.update(0,true);
    assert.equal(quiet.weight,1,'reduced motion has no entrance travel');
    near(reduced.update(10000,true),quiet);
    const comparison=new ReferenceSequence();
    // Compare the actual reduced-motion pose against normal playback sampled
    // after its entry, including clips with a meaningful hold before the end.
    comparison.start(clip.name,0);
    if((clip.hold??clip.duration)>=.2)
      near(quiet,comparison.update((clip.hold??clip.duration)*1000));
    reduced.clear(10000,true);
    near(reduced.update(10000,true),rest);
  }
});

test('changing clips blends the union of raw channels without scaling hand coordinates',()=>{
  const fixtures:ReferenceClip[]=[
    {name:'__test outgoing',tag:referenceClips[0].tag,source:0,description:'Synthetic interruption check',duration:1,keys:[
      {t:0,channels:{handX:.6,oldOnly:2,stride:0}},{t:1,channels:{handX:.8,oldOnly:4,stride:1}},
    ]},
    {name:'__test incoming',tag:referenceClips[0].tag,source:0,description:'Synthetic interruption check',duration:1,hold:.5,keys:[
      {t:0,channels:{handX:-.3,newOnly:6}},{t:1,channels:{handX:-.1,newOnly:8}},
    ]},
  ];
  referenceClips.push(...fixtures);
  try {
    const sequence=new ReferenceSequence();
    sequence.start(fixtures[0].name,0);
    assert.ok(Math.abs(sequence.update(100).channels.handX-.6028)<1e-10,'half ownership does not halve a hand coordinate');
    assert.equal(sequence.update(250).channels.stride,.25,'stride phase advances linearly between keys');
    const before=sequence.update(400);
    sequence.start(fixtures[1].name,400);
    near(sequence.update(400),before);
    const halfway=sequence.update(500);
    assert.equal(halfway.channels.oldOnly,before.channels.oldOnly*.5,'outgoing-only channel fades toward zero');
    assert.ok(halfway.channels.newOnly>3,'incoming-only channel enters from zero');
    const after=sequence.update(600);
    assert.equal(after.channels.oldOnly,0,'outgoing-only channel reaches zero');
    assert.ok(after.channels.handX<0 && after.channels.newOnly>6);
    sequence.clear(600);
    const releasing=sequence.update(800);
    sequence.start(fixtures[0].name,800);
    near(sequence.update(800),releasing);
    sequence.start(fixtures[1].name,1000,true);
    near(sequence.update(1000,true),{weight:1,channels:{handX:-.2,newOnly:7,oldOnly:0}});
  } finally {
    referenceClips.splice(referenceClips.length-fixtures.length,fixtures.length);
  }
});

test('gait replays and switches advance from the visible phase without reverse cycles',()=>{
  const walks=referenceClips.filter(clip=>clip.keys.some(key=>(key.channels.gait??0)>0 && key.channels.stride!==undefined));
  assert.ok(walks.length>=2,'both reference gaits are present');
  const still=referenceClips.find(clip=>clip.keys.every(key=>key.channels.stride===undefined))!;
  const sequence=new ReferenceSequence();
  sequence.start(walks[1].name,0);
  for(const [name,now] of [[walks[1].name,3000],[walks[0].name,4000]] as const) {
    const before=sequence.update(now);
    assert.ok(before.channels.gait>0 && before.channels.stride>Math.PI*2,'interrupt an ongoing gait after a complete cycle');
    sequence.start(name,now);
    near(sequence.update(now),before);
    let previous=before.channels.stride;
    for(let frame=1;frame<=18;frame++) {
      const current=sequence.update(now+frame*1000/60).channels.stride;
      const step=current-previous;
      assert.ok(step>=-1e-10,'replay and gait changes never cycle backward');
      assert.ok(step<.2,'one rendered frame never skips a large fraction of a gait cycle');
      previous=current;
    }
    assert.ok(previous>before.channels.stride+1,'the incoming gait keeps advancing during its entrance');
  }
  const beforeExit=sequence.update(5000);
  sequence.start(still.name,5000);
  near(sequence.update(5000),beforeExit);
  for(const elapsed of [0,50,100,150,200,1000]) {
    const frame=sequence.update(5000+elapsed);
    assert.equal(frame.channels.stride,beforeExit.channels.stride,'leaving a gait holds its phase while its influence fades');
    assert.ok(frame.channels.gait>=0 && frame.channels.gait<=beforeExit.channels.gait);
  }
  assert.equal(sequence.update(5200).channels.gait,0);
  sequence.clear(6000);
  sequence.update(6550);
  sequence.start(walks[1].name,7000);
  const fresh=new ReferenceSequence();
  fresh.start(walks[1].name,7000);
  for(const elapsed of [0,100,200,500])
    near(sequence.update(7000+elapsed),fresh.update(7000+elapsed));
});

test('retiring an arm preserves its hand and wrist targets while arm influence fades',()=>{
  const cheek=referenceClips.find(clip=>clip.source===1)!;
  const hip=referenceClips.find(clip=>clip.source===3)!;
  const still=referenceClips.find(clip=>clip.keys.every(key=>key.channels.rightArm===undefined && key.channels.leftArm===undefined))!;
  assert.ok(cheek && hip && still,'cheek, hip, and a pose without arm gestures are available');
  for(const incoming of [hip,still]) {
    const sequence=new ReferenceSequence();
    sequence.start(cheek.name,0);
    const before=sequence.update(1000);
    sequence.start(incoming.name,1000);
    for(const elapsed of [0,50,100,150,200,500]) {
      const current=sequence.update(1000+elapsed);
      for(const key of ['rightX','rightY','rightZ'])
        assert.equal(current.channels[key],before.channels[key],`${key} holds instead of sweeping through the torso`);
      assert.ok(current.channels.rightArm>=0 && current.channels.rightArm<=before.channels.rightArm);
    }
    assert.equal(sequence.update(1200).channels.rightArm,0,'the retiring arm still blends out');
    sequence.clear(1500);
    assert.deepEqual(sequence.update(2050),{weight:0,channels:{}},'clear removes retained targets entirely');
  }

  const sequence=new ReferenceSequence();
  sequence.start(hip.name,0);
  const before=sequence.update(1000);
  sequence.start(still.name,1000);
  for(const elapsed of [0,50,100,150,200]) {
    const current=sequence.update(1000+elapsed);
    assert.equal(current.channels.leftWristZ,before.channels.leftWristZ,'retiring wrist orientation stays fixed');
    assert.equal(current.channels.leftY,before.channels.leftY);
  }
  sequence.start(cheek.name,1300);
  const midway=sequence.update(1400);
  assert.ok(midway.channels.rightY>0 && midway.channels.rightY<cheek.keys[0].channels.rightY,'a specified incoming target still interpolates normally');
});

test('facepalm keeps its pause, quick lift and head contact through interruption',()=>{
  const facepalm=referenceClips.find(clip=>clip.source===4)!;
  const stroll=referenceClips.find(clip=>clip.source===7)!;
  const sequence=new ReferenceSequence();sequence.start(facepalm.name,0);
  const start=sequence.update(300).channels,waiting=sequence.update(780).channels;
  assert.equal(waiting.rightY,start.rightY,'the hip pose waits for the deliberate lift');
  assert.ok(sequence.update(1000).channels.rightY-waiting.rightY>.30,'the arm rises decisively in the next quarter second');
  const contact=sequence.update(1100).channels,turned=sequence.update(1530).channels;
  assert.equal(contact.rightContact,1,'the hand reaches the temple before the main head turn');
  assert.ok(turned.headY<contact.headY-.30,'the head turns into the planted hand');
  assert.ok(sequence.update(2520).channels['vrc.v_aa']>sequence.update(2300).channels['vrc.v_aa']+.04,'the held expression retains a visible lip beat');
  const before=sequence.update(2600);sequence.start(stroll.name,2600);
  for(const ms of [0,50,100,150,200]) {
    const frame=sequence.update(2600+ms);
    for(const key of ['rightContactX','rightContactY','rightContactZ','rightContactWristZ','rightPoleX','rightPoleY','rightPoleZ'])
      assert.equal(frame.channels[key],before.channels[key],key+' must not collapse toward the head origin on exit');
  }
  assert.equal(sequence.update(2800).channels.rightContact,0);
});

test('warm smile keeps its attentive pause, quick happy closure and upright collarbone gesture',()=>{
  const clip=referenceClips.find(clip=>clip.source===5)!;
  const sequence=new ReferenceSequence();sequence.start(clip.name,0);
  const waiting=sequence.update(900).channels,arrived=sequence.update(1500).channels;
  assert.equal(waiting.rightArm,0,'hand must stay down through the attentive pause');
  assert.ok((waiting['Eyes Smile']??0)+(waiting['Eyes Smile2']??0)<.05,'happy eyes appeared too early');
  const closed=sequence.update(1200).channels;
  assert.ok((closed['Eyes Smile']??0)+(closed['Eyes Smile2']??0)>.95,'eye-smile should arrive in the quick reaction');
  assert.ok(arrived.rightY>.35&&arrived.rightY<.43,'wrist must arrive below the chin by the collarbone');
  assert.ok((arrived.headX??0)+(arrived.lean??0)+(arrived.chestLean??0)+(arrived.hipPitch??0)<-.035,'chin lift became a bow');
  assert.ok((arrived.headZ??0)+(arrived.sway??0)+(arrived.chestSway??0)+(arrived.hipRoll??0)<-.06,'head should tilt toward screen right');
  assert.ok(arrived.rightShoulderLift>.1&&arrived.leftShoulderForward<0,'shoulders did not lead/open with the gesture');
  assert.ok(arrived.rightIndexCurl<arrived.rightLittleCurl&&arrived.rightLittleCurl<.7,'raised hand became a fist');
  for(let t=1250;t<=5000;t+=50){
    const c=sequence.update(t).channels;
    assert.ok((c['Eyes Smile']??0)+(c['Eyes Smile2']??0)>.99,'happy lids reopened during the hold');
    assert.ok(Object.entries(c).every(([name,value])=>!/^vrc\.|Mouth Smile Open/.test(name)||value===0),'closed smile acquired speaking/laugh shapes');
  }
});

test('proud pose transfers the hip brace and bounces into a held closed-eye smile',()=>{
  const clip=referenceClips.find(clip=>clip.source===6)!;
  const sequence=new ReferenceSequence();sequence.start(clip.name,0);
  const waiting=sequence.update(2000).channels;
  assert.equal(waiting.leftArm,0,'left hand should wait through the composed pause');
  assert.equal(waiting.rightArm,1,'right hand begins braced at the hip');
  assert.equal(waiting['Eyes Smile'],0,'proud smile should wait for the shift');
  assert.ok(sequence.update(2130).channels['Eyes Smile']<.03,'eyes must still be open as the gesture begins');
  assert.ok(sequence.update(2260).channels['Eyes Smile']>.98,'happy eyes should close by the chest lift');
  const landed=sequence.update(3000).channels;
  assert.equal(landed.leftArm,1,'left hand must reach the waist');
  assert.ok(landed.rightY<waiting.rightY-.08,'right hand should relax below its original hip brace');
  assert.ok((landed.headY??0)+(landed.turn??0)+(landed.chestTurn??0)+(landed.hipYaw??0)<-.08,'proud head must face screen left');
  assert.ok((landed.headZ??0)+(landed.sway??0)+(landed.chestSway??0)+(landed.hipRoll??0)>.06,'proud tilt must oppose warm smile');
  assert.ok(sequence.update(2450).channels.weightY-sequence.update(2170).channels.weightY>.023,'body lift lost its planted knee compression');
  assert.ok(sequence.update(3100).channels.weightY-sequence.update(2760).channels.weightY>.017,'arrival lost its settling rebound');
  for(let t=2300;t<=6700;t+=50){
    const c=sequence.update(t).channels;
    assert.ok(c['Eyes Smile']>.99,'proud eyes reopened during the hold');
    assert.ok(Object.entries(c).every(([name,value])=>!/^vrc\.|Mouth Smile Open/.test(name)||value===0),'proud closed smile became an open-mouth laugh');
  }
});

test('cheek idle repeats its measured cycle without a pose or velocity seam',()=>{
  const clip=referenceClips.find(clip=>clip.source===1)!;
  assert.equal(clip.loop,true);
  assert.equal(clip.duration,5.6,'the source contains a partial second cycle, not a 7.9s loop');
  const sequence=new ReferenceSequence();sequence.start(clip.name,0);
  for(const offset of [600,1400,2800,3400,4400]){
    const pose=sequence.update(offset);
    for(const cycle of [1,2,10])near(sequence.update(offset+5600*cycle),pose,1e-8);
  }
  const before=sequence.update(5599),seam=sequence.update(5600),after=sequence.update(5601);
  near(before,after,.002);
  for(const name of Object.keys(seam.channels)) {
    const incoming=seam.channels[name]-before.channels[name],outgoing=after.channels[name]-seam.channels[name];
    assert.ok(Math.abs(incoming-outgoing)<.0001,'loop velocity jumped: '+name);
  }
  assert.equal(sequence.update(3400).channels['Eyes Sleep'],1,'source blink lost its timing');
  assert.ok(sequence.update(3600).channels['Eyes Sleep']<.15,'blink must reopen promptly');
  for(let t=300;t<=11200;t+=100){
    const c=sequence.update(t).channels;
    assert.equal(c.rightContact,1,'finger must follow the cheek during sway');
    assert.ok(c.rightIndexCurl>=.27 && c.rightIndexCurl<=.36,'finger trace became a straight eye poke');
    assert.ok(c.headZ+(c.sway??0)+(c.chestSway??0)+(c.hipRoll??0)>.24,'head must keep leaning toward the raised hand');
  }
  const moving=sequence.update(9700);sequence.clear(9700);
  near(sequence.update(9700),moving);
  near(sequence.update(10250),{weight:0,channels:{}});
});
