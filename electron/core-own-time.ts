/** Execute Core's own-time plans with atomic stale-state refusal. */
import {corePolicySync} from './core-policy-sync';
type WeekFacts={now:Date;nowMs:number;today:string;identity:string;week:unknown;days:unknown[];nights:unknown[];projects:unknown[];interests:unknown[]};
type StandingFacts={now:Date;attemptedAt:string;identity:string;lastAt:string|null;slights:unknown[];wakes:unknown[];memories:unknown[]};
type Dispatch=(system:string,user:string)=>Promise<string>;
export async function runCoreWeek(adapter:{read:()=>WeekFacts;dispatch:Dispatch;write:(record:{day:string;summary:string})=>void}) {
  const plan=corePolicySync<{expected:Record<string,unknown>;system:string;user:string;day:string}|null>('own-time.weekPlan',[adapter.read()]);
  if(!plan)return {status:'skipped'};
  const raw=await adapter.dispatch(plan.system,plan.user);
  const accepted=corePolicySync<{record:{day:string;summary:string}}|null>('own-time.weekAccept',[plan,raw]);
  if(!accepted)return {status:'skipped'};
  const current=adapter.read();
  for(const [key,value] of Object.entries(plan.expected))if(JSON.stringify(current[key as keyof WeekFacts])!==JSON.stringify(value))throw Error('core_own_time_stale_snapshot');
  adapter.write(accepted.record);
  return {status:'applied',record:accepted.record};
}
export async function runCoreStanding(adapter:{read:()=>StandingFacts;stamp:(at:string)=>void;dispatch:Dispatch;write:(text:string,kind:'preference',subject:string,options:{source:'inferred';evidenceDetail?:string})=>unknown}) {
  const plan=corePolicySync<{expectedLastAt:string|null;attemptedAt:string;system:string;user:string}|null>('own-time.standingBegin',[adapter.read()]);
  if(!plan)return {status:'skipped'};
  if(adapter.read().lastAt!==plan.expectedLastAt)throw Error('core_own_time_stale_snapshot');
  adapter.stamp(plan.attemptedAt);
  const raw=await adapter.dispatch(plan.system,plan.user);
  const accepted=corePolicySync<{text:string;kind:'preference';subject:string;options:{source:'inferred';evidenceDetail?:string}}|null>('own-time.standingAccept',[plan,raw]);
  if(!accepted)return {status:'skipped'};
  if(adapter.read().lastAt!==plan.attemptedAt)throw Error('core_own_time_stale_snapshot');
  const receipt=adapter.write(accepted.text,accepted.kind,accepted.subject,accepted.options);
  return {status:'receipted',receipt};
}
