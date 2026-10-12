/** Supervised knowledge adapters: observe files, embed exact text and commit Core decisions. */
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {KnowledgeStore,KnowledgeCategory} from './knowledge';
import type {IngestArgs,IngestResult,Extractor} from './ingestion';
import type {KnowledgeStoreDeps,IngestArgs as LiveArgs} from './knowledgestore';
import {baseExtractors} from './ingestion';
import {createEmbedder,cachedEmbedder,EmbeddingCache,type Embedder} from './embeddings';
import {readPdf} from './pdf';
import {embeddingRoute} from './embedding-route';
import {admitVaultMemories} from './vaultmemories';
import {type VaultSyncReport} from './obsidian';
const decide=<T=any>(op:string,args:unknown[]):T=>corePolicySync('knowledge-flow.'+op,args);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const current=()=>activeTask.getStore()?.signal.throwIfAborted();
const fingerprint=(file:string)=>{try{const stat=statSync(file);return {size:stat.size,mtime:stat.mtimeMs,hash:createHash('sha256').update(readFileSync(file)).digest('hex')};}catch{return null;}};
export async function runCoreKnowledgeIngest(store:KnowledgeStore,embedder:Embedder,args:IngestArgs,extractors:Extractor[]):Promise<IngestResult>{
 current();const name=path.basename(args.file),at=new Date().toISOString(),observed=typeof args.text==='string'?null:fingerprint(args.file);
 let packet=decide('start',[store,args,name,extractors.map(e=>({label:e.label,matches:e.match(args.file)})),at]);
 if(Object.hasOwn(packet,'extract')){const extractor=extractors[packet.extract];if(!extractor)throw Error('core_knowledge_extractor_protocol');const value=await extractor.extract(args.file);current();packet=decide('extracted',[store,args,name,value.text,value.sourceType,at]);}
 if(packet.error)throw Error(packet.error);if(packet.result)return packet.result;
 if(!Array.isArray(packet.embed)||!packet.state)throw Error('core_knowledge_ingest_protocol');const embeddings=await embedder.embedBatch(packet.embed);current();
 if(observed&&JSON.stringify(fingerprint(args.file))!==JSON.stringify(observed))throw Error('core_knowledge_source_changed');
 return decide<IngestResult>('embedded',[store,packet.state,embeddings,embedder.model]);
}
export function walkCoreVault(root:string,skip:string[]):{files:{file:string;relative:string}[];complete:boolean}{
 const out:{file:string;relative:string}[]=[];let complete=true;
 const visit=(dir:string,relative:string)=>{let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{complete=false;return;}
  const commands=corePolicySync<any[]>('knowledge-vault.entries',[entries.map(e=>({name:e.name,directory:e.isDirectory(),file:e.isFile()})),skip]);
  for(const command of commands){const full=path.join(dir,command.name),rel=path.join(relative,command.name);if(command.kind==='directory')visit(full,rel);else if(command.kind==='file')out.push({file:full,relative:rel});else if(command.kind==='check'){for(const page of command.pages){const file=path.join(full,page);if(existsSync(file))out.push({file,relative:path.join(rel,page)});}}else throw Error('core_knowledge_walk_protocol');}
 };visit(root,'');return {files:corePolicySync('knowledge-vault.sort',[out]),complete};
}
export function createCoreKnowledgeStore(deps:KnowledgeStoreDeps){
 const {store}=deps;const settings=decide('limits',[]),cache=new EmbeddingCache();let pending:string[]=[],timer:ReturnType<typeof setTimeout>|null=null,tail:Promise<unknown>=Promise.resolve();
 const config=()=>corePolicySync<ReturnType<typeof import('./knowledge')['readKnowledgeConfig']>>('knowledge-index.config',[store.get('knowledge.config')]);
 const facts=()=>({ai:store.get('ai.config'),settings:config(),vault:store.get('knowledge.vault'),slate:store.get('her.slate')});
 const embedder=():Embedder|null=>{const ai=store.get('ai.config') as {endpoint?:string;model?:string;provider?:string}|undefined;const dialect=decide<'openai'|'ollama'>('dialect',[ai?.provider]);const route=embeddingRoute(ai?.endpoint??'',dialect);const options=decide('provider',[ai,config(),route]);return options?cachedEmbedder(createEmbedder({...options,apiKey:deps.apiKeyFor(options.endpoint)},deps.fetch),cache):null;};
 const read=()=>store.getKnowledge();
 const commit=(before:KnowledgeStore,next:KnowledgeStore)=>{current();if(JSON.stringify(read())!==JSON.stringify(before))throw Error('core_knowledge_stale_documents');store.setKnowledge(next);};
 const flush=()=>{if(timer){clearTimeout(timer);timer=null;}if(!pending.length)return;const ids=pending;pending=[];const before=read(),plan=decide('touch',[before,ids,new Date().toISOString()]);if(plan.write)commit(before,plan.knowledge);};
 const scheduleSave=()=>{if(!timer)timer=setTimeout(()=>{timer=null;try{flush();}catch{console.warn('[knowledge] touch not confirmed');}},settings.saveDebounceMs);};
 const enqueue=<T>(run:()=>Promise<T>):Promise<T>=>{const result=tail.then(async()=>{current();return run();});tail=result.then(()=>new Promise<void>(resolve=>setImmediate(resolve)),()=>new Promise<void>(resolve=>setImmediate(resolve)));return result;};
 const pdf:Extractor={label:'pdf',match:name=>decide('matches',['pdf',name]),extract:async file=>{const value=decide('pdf',[await readPdf(file,settings.pdfChars)]);if(value.error)throw Error(value.error);return value;}};
 const ingest=async(args:LiveArgs,expectedSource?:ReturnType<typeof fingerprint>):Promise<IngestResult>=>{current();flush();const before=read(),configuration=facts(),sourceGuard=expectedSource??(decide('verifySource',[args])?fingerprint(args.file):null),model=embedder();if(!model)throw Error('no model is set up, so nothing can be embedded');const result=await runCoreKnowledgeIngest(before,model,decide('ingestArgs',[args,config()]),[...baseExtractors(),pdf]);current();if(sourceGuard&&JSON.stringify(fingerprint(args.file))!==JSON.stringify(sourceGuard))throw Error('core_knowledge_source_changed');if(JSON.stringify(facts())!==JSON.stringify(configuration))throw Error('core_knowledge_configuration_changed');const plan=decide('commitGate',[digest(before),digest(read()),digest(configuration),digest(facts()),result.outcome.action]);if(plan.write)commit(before,corePolicySync('knowledge-index.reconcile',[result.store]));return result;};
 const ingestPath=(file:string,category?:KnowledgeCategory)=>ingest({file,category});
 const vaultPath=()=>decide<string>('vaultPath',[store.get('knowledge.vault')]);
 const removeSource=(source:string)=>{flush();const before=read(),plan=decide('removeSource',[before,source,new Date().toISOString()]);if(plan.write)commit(before,plan.knowledge);return plan.result as {deleted:boolean;removedChunks:number};};
 const syncVault=async(target:string):Promise<VaultSyncReport>=>{current();const vault=path.resolve(target);if(!existsSync(vault)||!statSync(vault).isDirectory())throw Error(`no such vault: ${target}`);const started=Date.now(),before=read(),scan=walkCoreVault(vault,corePolicySync('knowledge-vault.skip',[])),actions:(string|null)[]=[];
  for(const item of scan.files){current();const observation=fingerprint(item.file);let raw;try{raw=readFileSync(item.file,'utf8');}catch{actions.push(null);continue;}const note=corePolicySync<any>('knowledge-vault.syncNote',[vault,item,raw]);try{if(JSON.stringify(fingerprint(item.file))!==JSON.stringify(observation))throw Error('core_knowledge_source_changed');const result=await ingest({file:note.file,source:note.relative,sourceType:'markdown',text:note.text,category:note.category,metadata:note.metadata},observation);actions.push(result.outcome.action);}catch(error){if(!decide('failure',[error instanceof Error?error.message:String(error)]).continue)throw error;actions.push(null);console.warn('[knowledge] vault note not confirmed');}}
  const missing=corePolicySync<string[]>('knowledge-vault.removedSafe',[before,scan.files.map(f=>f.relative),vault,scan.complete]);for(const source of missing)removeSource(source);
  if(deps.remember)admitVaultMemories(vault,deps.remember);
  return corePolicySync('knowledge-vault.report',[scan.files.length,actions,missing.length,Date.now()-started]);};
 const autoSyncVault=async()=>{const vault=vaultPath();if(!vault)return;try{await enqueue(()=>syncVault(vault));}catch{console.warn('[knowledge] auto vault sync not confirmed');}};
 const reindex=async(source?:string)=>{const targets=decide<any[]>('reindex',[read(),source]);const observations:boolean[]=[];for(const doc of targets){try{await enqueue(()=>ingestPath(doc.source,doc.category));observations.push(true);}catch(error){if(!decide('failure',[error instanceof Error?error.message:String(error)]).continue)throw error;observations.push(false);console.warn('[knowledge] reindex not confirmed');}}return decide<number>('reindexResult',[observations]);};
 return {load:read,current:read,config,embedder,persist:flush,scheduleSave,touch:(ids:string[])=>{pending.push(...ids);scheduleSave();},enqueue,ingest,ingestPath,vaultPath,saveVaultPath:(value:string)=>store.set('knowledge.vault',{path:value}),syncVault,autoSyncVault,reindex,removeSource};
}
export async function runCoreVaultSync(vault:string,deps:import('./obsidian').VaultSyncDeps):Promise<VaultSyncReport>{
 const started=Date.now(),scan=walkCoreVault(vault,corePolicySync('knowledge-vault.skip',[])),actions:(string|null)[]=[];
 for(const item of scan.files){current();let raw:string;try{raw=readFileSync(item.file,'utf8');}catch{actions.push(null);continue;}
  const note=corePolicySync<any>('knowledge-vault.syncNote',[vault,item,raw]);try{actions.push(await deps.ingest(note));}catch(error){if(!decide('failure',[error instanceof Error?error.message:String(error)]).continue)throw error;actions.push(null);}}
 const missing=corePolicySync<string[]>('knowledge-vault.removedSafe',[deps.store,scan.files.map(f=>f.relative),vault,scan.complete]);for(const source of missing){current();deps.remove(source);}
 return corePolicySync('knowledge-vault.report',[scan.files.length,actions,missing.length,Date.now()-started]);
}
export function runCoreVaultMemories(vault:string,admit:import('./vaultmemories').VaultMemoryAdmitter,read:(file:string)=>string,exists:(file:string)=>boolean):import('./vaultmemories').VaultMemoryReport{
 const report:import('./vaultmemories').VaultMemoryReport=[];
 for(const page of corePolicySync<import('./vaultmemories').VaultMemoryPage[]>('knowledge-vault.pages',[])){current();const file=path.join(vault,page);if(!exists(file))continue;const drafts=corePolicySync<import('./vaultmemories').VaultMemoryDraft[]>('knowledge-vault.memoryPage',[read(file),page]);const observations=drafts.map(draft=>{current();return admit(draft)});report.push(corePolicySync('knowledge-vault.memoryReport',[page,drafts,observations]));}
 return report;
}
export function retireCoreVaultMemories(vault:string,adapter:{core:import('./core-store').CoreStore;publish:(events:string[])=>void}){
 if(!vault)return;current();const pages:Record<string,unknown>={},observations:Record<string,unknown>={};
 for(const page of corePolicySync<string[]>('knowledge-vault.pages',[])){const file=path.join(vault,page);try{const data=readFileSync(file);pages[page]={ok:true,text:data.toString('utf8')};observations[file]=createHash('sha256').update(data).digest('hex');}catch{pages[page]={ok:false};}}
 const packet=corePolicySync<any>('knowledge-vault.retirePlan',[adapter.core.get('config'),adapter.core.get('memories'),pages,new Date().toISOString()]);
 if(!packet.plan)return packet.result;
 const assertCurrent=()=>{current();for(const [file,hash]of Object.entries(observations)){if(fingerprint(file)?.hash!==hash)throw Error('core_knowledge_source_changed');}};
 require('./core-day-night').commitDayNightPlan(adapter.core,packet.plan,assertCurrent);
 if(Object.hasOwn(packet.plan.changes,'memories'))adapter.publish(['memories']);return packet.result;
}
