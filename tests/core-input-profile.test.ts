import test from 'node:test';
import assert from 'node:assert/strict';
import {coreInputProfile} from '../electron/core-router';

test('preparation optimization requires all flags, full scope and fresh input',async()=>{
  const names=['HARU_CORE_INPUT_PROFILES','HARU_CORE_ROUTER','HARU_CORE_HARNESS','HARU_CORE_VISUAL_PROFILES','HARU_CORE_HARNESS_PATH_PREFIX'];
  const prior=names.map(name=>process.env[name]);
  try{
    for(const name of names.slice(0,4))process.env[name]='on';delete process.env.HARU_CORE_HARNESS_PATH_PREFIX;
    // No client is constructed for any of these disabled boundaries.
    assert.equal(await coreInputProfile('Describe this image.',false),'normal');
    for(const name of names.slice(0,4)){
      delete process.env[name];assert.equal(await coreInputProfile('Describe this image.',true),'normal');process.env[name]='on';
    }
    process.env.HARU_CORE_HARNESS_PATH_PREFIX='HaruCoreCanary';
    assert.equal(await coreInputProfile('Describe this image.',true),'normal');
    delete process.env.HARU_CORE_HARNESS_PATH_PREFIX;
    // A failed hint retains the existing prefetch behavior.
    assert.equal(await coreInputProfile('Describe this image.',true),'normal');
  }finally{names.forEach((name,i)=>prior[i]===undefined?delete process.env[name]:process.env[name]=prior[i]);}
});
