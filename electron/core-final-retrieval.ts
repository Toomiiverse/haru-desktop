import {corePolicySync} from './core-policy-sync';
import type {KnowledgeStore} from './knowledge';
import type {RetrieveOptions,ScoredChunk} from './retrieval';
/** Byte framing only. Core chooses every filter, score, pool and final rank. */
export function coreKnowledgeQuery(kind:string,store:KnowledgeStore,query:string,embedding:number[],options:RetrieveOptions):ScoredChunk[]{
 let state=corePolicySync<any>('final-retrieval.batchStart',[kind,query,embedding,{...options,now:(options.now??new Date()).toISOString()}]);
 let frame:unknown[]=[],bytes=0;
 const flush=()=>{if(!frame.length)return;state=corePolicySync('final-retrieval.batchObserved',[state,frame]);frame=[];bytes=0;};
 for(const [at,chunk] of store.chunks.entries()){
  const size=Buffer.byteLength(JSON.stringify(chunk),'utf8');
  if(size>131072)throw Error('retrieval_chunk_transport_limit');
  if(bytes+size>131072)flush();frame.push({...chunk,__haruTransportAt:at});bytes+=size;
 }
 flush();const selected=corePolicySync<(ScoredChunk&{transportAt:number})[]>('final-retrieval.batchFinish',[state]);
 return selected.map(({transportAt,...row})=>{if(!Number.isSafeInteger(transportAt)||!store.chunks[transportAt]||store.chunks[transportAt].id!==row.chunk.id)throw Error('retrieval_projection_binding');return {...row,chunk:store.chunks[transportAt]};});
}
