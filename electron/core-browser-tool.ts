/** Execute the exact Core browser continuation inside the existing task. */
import path from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import {activateTab,closeTab,listTargets,navigate,openTab,pageText,screenshot} from './browserctl';

type Adapter={port:number;fetch:Parameters<typeof listTargets>[1];shotDir:()=>string;markPageRead:()=>void};
export async function runCoreBrowserTool(args:Record<string,unknown>,adapter:Adapter){
  const task=activeTask.getStore();if(!task)throw Error('browser_task_authority_required');
  await task.check();let packet=corePolicySync<any>('browser-tool.start',[args]);
  let png:Uint8Array|null=null;
  for(let count=0;count<4;count++){
    await task.check();
    if(Object.hasOwn(packet,'result')){if(packet.markPageRead===true)adapter.markPageRead();return packet.result;}
    const command=packet.command;
    if(!command||typeof command.kind!=='string'||!packet.state)throw Error('core_browser_protocol');
    let observation:any;
    try{
      let value:unknown;
      switch(command.kind){
        case 'list':case 'targets':value=await listTargets(adapter.port,adapter.fetch);break;
        case 'open':value=await openTab(adapter.port,command.url,adapter.fetch);break;
        case 'navigate':await navigate(adapter.port,command.tab,command.url,adapter.fetch);break;
        case 'read':value=await pageText(adapter.port,command.tab,adapter.fetch);break;
        case 'screenshot':png=await screenshot(adapter.port,command.tab,adapter.fetch);value=png!==null;break;
        case 'save':{
          if(!png)throw Error('core_browser_screenshot_binding');
          const dir=adapter.shotDir();mkdirSync(dir,{recursive:true});
          const file=path.join(dir,`browser-${Date.now().toString(36)}.png`);writeFileSync(file,Buffer.from(png));value=file;break;
        }
        case 'close':await closeTab(adapter.port,command.tab,adapter.fetch);break;
        case 'activate':await activateTab(adapter.port,command.tab,adapter.fetch);break;
        default:throw Error('core_browser_command_protocol');
      }
      observation={ok:true,value};
    }catch(error){observation={ok:false,error:error instanceof Error?error.message:String(error)};}
    await task.check();packet=corePolicySync<any>('browser-tool.observed',[packet.state,observation]);
  }
  throw Error('core_browser_continuation_bound');
}
