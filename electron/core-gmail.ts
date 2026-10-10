/** Authenticated transport only. Core decides Gmail permissions, timing and effects. */
import {readFileSync,statSync} from 'node:fs';
import {coreAdapterOwner} from './core-policy-sync';
import {coreServiceOptions} from './core-service-client';

export async function coreGmail(op:string,args:Record<string,unknown>={},latest='',ui=false,openmail=false):Promise<any>{
 const options=coreServiceOptions();
 if(!options)throw Error('gmail_core_unavailable');
 const endpoint=new URL(options.endpoint);
 if(endpoint.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw Error('core_service_loopback_required');
 if(statSync(options.tokenFile).mode & 0o077)throw Error('core_service_token_must_be_private');
 const token=readFileSync(options.tokenFile,'utf8').trim();
 if(token.length<32)throw Error('core_service_token_invalid');
 const response=await fetch(endpoint.origin+'/v1/'+(openmail?'openmail':'gmail')+'/'+(ui?'ui':'adapter'),{
  method:'POST',redirect:'error',headers:{'Content-Type':'application/json',
   authorization:'Bearer '+token},
  body:JSON.stringify({owner:coreAdapterOwner(),nowMs:Date.now(),op,args,latest}),
  signal:AbortSignal.timeout(180000)});
 const value=await response.json();
 if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'gmail_request_failed');
 return value;
}

export async function runGmailTool(name:string|undefined,args:Record<string,unknown>,latest:string):Promise<string|null>{
 if(!name||!['gmail_status','search_gmail','read_gmail_thread','list_gmail_labels','prepare_gmail_action','confirm_gmail_action','openmail_status','search_openmail','read_openmail_thread'].includes(name))return null;
 try{return JSON.stringify(await coreGmail('tool',{name,arguments:args},latest,false,['openmail_status','search_openmail','read_openmail_thread'].includes(name)));}
 catch(error){return JSON.stringify({error:error instanceof Error?error.message:'gmail_unavailable',executed:false});}
}
