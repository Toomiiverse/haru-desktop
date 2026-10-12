/** Authenticated Core decisions; factual availability callbacks stay in Node. */
import {corePolicySync} from './core-policy-sync';
export function naturalTurn<T=any>(name:string,args:unknown[]):T{
 const wire=corePolicySync<any>('natural-turn.'+name,JSON.parse(JSON.stringify(args)));
 if(wire?.ok!==true)throw Error(wire?.error?.message??'core_natural_turn_protocol');
 return wire.value as T;
}

export async function naturalSelection<T>(first:()=>Promise<T|undefined>,second:()=>Promise<T|undefined>):Promise<T|undefined>{
 let packet=naturalTurn<any>('selectionStart',[]);
 for(let n=0;n<3;n++){
  if(Object.hasOwn(packet,'result'))return packet.result??undefined;
  const value=packet.command==='first'?await first():packet.command==='second'?await second():(()=>{throw Error('core_route_selection_command')})();
  packet=naturalTurn<any>('selectionObserved',[packet,value??null]);
 }
 throw Error('core_route_selection_bound');
}
