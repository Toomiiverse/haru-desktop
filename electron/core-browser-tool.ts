/** Execute the exact Core browser continuation inside the existing task. */
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import {activateTab,closeTab,listTargets,navigate,openTab,pageText,screenshot,type BrowserControlConfig} from './browserctl';
import {playwrightArgs,playwrightBrowser,type PlaywrightBrowser} from './playwright';
import {startGuardProxy} from './webguard';
import {formatReading} from './pagesnapshot';

type Adapter={port:number;fetch:Parameters<typeof listTargets>[1];shotDir:()=>string;markPageRead:()=>void;
  /** Facts for Core: which browser is configured and what they said this turn. Core decides from them. */
  config?:BrowserControlConfig;said?:string};

/** Her own browser process, kept between calls so the page she opened is the page Core's next command acts on. */
let own:PlaywrightBrowser|null=null;
function ownBrowser(config:BrowserControlConfig):PlaywrightBrowser{
  if(own)return own;
  own=playwrightBrowser({
    startProxy:()=>startGuardProxy({log:line=>console.log(line)}),
    spawn:proxyPort=>{
      // Through package.json: the package exports no ./cli.js subpath.
      const cli=path.join(path.dirname(require.resolve('@playwright/mcp/package.json')),'cli.js');
      const out=path.join(os.tmpdir(),'haru-browser');mkdirSync(out,{recursive:true});
      // A bare environment: none of her keys reach the browser process.
      const env:NodeJS.ProcessEnv={PATH:process.env.PATH??'/usr/local/bin:/usr/bin:/bin',HOME:os.homedir(),LANG:'C.UTF-8',TMPDIR:os.tmpdir(),ELECTRON_RUN_AS_NODE:'1',
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH?{PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH}:{})};
      const child=spawn(process.execPath,playwrightArgs(cli,config,proxyPort,out),{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
      child.stderr?.on('data',(chunk:Buffer)=>{const line=String(chunk).trim();if(line)console.log(`[browser] ${line.slice(0,300)}`);});
      return child;
    },
    log:line=>console.log(line),warn:line=>console.warn(line),
  });
  return own;
}

/** Executes exactly one page command Core chose; returns what the page now shows, or the saved screenshot's path. */
async function page(command:any,adapter:Adapter):Promise<unknown>{
  if(!adapter.config)throw Error('core_browser_config_required');
  const b=ownBrowser(adapter.config);
  const shown=async(reading:ReturnType<typeof b.read>,part=1)=>{const r=await reading;return {title:r.title,url:r.url,...formatReading(r,part)};};
  switch(command.op){
    case 'open':return shown(b.open(command.url));
    case 'read':return shown(b.read(),command.part);
    case 'follow':return shown(b.follow(command.number));
    case 'click':return shown(b.click(command.number));
    case 'type':return shown(b.type(command.number,command.text,command.submit===true));
    case 'scroll':return shown(b.scroll(command.direction));
    case 'back':return shown(b.back());
    case 'screenshot':{
      const picture=await b.screenshot(command.full===true);
      const dir=adapter.shotDir();mkdirSync(dir,{recursive:true});
      const file=path.join(dir,`browser-${Date.now().toString(36)}.${picture.mimeType==='image/png'?'png':'jpg'}`);
      writeFileSync(file,Buffer.from(picture.image,'base64'));return file;
    }
    case 'close':await b.close();return true;
    default:throw Error('core_browser_page_protocol');
  }
}
export async function runCoreBrowserTool(args:Record<string,unknown>,adapter:Adapter){
  const task=activeTask.getStore();if(!task)throw Error('browser_task_authority_required');
  await task.check();let packet=corePolicySync<any>('browser-tool.start',[args,{backend:adapter.config?.enabled?adapter.config.backend:null,said:adapter.said??''}]);
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
        case 'page':value=await page(command,adapter);break;
        default:throw Error('core_browser_command_protocol');
      }
      observation={ok:true,value};
    }catch(error){observation={ok:false,error:error instanceof Error?error.message:String(error)};}
    await task.check();packet=corePolicySync<any>('browser-tool.observed',[packet.state,observation]);
  }
  throw Error('core_browser_continuation_bound');
}
