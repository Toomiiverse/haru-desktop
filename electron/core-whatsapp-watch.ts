// Owned-brain transport to Python's private WhatsApp path. No interpretation.
import {readFileSync} from 'node:fs';
import {coreServiceOptions} from './core-service-client';
function binding() {
  const options=coreServiceOptions();if(!options)throw Error('core_whatsapp_owner_required');
  const u=new URL(options.endpoint);if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname))throw Error('core_whatsapp_loopback_required');
  const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
  return {url:u.origin,token:readFileSync(options.tokenFile,'utf8').trim(),owner:{pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}};
}
async function request(path:string,body:unknown) {
  const t=binding();const response=await fetch(t.url+'/v1/whatsapp/'+path,{method:'POST',redirect:'error',
    headers:{'content-type':'application/json',authorization:'Bearer '+t.token},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('core_whatsapp_private_path_unavailable');return response.json();
}
export async function coreWhatsAppSelf(message:{id:string;text:string;at?:string}) {return request('self',{id:message.id,text:message.text,at:message.at});}
export async function coreWhatsAppPublish(key:string,capture:()=>object,commit:(plan:unknown)=>void) {
  const t=binding(),prepared=await request('publish',{phase:'prepare',key,owner:t.owner,facts:capture()});
  if(!prepared.preparedId)return prepared;
  const reserved=await request('publish',{phase:'commit',preparedId:prepared.preparedId,owner:t.owner,facts:capture()});
  if(!reserved.commitPlan)return reserved;
  try {commit(reserved.commitPlan);} catch(error) {await request('publish',{phase:'reject',grant:reserved.grant,owner:t.owner}).catch(()=>{});throw error;}
  return request('publish',{phase:'send',grant:reserved.grant,owner:t.owner,facts:capture()});
}
