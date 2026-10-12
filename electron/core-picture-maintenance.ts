/** Raw directory observations and exact stale-checked file effects; retention is Core-owned. */
import {readdirSync,statSync,lstatSync,rmSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {corePolicySync} from './core-policy-sync';
type Entry={name:string;observed:boolean;mtimeMs?:number;inode?:number;device?:number;linkMtimeMs?:number;size?:number};
function observation(root:string,name:string):Entry{try{const f=path.join(root,name),link=lstatSync(f),stat=statSync(f);return {name,observed:true,mtimeMs:stat.mtimeMs,inode:link.ino,device:link.dev,linkMtimeMs:link.mtimeMs,size:link.size};}catch{return {name,observed:false}}}
export function coreSweepPictures(folder:()=>string,kept:()=>string[],log:(line:string)=>void):number{
 const root=folder();let canonical:string,names:string[],directory:ReturnType<typeof statSync>;
 try{canonical=realpathSync(root);directory=statSync(root);names=readdirSync(root);}catch{return corePolicySync<any>('picture-maintenance.observed',[{files:[]},[]]).swept;}
 const held=kept(),rows=names.map(name=>observation(root,name));
 const plan=corePolicySync<{kept:string[];files:Entry[]}>('picture-maintenance.start',[held,rows,Date.now()]);
 const receipts=[];
 for(const selected of plan.files){
  // Path/capability and stale observations are physical refusal checks only.
  if(path.basename(selected.name)!==selected.name||selected.name==='.'||selected.name==='..')throw Error('picture_maintenance_path_invalid');
  const currentDir=statSync(root);if(realpathSync(root)!==canonical||currentDir.dev!==directory.dev||currentDir.ino!==directory.ino||JSON.stringify(kept())!==JSON.stringify(plan.kept))throw Error('picture_maintenance_source_changed');
  const current=observation(root,selected.name);if(JSON.stringify(current)!==JSON.stringify(selected)){receipts.push({name:selected.name,attempted:false,absent:null});continue;}
  const file=path.join(root,selected.name);let attempted=true;try{rmSync(file,{force:true});}catch{}
  let absent:boolean|null;try{lstatSync(file);absent=false;}catch(error){absent=(error as NodeJS.ErrnoException).code==='ENOENT'?true:null;}
  receipts.push({name:selected.name,attempted,absent});
 }
 const result=corePolicySync<{swept:number;unknown:string[];log:string|null}>('picture-maintenance.observed',[plan,receipts]);if(result.log)log(result.log);return result.swept;
}

import type {CoreStore} from './core-store';
import {activeTask} from './task-controller';
function heldPictures(core:CoreStore){const value=core.getPath('config',['pictures','kept']);return {present:value!==undefined,value:value??null};}
export function corePictureMutation(kind:'keep'|'forget',id:string,core:CoreStore,folder:()=>string):boolean{
 const held=heldPictures(core),plan=corePolicySync<any>('picture-maintenance.mutation',[kind,id,held]);
 if(plan.write)core.transaction(()=>{
  activeTask.getStore()?.signal.throwIfAborted();
  if(JSON.stringify(heldPictures(core))!==JSON.stringify(plan.expected))throw Error('picture_kept_stale');
  const config=core.get('config',{});core.set('config',{...config,pictures:{...config.pictures,kept:plan.kept}});
 });
 let receipt:unknown=null;
 if(plan.remove){
  activeTask.getStore()?.signal.throwIfAborted();
  if(path.basename(plan.remove)!==plan.remove||!/^[-0-9a-f]{36}\.png$/i.test(plan.remove))throw Error('picture_remove_path_invalid');
  const file=path.join(folder(),plan.remove);try{rmSync(file,{force:true});}catch{}
  let absent:boolean|null;try{lstatSync(file);absent=false;}catch(error){absent=(error as NodeJS.ErrnoException).code==='ENOENT'?true:null;}
  receipt={absent};
 }
 const result=corePolicySync<{value?:boolean;error?:string}>('picture-maintenance.completed',[plan,receipt]);if(result.error)throw Error(result.error);return result.value!;
}
