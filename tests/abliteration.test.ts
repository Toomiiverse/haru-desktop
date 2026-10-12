import test from 'node:test';
import assert from 'node:assert/strict';
import { directCredentialName, isAllowedTaskProvider } from '../electron/direct-providers';
import { abliterationPricing } from '../electron/direct-catalog';
import { toOpenAIBody } from '../electron/provider';
test('Abliteration credentials and eligibility are restricted to the exact HTTPS host',()=>{
 assert.equal(directCredentialName('https://api.abliteration.ai/v1'),'ABLITERATION_API_KEY');
 for(const url of ['http://api.abliteration.ai/v1','https://api.abliteration.ai.evil.test/v1','https://api.abliteration.ai:444/v1','https://user@api.abliteration.ai/v1'])assert.equal(directCredentialName(url),undefined);
 assert.equal(isAllowedTaskProvider({provider:'openai',model:'abliterated-model-large-v2',endpoint:'https://api.abliteration.ai/v1',temperature:.7}),true);
});
test('Large V2 sends explicit low reasoning for tool and ordinary turns',()=>{
 const body=toOpenAIBody({model:'abliterated-model-large-v2',conversation:[{role:'user',content:'Hello'}],maxTokens:512,temperature:.7,stream:true}) as any;
 assert.equal(body.reasoning_effort,'low');assert.equal(body.max_tokens,512);assert.equal(body.temperature,.7);
});
test('Abliteration pricing uses only the exact V2 row and reflects changed rates',()=>{
 const doc='| `abliterated-model` | $1.00 | $0.10 | $3.00 |\n| `abliterated-model-large-v2` | $3.00 | $0.30 | $5.00 |';
 assert.deepEqual(abliterationPricing(doc),{inputUsdPerMillion:3,cachedInputUsdPerMillion:.3,outputUsdPerMillion:5});
 assert.equal(abliterationPricing(doc.replace('$5.00','$6.00'))?.outputUsdPerMillion,6);
 assert.deepEqual(abliterationPricing(doc.replace(/\$/g,'\\$')),abliterationPricing(doc));
 assert.equal(abliterationPricing(doc.split('\n')[0]),null);assert.equal(abliterationPricing('Unavailable'),null);
});
