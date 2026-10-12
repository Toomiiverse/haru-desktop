import { referenceClip, type ReferenceClip } from './referenceClips';

export type ReferenceFrame = { weight:number; channels:Record<string,number> };
const REST:ReferenceFrame={weight:0,channels:{}};
const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const blend=(a:Record<string,number>,b:Record<string,number>,t:number)=>
  Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])]
    .map(key=>[key,(a[key]??0)+((b[key]??0)-(a[key]??0))*t]));

function sample(clip:ReferenceClip,seconds:number):Record<string,number> {
  const next=clip.keys.findIndex(key=>key.t>seconds);
  const a=clip.keys[next<0?clip.keys.length-1:Math.max(0,next-1)];
  const b=clip.keys[next<0?clip.keys.length-1:next];
  const t=a===b?0:Math.max(0,Math.min(1,(seconds-a.t)/(b.t-a.t)));
  const channels=blend(a.channels,b.channels,clip.interpolation==='linear'?t:smooth(t));
  // Stride is a phase counter: easing it would stop the gait at every key.
  if('stride' in a.channels || 'stride' in b.channels)
    channels.stride=(a.channels.stride??0)+((b.channels.stride??0)-(a.channels.stride??0))*t;
  return channels;
}

/** Reference performances hold their finish; authored idle cycles repeat continuously. */
export class ReferenceSequence {
  private clip:ReferenceClip|undefined;
  private started=0;
  private entry:ReferenceFrame=REST;
  private strideOffset:number|undefined;
  private release:{started:number;frame:ReferenceFrame}|undefined;
  get currentName(){return this.clip?.name;}

  start(name:string,now:number,reduced=false):boolean {
    const clip=referenceClip(name);
    if(!clip)return false;
    this.entry=this.update(now,reduced);
    const beginning=sample(clip,0);
    this.strideOffset=this.entry.weight>0 && (this.entry.channels.gait??0)>0 && beginning.stride!==undefined
      ? (this.entry.channels.stride??0)-beginning.stride : undefined;
    // Hand coordinates are targets, not offsets: an initial fade must not
    // interpolate them from the world origin before the renderer applies weight.
    if(this.entry.weight===0)this.entry={weight:0,channels:beginning};
    this.clip=clip;this.started=now;this.release=undefined;
    return true;
  }

  clear(now:number,reduced=false) {
    if(!this.clip)return;
    this.release={started:now,frame:this.update(now,reduced)};
    this.clip=undefined;
  }

  update(now:number,reduced=false):ReferenceFrame {
    if(this.release) {
      const weight=this.release.frame.weight*(reduced?0:1-smooth((now-this.release.started)/550));
      if(weight===0){this.release=undefined;return REST;}
      return {weight,channels:this.release.frame.channels};
    }
    if(!this.clip)return REST;
    const elapsed=Math.max(0,(now-this.started)/1000);
    const seconds=reduced?(this.clip.hold??this.clip.duration):this.clip.loop?elapsed%this.clip.duration:Math.min(this.clip.duration,elapsed);
    const pose=sample(this.clip,seconds);
    const t=reduced?1:smooth((now-this.started)/200);
    const channels=blend(this.entry.channels,pose,t);
    // Retiring an arm blends its influence out, not its geometric target into
    // the torso. Incoming targets still interpolate normally when specified.
    for(const key of Object.keys(this.entry.channels))
      if(/^(left|right)([XYZ]|Wrist[XYZ]|Contact[XYZ]|ContactWrist[XYZ]|Pole[XYZ])$/.test(key) && !(key in pose))
        channels[key]=this.entry.channels[key];
    // A gait phase must keep advancing across replays, never unwind through
    // earlier steps. When gait leaves, keep the last phase while its weight fades.
    if(this.strideOffset!==undefined)channels.stride=(pose.stride??0)+this.strideOffset;
    else if((this.entry.channels.gait??0)>0 && pose.stride===undefined)
      channels.stride=this.entry.channels.stride??0;
    return {weight:this.entry.weight+(1-this.entry.weight)*t,channels};
  }
}
