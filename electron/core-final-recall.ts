import {corePolicySync} from './core-policy-sync';
import type {Exchange} from './recall';import type {ChatIndex} from './chatsearch';
export function recallFrames<T>(values:T[],run:(frame:T[])=>void){let frame:T[]=[],size=0;for(const v of values){const bytes=Buffer.byteLength(JSON.stringify(v),'utf8');if(bytes>131072)throw Error('recall_frame_item_limit');if(size+bytes>131072){run(frame);frame=[];size=0;}frame.push(v);size+=bytes;}if(frame.length)run(frame);}
export function coreExchanges(archive:Record<string,{role?:string;content?:string}[]>,before:string[],today:string,keep:number):Exchange[]{
 const selected=corePolicySync<string[]>('final-recall.days',[Object.keys(archive),before,today,keep]),out:Exchange[]=[];
 for(const day of selected)out.push(...corePolicySync<Exchange[]>('final-recall.exchanges',[day,archive[day]??[]]));return out;
}
export function corePickRecalled(exchanges:Exchange[],vectors:Map<string,number[]>,query:number[],limit:number,floor:number,shares?:(e:Exchange)=>boolean){
 let found:any[]=[];recallFrames(exchanges.map(exchange=>({exchange,vector:vectors.get(exchange.id)??[],allowed:shares?shares(exchange):true})),rows=>{found=corePolicySync('final-recall.rankBatch',[rows,query,limit,floor,found]);});return found;
}
export function coreProactiveRecall(index:ChatIndex,vectors:Map<string,number[]>,query:number[]|null,shown:string[],specific:string[]):any[]{
 if(query===null)return [];let found:any[]=[];
 recallFrames(index.exchanges.map((exchange,i)=>({exchange,vector:vectors.get(exchange.id)??[],count:Object.fromEntries(index.counts[i])})),rows=>{
  found=corePolicySync('final-recall.proactiveRank',[rows,query,shown,specific,found]);
 });return found;
}
export function coreEveryday(index:ChatIndex):Set<string>{let state:any=null;recallFrames(index.exchanges.map(e=>e.text),texts=>{state=corePolicySync('final-recall.everydayBatch',[texts,state]);});return new Set(corePolicySync<string[]>('final-recall.everydayFinish',[state??{lower:{},upper:{}}]));}
export async function coreRefreshRecall(host:{model:string;oldFormat:string;all:Exchange[];vectors:Map<string,number[]>;stale:boolean;embed:(texts:string[])=>Promise<number[][]>;setFormat:(v:string)=>void;setStale:(v:boolean)=>void;save:()=>void}):Promise<{recallBacklog:boolean}>{
 let packet=corePolicySync<any>('final-recall.refreshStart',[host.model,host.oldFormat,host.all.map(e=>e.id),[...host.vectors.keys()],host.stale]);
 if(packet.reset)host.vectors.clear();for(const id of packet.remove)host.vectors.delete(id);host.setFormat(packet.format);
 const by=new Map(host.all.map(e=>[e.id,e]));
 for(let n=0;n<32;n++){
  let observation:any;
  if(packet.next.length){const request=corePolicySync<any>('final-recall.refreshRequest',[packet.state,packet.next.map((id:string)=>by.get(id))]);try{observation={ok:true,vectors:await host.embed(request.texts)}}catch{observation={ok:false,vectors:[]}};}
  else observation={ok:true,vectors:[]};
  packet=corePolicySync('final-recall.refreshObserved',[packet.state,observation.ok,observation.vectors]);for(const [id,vector] of packet.updates)host.vectors.set(id,vector);
  if(packet.complete){if(packet.write){host.save();host.setStale(false);}return {recallBacklog:packet.backlog};}
 }
 throw Error('recall_refresh_bound');
}
