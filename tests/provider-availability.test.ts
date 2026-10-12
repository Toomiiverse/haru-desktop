import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderAvailability,BILLING_COOLDOWN_MS} from '../electron/provider-availability';
import type {ProviderConfig} from '../electron/model-registry';
const cloud:ProviderConfig={provider:'openai',model:'fixture',endpoint:'https://example.test/v1',temperature:0};
test('billing cooldown survives restart but expired or malformed persisted rows cannot disable a provider',async()=>{
 let saved:unknown;let now=1000;
 const first=new ProviderAvailability(()=>{},()=>now,undefined,rows=>{saved=rows;});
 await assert.rejects(first.run(cloud,async()=>{throw Error('insufficient_quota');}));
 const restored=new ProviderAvailability(()=>{},()=>now,saved,rows=>{saved=rows;});
 assert.equal(restored.available(cloud),false);
 now+=BILLING_COOLDOWN_MS;assert.equal(restored.available(cloud),true);assert.deepEqual(saved,[]);
 const invalid=new ProviderAvailability(()=>{},()=>now,[{key:'openai:https://example.test/v1',until:Infinity}]);
 assert.equal(invalid.available(cloud),true);
});
test('billing failure blocks the account across models, expires and never extends on skips',async()=>{
 let now=1000,calls=0;const notices:any[]=[];const gate=new ProviderAvailability(event=>notices.push(event),()=>now);
 await assert.rejects(gate.run(cloud,async()=>{calls++;throw Error('Billing account is not in good standing for this request.');}));
 assert.equal(gate.available({...cloud,model:'other'}),false);
 now+=100;
 await assert.rejects(gate.run(cloud,async()=>{calls++;return 'bad';}),/provider_billing_cooldown/);
 assert.equal(calls,1);assert.equal(notices.length,1);assert.equal(gate.retryAt(cloud),1000+BILLING_COOLDOWN_MS);
 assert.equal(gate.available({...cloud,endpoint:'https://second.test/v1'}),true);
 now=1000+BILLING_COOLDOWN_MS;assert.equal(await gate.run(cloud,async()=>'recovered'),'recovered');
});
test('timeouts, cancellation, poor answers and local failures do not block the provider',async()=>{
 const gate=new ProviderAvailability();
 for(const message of ['cancelled','deadline','invalid answer','HTTP 429 rate limited']) {
  await assert.rejects(gate.run(cloud,async()=>{throw Error(message);}));assert.equal(gate.available(cloud),true);
 }
 const local={...cloud,provider:'ollama' as const,endpoint:'http://127.0.0.1:11436'};
 await assert.rejects(gate.run(local,async()=>{throw Error('insufficient_quota');}));assert.equal(gate.available(local),true);
});
