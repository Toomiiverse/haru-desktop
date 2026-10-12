export type SmugFrame = { weight:number; eyes:number; smile:number; parted:number; pitch:number; yaw:number; roll:number };
const REST:SmugFrame={weight:0,eyes:0,smile:0,parted:0,pitch:0,yaw:0,roll:0};
const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
// Seconds, lid closure, smile, small lip opening, then head pitch/yaw/roll in radians.
// The source GIF cuts back to its first frame; hold its final pose instead.
const KEYS=[
  [0,1,0,0,.07,0,0],
  [.20,1,.35,0,.11,0,0],
  [.42,1,.48,.65,.10,0,.01],
  [.60,1,.30,0,.055,0,.035],
  [.76,.70,.18,.22,.005,.025,.085],
  [1.05,.28,.14,.35,-.04,.03,.14],
  [1.23,.29,.20,.12,-.025,.025,.16],
  [1.38,.36,.40,.40,.005,.01,.18],
  [1.80,.55,1,0,.07,-.025,.21],
  [2.61,.55,.90,0,.065,-.02,.20],
] as const;

/** A single expression over the running idle, with reversible head and face offsets. */
export class SmugSequence {
  private started=-Infinity;
  private active=false;
  private entry:SmugFrame=REST;
  private release:{started:number;frame:SmugFrame}|null=null;
  start(now:number,reduced=false) {
    this.entry=this.update(now,reduced);this.started=now;this.active=true;this.release=null;
  }
  clear(now:number,reduced=false) {
    if(!this.active)return;
    this.release={started:now,frame:this.update(now,reduced)};this.active=false;
  }
  update(now:number,reduced=false):SmugFrame {
    if(this.release) {
      const weight=reduced?0:1-smooth((now-this.release.started)/550);
      if(!weight){this.release=null;return REST;}
      return Object.fromEntries(Object.entries(this.release.frame).map(([key,value])=>[key,value*weight])) as SmugFrame;
    }
    if(!this.active)return REST;
    const seconds=reduced?2.61:Math.max(0,(now-this.started)/1000);
    const next=KEYS.findIndex(key=>key[0]>seconds),a=KEYS[next<0?KEYS.length-1:Math.max(0,next-1)],b=KEYS[next<0?KEYS.length-1:next];
    const t=a===b?0:smooth((seconds-a[0])/(b[0]-a[0]));
    const values=a.slice(1).map((v,i)=>v+(b[i+1]-v)*t);
    const weight=reduced?1:smooth(seconds/.20);
    const pose:SmugFrame={weight:1,eyes:values[0],smile:values[1],parted:values[2],pitch:reduced?0:values[3],yaw:reduced?0:values[4],roll:reduced?0:values[5]};
    return Object.fromEntries(Object.entries(pose).map(([key,value])=>[key,value*weight+this.entry[key as keyof SmugFrame]*(1-weight)])) as SmugFrame;
  }
}
