/** Execute Core project plans. No local ranking, parsing, retry or alternative. */
import {corePolicySync} from './core-policy-sync';
import {coreEntropyPolicy} from './core-policy-observations';
import type {Project,Worked} from './projects';
const bindings=new WeakMap<object,Project>();
type Dispatch=(request:any,config?:unknown)=>Promise<string>;
function fence(expected:Project[],read:()=>Project[]){if(JSON.stringify(expected)!==JSON.stringify(read()))throw Error('core_project_stale_snapshot');}
export async function runCoreProjectStep(project:Project,identity:string,dispatch:Dispatch):Promise<Worked> {
  let plan=corePolicySync<any>('projects.stepPlan',[project,identity]);
  for(let packet=0;packet<3;packet++){
    if('result' in plan){bindings.set(plan.result,plan.expectedRecord);return plan.result;}
    let observation;try{observation={ok:true,text:await dispatch(plan.request)};}catch{observation={ok:false};}
    plan=corePolicySync<any>('projects.stepObserved',[plan,observation]);
  }
  throw Error('core_project_step_protocol');
}
export async function runCoreProjectBirth(adapter:{read:()=>Project[];write:(rows:Project[])=>void;identity:string;interest?:unknown;parent?:Project;now:()=>string;dispatch:Dispatch}) {
  const plan=corePolicySync<any>('projects.birthPlan',[adapter.read(),adapter.identity,adapter.interest??null,adapter.parent??null]);
  if(!plan)return null;
  const raw=await adapter.dispatch(plan.request);
  const accepted=coreEntropyPolicy<{ledger:Project[];record:Project}|null>('projects.birthObserved',[plan,raw,adapter.now()],1,()=>Math.random().toString(36).slice(2,10));
  if(!accepted)return null;
  fence(plan.expected,adapter.read);adapter.write(accepted.ledger);return accepted.record;
}
export async function runCoreReadingOutcome(project:Worked,reading:string,nudge:unknown,defaultConfig:unknown,random:()=>number,dispatch:Dispatch):Promise<'did'|'part'|'no'|'nothing'> {
  const plan=corePolicySync<any>('projects.readingPlan',[project,reading,random(),nudge,defaultConfig]);
  let observation:{ok:boolean;text?:string}={ok:false};
  if(plan.request){try{observation={ok:true,text:await dispatch(plan.request,plan.config)};}catch{observation={ok:false};}}
  return corePolicySync('projects.readingObserved',[plan,observation]);
}
export async function runCoreProjectSettlement(adapter:{project:Worked;reading:string;outcome:string;identity:string;stamp:string;dispatch:Dispatch;read:()=>Project[];write:(rows:Project[])=>void}):Promise<Worked|null> {
  const expected=bindings.get(adapter.project)??corePolicySync<Project>('projects.settleSnapshot',[adapter.project,adapter.read()]);
  let plan=corePolicySync<any>('projects.settlePlan',[adapter.project,adapter.reading,adapter.outcome,adapter.identity,adapter.stamp]);
  for(let packet=0;packet<3;packet++){
    if('result' in plan){
      if(!plan.result)return null;
      const observed=adapter.read();const rows=corePolicySync<Project[]>('projects.settleCommit',[expected,plan.result,observed]);
      fence(observed,adapter.read);adapter.write(rows);return plan.result;
    }
    const raw=await adapter.dispatch(plan.request);plan=corePolicySync<any>('projects.settleObserved',[plan,raw]);
  }
  throw Error('core_project_settlement_protocol');
}
