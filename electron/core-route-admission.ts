/** URL syntax and credential/capability observations only. Python decides routes. */
import {corePolicySync} from './core-policy-sync';
import type {ModelEntry,RouteRequest} from './model-registry';
export function routeUrlFacts(value:unknown):Record<string,unknown>{
  const urls:Record<string,unknown>={};
  const visit=(item:unknown)=>{
    if(Array.isArray(item)){for(const child of item)visit(child);return;}
    if(!item||typeof item!=='object')return;
    for(const [key,child] of Object.entries(item)){
      if(key==='endpoint'&&typeof child==='string'){
        try{const u=new URL(child);urls[child]={protocol:u.protocol,hostname:u.hostname,port:u.port,username:!!u.username,password:!!u.password,search:!!u.search,hash:!!u.hash};}
        catch{urls[child]=null;}
      }else visit(child);
    }
  };visit(value);return urls;
}
export function routePolicy<T>(name:string,args:unknown[]):T {
  return corePolicySync('route-admission.'+name,[...args,routeUrlFacts(args)]);
}
export function observedRequest(entries:readonly ModelEntry[],request:RouteRequest){
  const {available,...snapshot}=request;
  return {...snapshot,availability:entries.map(entry=>available?.(entry)!==false)};
}
