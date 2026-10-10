import fs from 'node:fs';import path from 'node:path';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
export function coreInsideVault(root:string,given:string,kind:'note'|'folder'):any{
 const p=corePolicySync<any>('final-vault.path',[Boolean(root),given,kind]);if(!p.ok)return p;
 const anchor=path.resolve(root),full=path.resolve(anchor,p.relative);
 if(full!==anchor&&!full.startsWith(anchor+path.sep))return {ok:false,error:'That leaves the vault.'};
 let current=anchor;
 for(const part of p.relative.split('/').filter(Boolean)){
  current=path.join(current,part);
  try{const stat=fs.lstatSync(current);if(stat.isSymbolicLink())return {ok:false,error:'Linked paths are not editable vault notes.'};if(stat.isFile()&&stat.nlink>1)return {ok:false,error:'Shared hard-linked files are not editable vault notes.'};}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')break;return {ok:false,error:'Cannot verify this vault path.'};}
 }
 if(p.bare){const bare=path.resolve(anchor,p.bare);if(fs.existsSync(bare)&&fs.statSync(bare).isDirectory())return {ok:false,error:`"${p.bare}" is a folder, not a note.`};}
 return {ok:true,full,relative:p.relative};
}
function observation(file:string){try{const s=fs.statSync(file);return {exists:true,file:s.isFile(),directory:s.isDirectory(),stamp:{ino:s.ino,dev:s.dev,size:s.size,mtimeMs:s.mtimeMs}};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {exists:false,file:false,directory:false,stamp:null};throw error;}}
export function coreVault(mode:'list'|'read'|'write'|'folder',root:string,given:string,args:unknown={}):any{
 const where=coreInsideVault(root,given,mode==='list'||mode==='folder'?'folder':'note');if(!where.ok)return where;
 let packet=corePolicySync<any>('final-vault.start',[mode,where.relative,args]);
 for(let n=0;n<8;n++){
  if(Object.hasOwn(packet,'result'))return packet.result;activeTask.getStore()?.signal.throwIfAborted();const c=packet.command;let value:unknown;
  // Repeat physical confinement before each local effect/read. No alternate target is selected.
  const checked=coreInsideVault(root,given,mode==='list'||mode==='folder'?'folder':'note');if(!checked.ok||checked.full!==where.full)throw Error('vault_path_revoked');
  if(c.kind==='stat')value=observation(where.full);
  else if(c.kind==='list')value=fs.readdirSync(where.full,{withFileTypes:true}).map(e=>{const stat=e.isFile()?fs.statSync(path.join(where.full,e.name)):null;return {name:e.name,directory:e.isDirectory(),file:e.isFile(),bytes:stat?.size??0,modified:stat?.mtime.toISOString()??''};});
  else if(c.kind==='read'){const text=fs.readFileSync(where.full,'utf8');value={prefix:text.slice(0,c.maxChars+1),chars:text.length};}
  else if(c.kind==='tail'){const text=fs.readFileSync(where.full,'utf8');value={twoNewlines:text.endsWith('\n\n'),oneNewline:text.endsWith('\n')};}
  else if(c.kind==='mkdir'){fs.mkdirSync(where.full,{recursive:true});value={};}
  else if(c.kind==='write'||c.kind==='append'){
   if(JSON.stringify(observation(where.full).stamp)!==JSON.stringify(c.expected))throw Error('vault_file_stale');
   fs.mkdirSync(path.dirname(where.full),{recursive:true});
   try{if(c.kind==='append')fs.appendFileSync(where.full,c.body,'utf8');else fs.writeFileSync(where.full,c.body,{encoding:'utf8',flag:c.flag});value={};}
   catch(error){if(c.flag==='wx'&&(error as NodeJS.ErrnoException).code==='EEXIST')value={collision:true};else throw error;}
  }else throw Error('vault_command_protocol');
  packet=corePolicySync('final-vault.observed',[packet.state,value]);
 }
 throw Error('vault_program_bound');
}
