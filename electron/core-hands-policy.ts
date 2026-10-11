/** Execute a Core hands plan under the existing periodic grant and native writer. */
import {corePolicySync} from './core-policy-sync';
import {commitDayNightPlan} from './core-day-night';
import type {CoreStore} from './core-store';
import {activeHandsIntent} from './core-hands-context';

export async function runOwnedHands(adapter:{core:CoreStore;read:()=>any;dispatch:(request:any)=>Promise<any>}){
  const assertCurrent=()=>corePolicySync('hands.assertCurrent',[adapter.read().scope]);
  assertCurrent();
  if((true as boolean)){
    const recovery=corePolicySync<any>('hands.reconcile',[adapter.read()]);
    if(recovery.plan){commitDayNightPlan(adapter.core,recovery.plan,assertCurrent);return recovery.result;}
  }
  const prepared=corePolicySync<any>('hands.start',[adapter.read()]);
  if(Object.hasOwn(prepared,'result'))return prepared.result;
  commitDayNightPlan(adapter.core,prepared.plan,assertCurrent);
  // A lost commit reply never authorises dispatch or a fresh attempt.
  assertCurrent();
  const request=corePolicySync<any>('hands.dispatch',[prepared.state,adapter.read()]);
  let observation:any;
  try {observation={...await ((true as boolean)
    ?activeHandsIntent.run({taskId:request.taskId,assertCurrent},()=>adapter.dispatch(request))
    :adapter.dispatch(request)),ok:true};}
  catch {observation={ok:false};}
  // Cancellation/lost ownership leaves the durable intent unresolved.
  assertCurrent();
  const settled=corePolicySync<any>('hands.settle',[prepared.state,observation,adapter.read()]);
  commitDayNightPlan(adapter.core,settled.plan,assertCurrent);
  return settled.result;
}
