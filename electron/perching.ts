import type { DesktopScene } from './desktopAwareness';
import type { Rect, Point } from './roam';

export type DesktopSurface = Rect & { id: string; eligible: boolean };
export type PerchMetrics = { seat: number; feet: number; head: number; halfWidth: number };
export type Perch = { id: string; offset: number; size?: {width:number;height:number} };
export type PerchJump = { started: number; flight: number };
export type PerchFall = { started: number; duration: number; strength: number; landed?: number };
export type PerchState = { seated: boolean; jump: PerchJump | null; fall?: PerchFall | null; desktop?: DesktopScene };
export type JumpFrame = { phase: 'crouch' | 'flight' | 'land' | 'seated'; progress: number };
export type FallFrame = { phase: 'fall' | 'land' | 'done'; progress: number; strength: number };

/** Harder impacts leave time for the body to regain its balance. Milliseconds. */
export function landingDuration(strength: number): number {
  const t=Math.max(0,Math.min(1,(strength-.2)/.8));
  return 1000+1200*t*t*(3-2*t);
}

/** Landing starts only when the native window has actually reached the ground. */
export function fallFrame(fall: PerchFall, now: number, reduced = false): FallFrame {
  const strength=Math.max(0,Math.min(1,fall.strength));
  if(reduced)return {phase:'done',progress:1,strength};
  if(fall.landed!==undefined) {
    const progress=Math.max(0,Math.min(1,(now-fall.landed)/landingDuration(strength)));
    return {phase:progress<1?'land':'done',progress,strength};
  }
  return {phase:'fall',progress:Math.max(0,Math.min(1,(now-fall.started)/Math.max(1,fall.duration))),strength};
}

/** The visible soles meet the usable monitor bottom, above a docked taskbar. */
export function groundPosition(work: Rect, body: Rect, feet: number): Point {
  return {x:Math.round(Math.max(work.x,Math.min(work.x+work.width-body.width,body.x))),y:Math.round(work.y+work.height-body.height*feet)};
}

/** Released in midair: accelerate downward and stop exactly at the floor. */
export function fallPosition(from: Point, to: Point, elapsed: number, duration: number, reduced=false): Point {
  const t=reduced || from.y>=to.y ? 1 : Math.max(0,Math.min(1,elapsed/Math.max(1,duration))),u=t*t;
  return {x:from.x+(to.x-from.x)*u,y:from.y+(to.y-from.y)*u};
}

/** One clock for body anticipation, native-window travel, and contact. Milliseconds. */
export function jumpFrame(jump: PerchJump, now: number, reduced = false): JumpFrame {
  const elapsed=Math.max(0,now-jump.started);
  if(reduced || elapsed>=260+jump.flight+320)return {phase:'seated',progress:1};
  if(elapsed<260)return {phase:'crouch',progress:elapsed/260};
  if(elapsed<260+jump.flight)return {phase:'flight',progress:(elapsed-260)/jump.flight};
  return {phase:'land',progress:(elapsed-260-jump.flight)/320};
}

/** Constant downward acceleration: a fast launch, an apex, then a descending landing. */
export function jumpPosition(from: Point, to: Point, frame: JumpFrame, height: number, ceiling: number): Point {
  if(frame.phase==='crouch')return from;
  if(frame.phase!=='flight')return to;
  const p=frame.progress,top=Math.min(from.y,to.y);
  const apex=Math.min(top,Math.max(ceiling,top-Math.max(28,height*.12)));
  const rise=Math.sqrt(from.y-apex),fall=Math.sqrt(to.y-apex);
  return {x:from.x+(to.x-from.x)*p,y:apex+(rise-(rise+fall)*p)**2};
}

/** Geometry only, front to back; no window titles or contents leave the helper. */
export function parseSurfaces(json: string): DesktopSurface[] | null {
  try {
    const rows = JSON.parse(json) as DesktopSurface[];
    if (!Array.isArray(rows) || rows.length > 128) return null;
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || !/^\d+:\d+$/.test(r.id) || seen.has(r.id) || typeof r.eligible !== 'boolean'
        || ![r.x,r.y,r.width,r.height].every(v=>typeof v==='number' && Number.isFinite(v) && Math.abs(v)<100000)
        || r.width<=0 || r.height<=0) return null;
      seen.add(r.id);
    }
    return rows;
  } catch { return null; }
}

export function readPerchMetrics(value: unknown): PerchMetrics | null {
  const v=value as PerchMetrics;
  if (!v || ![v.seat,v.feet,v.head,v.halfWidth].every(n=>Number.isFinite(n) && n>0 && n<1)
    || v.head>=v.seat || v.seat>=v.feet || v.halfWidth>.45) return null;
  return {seat:v.seat,feet:v.feet,head:v.head,halfWidth:v.halfWidth};
}

/** Subtract covered parts of an edge, including coverage by maximized windows. */
export function openEdges(surfaces: DesktopSurface[], index: number): [number,number][] {
  const target=surfaces[index];let edges: [number,number][]=[[target.x+16,target.x+target.width-16]];
  for(const cover of surfaces.slice(0,index)) {
    if(cover.y>target.y+2 || cover.y+cover.height<=target.y-2) continue;
    edges=edges.flatMap(([l,r]): [number,number][]=>{
      if(cover.x>=r || cover.x+cover.width<=l) return [[l,r]];
      const out: [number,number][]=[];
      if(cover.x>l)out.push([l,cover.x]);
      if(cover.x+cover.width<r)out.push([cover.x+cover.width,r]);
      return out;
    });
  }
  return edges;
}

export function perchPosition(perch: Perch, surfaces: DesktopSurface[], body: Rect, metrics: PerchMetrics, displays: Rect[]): Point | null {
  // Windows rounds each rectangle edge independently at fractional DPI. Moving
  // can change the reported width by one DIP even when the canvas did not resize.
  // Keep the size captured at attachment/real resize out of that feedback loop.
  if(perch.size)body={...body,...perch.size};
  const index=surfaces.findIndex(s=>s.id===perch.id);if(index<0)return null;
  const s=surfaces[index];if(!s.eligible)return null;
  const center=s.x+Math.max(0,Math.min(1,perch.offset))*s.width;
  const half=body.width*metrics.halfWidth;
  if(!openEdges(surfaces,index).some(([l,r])=>center-half>=l && center+half<=r))return null;
  const y=s.y-body.height*metrics.seat;
  // Room for her head above the edge and her dangling feet below it.
  if(!displays.some(d=>center-body.width/2>=d.x && center+body.width/2<=d.x+d.width
    && y+metrics.head*body.height>=d.y+8 && s.y+body.height*.28<=d.y+d.height-8))return null;
  return {x:Math.round(center-body.width/2),y:Math.round(y)};
}

export function choosePerch(surfaces: DesktopSurface[], body: Rect, metrics: PerchMetrics, displays: Rect[], nearby: boolean): Perch | null {
  const center=body.x+body.width/2;const half=body.width*metrics.halfWidth;
  let best: Perch | null=null,bestDistance=Infinity;
  surfaces.forEach((s,index)=>{
    if(!s.eligible)return;
    for(const [left,right] of openEdges(surfaces,index)) {
      if(right-left<half*2)continue;
      const display=displays.find(d=>s.x<d.x+d.width && s.x+s.width>d.x && s.y>=d.y && s.y<d.y+d.height);
      if(!display)continue;
      const l=Math.max(left+half,display.x+body.width/2),r=Math.min(right-half,display.x+display.width-body.width/2);
      if(r<l)continue;
      const x=Math.max(l,Math.min(r,center));
      const perch={id:s.id,offset:(x-s.x)/s.width};
      if(!perchPosition(perch,surfaces,body,metrics,displays))continue;
      const dy=Math.min(Math.abs(s.y-body.y-body.height*metrics.seat),Math.abs(s.y-body.y-body.height*metrics.feet));
      const distance=Math.hypot(x-center,dy);
      if(nearby && (dy>Math.max(36,body.height*.055) || Math.abs(x-center)>48))continue;
      if(distance<bestDistance){best=perch;bestDistance=distance;}
    }
  });
  return best;
}
