import {corePolicySync} from './core-policy-sync';
import type {Exchange} from './recall';import type {ChatIndex,ChatHit} from './chatsearch';
function frames<T>(values:T[],run:(frame:T[])=>void){let frame:T[]=[],size=0;for(const value of values){const bytes=Buffer.byteLength(JSON.stringify(value),'utf8');if(bytes>131072)throw Error('chat_frame_item_limit');if(size+bytes>131072){run(frame);frame=[];size=0;}frame.push(value);size+=bytes;}if(frame.length)run(frame);}
export function coreChatIndex(exchanges:Exchange[]):ChatIndex{
 const counts:Map<string,number>[]=[],lengths:number[]=[];let state:any=null;
 frames(exchanges.map(x=>x.text),texts=>{const rows=corePolicySync<Record<string,number>[]>('final-chat.countBatch',[texts]);state=corePolicySync('final-chat.summary',[state,rows]);for(const row of rows)counts.push(new Map(Object.entries(row)));lengths.push(...state.lengths);});
 return {exchanges,counts,lengths,position:new Map(exchanges.map((e,i)=>[e.id,i])),spread:new Map(Object.entries(state?.spread??{})),average:state?.average??0};
}
export function coreChatSearch(index:ChatIndex,input:{query:string;queryVector?:number[]|null;vectors:Map<string,number[]>;from?:string;to?:string;limit?:number}):ChatHit[]{
 const {vectors,...request}=input,meta={total:index.exchanges.length,spread:Object.fromEntries(index.spread),average:index.average},scores:unknown[]=[];
 const rows=index.exchanges.map((e,at)=>({at,day:e.day,count:Object.fromEntries(index.counts[at]),length:index.lengths[at],vector:vectors.get(e.id)??null}));
 frames(rows,frame=>scores.push(...corePolicySync<any[]>('final-chat.scoreBatch',[frame,meta,request])));
 const selected=corePolicySync<any[]>('final-chat.rank',[scores,index.exchanges.map(e=>e.day),meta,request]);
 return selected.map(hit=>({exchange:index.exchanges[hit.at],score:hit.score,...(hit.before===undefined?{}:{before:index.exchanges[hit.before]}),...(hit.after===undefined?{}:{after:index.exchanges[hit.after]})}));
}
export function coreChatKeywordScores(index:ChatIndex,query:string):number[]{
 const meta={total:index.exchanges.length,spread:Object.fromEntries(index.spread),average:index.average},scores:number[]=[];
 frames(index.exchanges.map((e,at)=>({at,day:e.day,count:Object.fromEntries(index.counts[at]),length:index.lengths[at],vector:null})),frame=>scores.push(...corePolicySync<{words:number}[]>('final-chat.scoreBatch',[frame,meta,{query}]).map(r=>r.words)));return scores;
}
