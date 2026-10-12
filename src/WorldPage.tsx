import { useEffect, useRef, useState } from 'react';
import { mountWorkWorld } from '../elsewhere/work-client.mjs';
import '../elsewhere/work.css';

export function WorldPage({ onOpenChat }: { onOpenChat: () => void }) {
  const root=useRef<HTMLDivElement>(null);
  const openChat=useRef(onOpenChat);openChat.current=onOpenChat;
  const [error,setError]=useState('');
  useEffect(()=>{
    let disposed=false,cleanup:(()=>void)|undefined;
    const bridge=window.haru?.world;
    if(!bridge){setError('The work bridge is unavailable in this desktop build.');return;}
    void bridge.assets().then(assetUrls=>{
      if(disposed||!root.current)return;
      cleanup=mountWorkWorld(root.current,{snapshot:()=>bridge.get(),detail:(id:string,before?:number)=>bridge.detail(id,before)},{assetUrls,chatHref:'#',onOpenChat:()=>openChat.current()});
    }).catch(()=>setError('Work artwork could not be loaded. Reopen World to reconnect.'));
    return()=>{disposed=true;cleanup?.();};
  },[]);
  return <>{error&&<p role="alert">{error}</p>}<div ref={root}/></>;
}
