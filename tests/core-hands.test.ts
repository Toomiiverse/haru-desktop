import test from 'node:test';
import assert from 'node:assert/strict';
import {coreHandsWhyNotAct,ownTimeReceipt} from '../electron/core-hands';
import {whyNotAct,DEFAULT_HANDS,type Moment} from '../electron/herhands';
const call=(name:string,args:Record<string,unknown>)=>({function:{name,arguments:JSON.stringify(args)}});
const moment:Moment={level:4,config:DEFAULT_HANDS,minutes:600,asleep:false,speaking:false,idleMs:1200000,sinceLastMs:Number.MAX_SAFE_INTEGER,doneToday:0,busy:false};
test('disabled own-time gate preserves existing policy without a Core request',async()=>{
 const old=process.env.HARU_CORE_AUTONOMOUS_HANDS;delete process.env.HARU_CORE_AUTONOMOUS_HANDS;
 try{assert.equal(await coreHandsWhyNotAct(moment),whyNotAct(moment));}
 finally{old===undefined?delete process.env.HARU_CORE_AUTONOMOUS_HANDS:process.env.HARU_CORE_AUTONOMOUS_HANDS=old;}
});
test('retired activity acknowledgements are never upgraded to completed deeds',()=>{
 for(const name of ['read_manga','play_pokemon'])for(const value of [{started:true},{read:true,title:'Fixture',chapter:1,pages:[1,4]}, {started:true,pending:true}])
  assert.notEqual(ownTimeReceipt(call(name,{action:'start',wait:true}),JSON.stringify(value)).outcome,'succeeded');
});
