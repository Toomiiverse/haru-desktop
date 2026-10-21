/** Exact tool adapters for Core-authored programs. No domain fallback or replay. */
import {randomUUID} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {ToolDeps} from './tools';
import {runCoreAgendaTool} from './core-agenda-tool';
import {runCoreBrowserTool} from './core-browser-tool';
import {readBrowserControlConfig} from './browserctl';
import {runCoreSettingTool} from './core-remaining';
import {zonedNow,localDateKey} from './dates';
import * as desktop from './desktop';
import {convertImage} from './convert';
import {readAniListConfig,lookUp,type MediaKind} from './anilist';
import {readSearchConfig,readWebPage,searchWeb,SearchBlocked} from './search';
import {fetchTranscript,watchUrl,titleFrom} from './transcripts';
import * as system from './system';
import * as vault from './vaultnotes';
import {semanticSimilarities} from './memory';
import {retrieveContext} from './retrieveContext';

type Packet={result?:unknown;raw?:boolean;delegateMemory?:boolean;state?:any;command?:any};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export async function runCoreFinalTool(name:string|undefined,args:Record<string,unknown>,latest:string,deps:ToolDeps):Promise<string|null>{
 const task=activeTask.getStore();if(!task)throw Error('final_tool_task_authority_required');
 await task.check();
 let packet=corePolicySync<Packet>('final-tools.start',[name??null,args,latest]);
 const facts=(keys:string[])=>{
  const values:Record<string,()=>unknown>={
   onWeb:()=>deps.onWeb(),hands:()=>deps.handsAllowed(),pageRead:()=>deps.pageWasRead?.()??false,desktopSupported:()=>desktop.desktopSupported(),desktopConfig:()=>desktop.readDesktopConfig(deps.store.get('desktop')),
   searchConfig:()=>readSearchConfig(deps.store.get('search')),anilistConfig:()=>readAniListConfig(deps.store.get('anilist')),
   systemConfig:()=>deps.readSystemConfig(),lastResults:()=>deps.lastResults(),lastSearchQuery:()=>deps.lastSearchQuery(),
   wardrobe:()=>deps.getWardrobeControls(),screen:()=>deps.screenSeen(),interests:()=>deps.getInterests(),config:()=>{if(!deps.policyConfig)throw Error('final_tool_config_required');return deps.policyConfig()},
   clock:()=>{const now=zonedNow(deps.CHAT_TIMEZONE);return {day:localDateKey(now),iso:now.toISOString(),epochMs:Date.now()}},uuid:()=>randomUUID(),
   capabilities:()=>Object.fromEntries(['makePicture','showWebPicture','claude','code','downloads','shell','mangaShelf','anime','booking','chats'].map(key=>[key,Boolean((deps as any)[key])])),
   vaultRoot:()=>deps.vault.root(),knowledgeConfig:()=>deps.getKnowledgeConfig()
  };
  return Object.fromEntries(keys.map(key=>{if(!values[key])throw Error('final_tool_fact_protocol');return [key,values[key]()] }));
 };
 const owned=async(c:any)=>{
  if(c.domain==='user-records'){if((!deps.userRecord))throw Error('owned_records_required');return JSON.stringify(deps.userRecord(c.tool==='note_check_in'?'tool.noteCheckin':'tool.saveJournal',c.args))}
  if(c.domain==='self'){if((!deps.policyConfig))throw Error('owned_settings_required');return JSON.stringify(await runCoreSettingTool(c.args,deps.policyConfig,deps))}
  if(c.domain==='browser-tool'){return JSON.stringify(await runCoreBrowserTool(c.args,{port:deps.browserPort(),fetch:deps.net.fetch as any,shotDir:deps.browserShotDir,markPageRead:deps.markPageRead,config:readBrowserControlConfig(deps.store.get('browser')),said:typeof c.latest==='string'?c.latest:''}))}
  if(c.domain==='agenda-tool'){return runCoreAgendaTool(c.tool,c.args,c.latest,zonedNow(deps.CHAT_TIMEZONE),deps)}
  throw Error('final_tool_delegate_protocol');
 };
 const execute=async(c:any):Promise<unknown>=>{
  switch(c.kind){
   case 'facts':return facts(c.keys);
   case 'owned':return owned(c);
   case 'animeLookup':return lookUp(c.title,c.mediaKind??undefined as MediaKind|undefined,deps.net.fetch);
   case 'convert':return convertImage(c.file,c.format);
   case 'findApps':return desktop.findApps();
   case 'listRunning':return desktop.listRunning();
   case 'launch':return desktop.launch(c.app);
   case 'closeApp':return desktop.closeApp(c.app);
   case 'cancelPower':return desktop.cancelPower();
   case 'runPower':return desktop.runPower(c.action);
   case 'readPage':if(!same(deps.lastResults(),c.expectedResults))throw Error('final_tool_selection_stale');return readWebPage(c.url,deps.net.fetch);
   case 'transcript':{const [transcript,title]=await Promise.all([fetchTranscript(c.videoId),deps.net.fetch(watchUrl(c.videoId),{headers:{'accept-language':'en'}}).then(r=>r.text()).then(titleFrom).catch(()=>null)]);return {transcript,title}}
   case 'markPageRead':return deps.markPageRead();
   case 'setChoices':return deps.setPendingChoices(c.choices);
   case 'search':return searchWeb(c.query,c.config,deps.net.fetch,deps.getSearchKey());
   case 'rememberSearch':return deps.rememberSearch(c.query,c.results);
   case 'showWardrobe':return deps.sendToWindows('wardrobe:open');
   case 'showOnScreen':return deps.showOnScreen(c.panel);
   case 'commit':if(!deps.applyToolPlan)throw Error('final_tool_commit_required');return deps.applyToolPlan(c.plan);
   case 'picture':if(!deps.makePicture)throw Error('final_tool_capability_revoked');return deps.makePicture(c.prompt);
   case 'webPicture':if(!deps.showWebPicture)throw Error('final_tool_capability_revoked');return deps.showWebPicture(c.result);
   case 'myself':return deps.myself();
   case 'claudeOpen':if(!deps.claude)throw Error('final_tool_capability_revoked');return deps.claude.open({folder:c.folder,name:c.name});
   case 'claudeList':if(!deps.claude)throw Error('final_tool_capability_revoked');return deps.claude.list();
   case 'code':if(!deps.code)throw Error('final_tool_capability_revoked');return deps.code.run(c);
   case 'claudeStop':if(!deps.claude)throw Error('final_tool_capability_revoked');return deps.claude.stop(c.id);
   case 'downloads':if(!deps.downloads)throw Error('final_tool_capability_revoked');if(c.action==='status')return deps.downloads.status();if(c.action==='pause')return deps.downloads.pause(c.title??undefined);if(c.action==='resume')return deps.downloads.resume(c.title??undefined);throw Error('final_tool_download_command');
   case 'shell':if(!deps.shell)throw Error('final_tool_capability_revoked');return deps.shell.run({command:c.command,said:c.said,door:c.door});
   case 'manga':if(!deps.mangaShelf)throw Error('final_tool_capability_revoked');if(c.action==='status')return deps.mangaShelf.status(c.args.title);if(c.action==='get')return deps.mangaShelf.get(c.args);throw Error('final_tool_manga_command');
   case 'anime':if(!deps.anime)throw Error('final_tool_capability_revoked');if(c.action==='status')return deps.anime.status(c.args.title);if(c.action==='watch')return deps.anime.watch(c.args);throw Error('final_tool_anime_command');
   case 'sleep':return deps.goBackToSleep({block:c.block});
   case 'book':if(!deps.booking)throw Error('final_tool_capability_revoked');return deps.booking.book(c.args);
   case 'vaultList':return vault.listVault(c.root,c.folder);
   case 'vaultRead':return vault.readNote(c.root,c.path);
   case 'vaultFolder':return vault.createFolder(c.root,c.path);
   case 'vaultWrite':return vault.writeNote(c.root,c.path,c.text,c.mode,c.preserve);
   case 'vaultAfterWrite':return deps.vault.afterWrite();
   case 'chatSearch':if(!deps.chats)throw Error('final_tool_capability_revoked');return deps.chats.search(c.args);
   case 'knowledge':{
    const embedder=deps.getKnowledgeEmbedder(),queryVector=await deps.tryEmbedQuery(c.query);
    const semantic=queryVector&&deps.memoryVectors().size?semanticSimilarities(deps.getMemories(),queryVector,deps.memoryVectors()):undefined;
    return retrieveContext({knowledge:deps.knowledgeStore(),embed:text=>embedder?embedder.embed(text):Promise.reject(Error('no model is set up')),memories:deps.getMemories(),semantic,query:c.query,now:new Date(),limit:c.config.contextChunks,threshold:c.config.threshold,maxChars:c.config.contextChars,filters:c.category?{category:c.category}:undefined});
   }
   case 'touchKnowledge':return deps.touchChunks(c.ids);
   case 'collectSystem':return system.collectSystem();
   case 'collectGpu':return system.collectGpu();
   case 'collectProcesses':return system.collectProcesses(c.limit);
   case 'collectDocker':return system.collectDocker();
   case 'collectServices':return system.collectServices(c.wanted??undefined);
   case 'collectAll':return system.collectAll();
   case 'systemCommand':return deps.runSystemCommand(c.file,c.args);
   case 'requestRestart':return deps.requestRestart();
   default:throw Error('final_tool_command_protocol');
  }
 };
 for(let step=0;step<256;step++){
  if(packet.delegateMemory)return null;
  if(Object.hasOwn(packet,'result'))return packet.raw?String(packet.result):JSON.stringify(packet.result);
  if(!packet.state||!packet.command||typeof packet.command.kind!=='string')throw Error('final_tool_packet_protocol');
  await task.check();const c=packet.command;
  // Factual equality fences, never alternative permission/target selection.
  if(c.guard&&!same(facts(c.guard.keys),c.guard.expected)){
   packet=corePolicySync('final-tools.observed',[packet.state,{ok:false,notDispatched:true,error:'permission snapshot changed'}]);continue;
  }
  let observation:unknown;
  try{observation={ok:true,value:await execute(c)}}catch(error){
   if(c.kind==='commit'||c.kind==='owned')throw error;
   observation={ok:false,error:error instanceof Error?error.message:String(error),blocked:error instanceof SearchBlocked,notDispatched:error instanceof Error&&error.message==='final_tool_capability_revoked'};
  }
  await task.check();
  packet=corePolicySync('final-tools.observed',[packet.state,observation]);
 }
 throw Error('final_tool_program_bound');
}
