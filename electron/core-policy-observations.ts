/** Core requests observations; this transport helper makes no domain choice. */
import {corePolicySync} from './core-policy-sync';
export function coreRandomPolicy<T>(operation:string,args:unknown[],random:()=>number):T {
  const draws:number[]=[];
  for(let attempt=0;attempt<3;attempt++){
    const plan=corePolicySync<{result:T}|{needsDraws:number}>(operation,[...args,draws]);
    if('result' in plan)return plan.result;
    if(!Number.isInteger(plan.needsDraws)||plan.needsDraws<=draws.length||plan.needsDraws>2)throw Error('core_random_observation_protocol');
    while(draws.length<plan.needsDraws)draws.push(random());
  }
  throw Error('core_random_observation_unconfirmed');
}
export function coreEntropyPolicy<T>(operation:string,args:unknown[],slots:number,generate:()=>string):T {
  const ids:(string|null)[]=Array.from({length:slots},()=>null);
  const plan=corePolicySync<{result:T}|{needsEntropy:number[]}>(operation,[...args,ids]);
  if('result' in plan)return plan.result;
  if(plan.needsEntropy.length>slots||new Set(plan.needsEntropy).size!==plan.needsEntropy.length||plan.needsEntropy.some(i=>!Number.isInteger(i)||i<0||i>=slots))throw Error('core_entropy_observation_protocol');
  for(const i of plan.needsEntropy)ids[i]=generate();
  const confirmed=corePolicySync<{result:T}|{needsEntropy:number[]}>(operation,[...args,ids]);
  if(!('result' in confirmed))throw Error('core_entropy_observation_unconfirmed');
  return confirmed.result;
}
