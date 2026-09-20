import type { Point, Rect } from './roam';
import { openEdges, type DesktopSurface, type PerchMetrics } from './perching';

export type DesktopPeek = { edge: 'left' | 'right' | 'top'; started: number; duration: number };
export type DesktopScene = {
  displayId: number; windowCount: number; crowding: number; avatar: Rect;
  occluders: Rect[]; focus: Point | null; peek: DesktopPeek | null;
};
export type DesktopVisit = { id: string; edge: DesktopPeek['edge']; offset: number };
type Display = { id: number; bounds: Rect; workArea: Rect };

function intersection(a: Rect, b: Rect): Rect | null {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  return right>x && bottom>y?{x,y,width:right-x,height:bottom-y}:null;
}
const contains=(r:Rect,p:Point)=>p.x>=r.x && p.x<=r.x+r.width && p.y>=r.y && p.y<=r.y+r.height;

/** Capture the current monitor once; a disconnected monitor falls back nearby. */
export function chooseLockedDisplay<T extends Display>(displays:T[],savedId:unknown,body:Rect):T {
  const saved=displays.find(d=>d.id===savedId);if(saved)return saved;
  const center={x:body.x+body.width/2,y:body.y+body.height/2};
  return displays.reduce((best,d)=>{
    const overlap=(r:Rect)=>{const hit=intersection(r,body);return hit?hit.width*hit.height:0;};
    const distance=(r:Rect)=>Math.hypot(center.x-Math.max(r.x,Math.min(r.x+r.width,center.x)),center.y-Math.max(r.y,Math.min(r.y+r.height,center.y)));
    return overlap(d.bounds)>overlap(best.bounds) || overlap(d.bounds)===overlap(best.bounds) && distance(d.bounds)<distance(best.bounds)?d:best;
  });
}

/** Transparent margins may cross the work-area boundary; the visible body cannot. */
export function clampAvatar(work:Rect,body:Rect,metrics?:PerchMetrics|null):Point {
  const top=work.y-body.height*(metrics?.head??0),bottom=work.y+work.height-body.height*(metrics?.feet??1);
  return {x:Math.round(Math.max(work.x,Math.min(work.x+Math.max(0,work.width-body.width),body.x))),
    y:Math.round(Math.max(top,Math.min(Math.max(top,bottom),body.y)))};
}

export function surfacesOnDisplay(surfaces:DesktopSurface[],work:Rect):DesktopSurface[] {
  return surfaces.filter(s=>{const hit=intersection(s,work);return !!hit && hit.width>=24 && hit.height>=24;});
}

function coveredArea(rectangles:Rect[]):number {
  const xs=[...new Set(rectangles.flatMap(r=>[r.x,r.x+r.width]))].sort((a,b)=>a-b);
  let area=0;
  for(let i=1;i<xs.length;i++){
    const spans=rectangles.filter(r=>r.x<xs[i] && r.x+r.width>xs[i-1]).map(r=>[r.y,r.y+r.height]).sort((a,b)=>a[0]-b[0]);
    let start=spans[0]?.[0]??0,end=start,total=0;
    for(const [a,b] of spans){if(a>end){total+=end-start;start=a;end=b;}else end=Math.max(end,b);}
    area+=(xs[i]-xs[i-1])*(total+end-start);
  }
  return area;
}

/** Geometry is enough to notice clutter and look toward a window; no content reads. */
export function desktopScene(surfaces:DesktopSurface[],work:Rect,body:Rect,displayId:number,peek:DesktopPeek|null=null,behindId?:string,focusId?:string):DesktopScene {
  const local=surfacesOnDisplay(surfaces,work),rectangles=local.map(s=>intersection(s,work)!);
  const index=local.findIndex(s=>s.id===behindId),focus=local.find(s=>s.id===(focusId??behindId))??local[0];
  return {displayId,windowCount:local.length,crowding:Math.min(1,coveredArea(rectangles)/Math.max(1,work.width*work.height)),avatar:{...body},
    occluders:index<0?[]:local.slice(0,index+1).map(s=>intersection(s,work)!),
    focus:focus?{x:Math.max(work.x,Math.min(work.x+work.width,focus.x+focus.width/2)),y:Math.max(work.y,Math.min(work.y+work.height,focus.y+Math.min(focus.height*.35,180)))}:null,peek};
}

/** A side visit keeps feet on the floor; a top visit leaves head and shoulders visible. */
export function visitTarget(surface:DesktopSurface,edge:DesktopPeek['edge'],work:Rect,body:Rect,metrics:PerchMetrics,offset=.5,surfaces?:DesktopSurface[]):Point|null {
  if(!surface.eligible || !intersection(surface,work))return null;
  const point=edge==='top'
    ?{x:surface.x+surface.width*offset-body.width/2,y:surface.y-body.height*(metrics.head+.19)}
    :{x:(edge==='left'?surface.x-body.width*.04:surface.x+surface.width+body.width*.04)-body.width/2,
      y:work.y+work.height-body.height*metrics.feet};
  const clamped=clampAvatar(work,{...body,...point},metrics);
  if(Math.abs(clamped.x-point.x)>1 || Math.abs(clamped.y-point.y)>1)return null;
  if(edge!=='top'){
    const head=point.y+body.height*(metrics.head+.10);
    if(head<surface.y+12 || head>surface.y+surface.height-12)return null;
  }
  if(surfaces){
    const index=surfaces.findIndex(s=>s.id===surface.id);if(index<0)return null;
    const center=surface.x+surface.width*offset,half=body.width*metrics.halfWidth;
    if(edge==='top' && !openEdges(surfaces,index).some(([l,r])=>center-half>=l && center+half<=r))return null;
    const probe=edge==='top'?{x:center,y:surface.y-2}
      :{x:edge==='left'?surface.x-2:surface.x+surface.width+2,y:point.y+body.height*(metrics.head+.10)};
    if(surfaces.slice(0,index).some(s=>contains(s,probe)))return null;
  }
  return clamped;
}

/** Choose only exposed, reachable edges on this display, preserving native z order. */
export function chooseVisit(surfaces:DesktopSurface[],work:Rect,body:Rect,metrics:PerchMetrics,random:()=>number=Math.random):DesktopVisit|null {
  const local=surfacesOnDisplay(surfaces,work),candidates:{visit:DesktopVisit;distance:number}[]=[];
  local.forEach((surface,index)=>{
    const half=body.width*metrics.halfWidth;
    const add=(edge:DesktopPeek['edge'],offset:number)=>{
      const target=visitTarget(surface,edge,work,body,metrics,offset,local);if(!target)return;
      candidates.push({visit:{id:surface.id,edge,offset},distance:Math.hypot(target.x-body.x,target.y-body.y)});
    };
    add('left',.5);add('right',.5);
    for(const [left,right] of openEdges(local,index)){
      const l=Math.max(left+half,work.x+body.width/2),r=Math.min(right-half,work.x+work.width-body.width/2);
      if(r>=l)add('top',(Math.max(l,Math.min(r,body.x+body.width/2))-surface.x)/surface.width);
    }
  });
  candidates.sort((a,b)=>a.distance-b.distance);
  return candidates.length?candidates[Math.min(candidates.length-1,Math.floor(Math.max(0,Math.min(.999999,random()))*Math.min(4,candidates.length)))].visit:null;
}
