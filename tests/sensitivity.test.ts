// What may leave the machine, and what stays.

import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationMayLeave, mayLeaveTheMachine } from '../electron/sensitivity';
import { assertOutboundSafe } from '../electron/outbound';
import { receivedProviderMessage } from '../electron/provider-state';
import type { ChatMessage } from '../electron/provider';

test('received local tool IDs are protocol metadata while arguments and results remain private',()=>{
 const id='aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0rS';
 const message:ChatMessage={role:'assistant',content:'',tool_calls:[{id,function:{name:'vault_read',arguments:{path:'Notes/One.md'}}}]};
 assert.throws(()=>assertOutboundSafe([message]),/outbound_privacy_blocked/);
 receivedProviderMessage(message);
 assert.doesNotThrow(()=>assertOutboundSafe([message,{role:'tool',tool_call_id:id,content:'Copper badge.'}]));
 assert.throws(()=>assertOutboundSafe([message,{role:'tool',tool_call_id:id,content:'My password is fixture-secret.'}]),/outbound_privacy_blocked/);
 assert.throws(()=>assertOutboundSafe([{...message,tool_calls:[{id,function:{name:'vault_read',arguments:{path:'password: fixture-secret'}}}]}]),/outbound_privacy_blocked/);
});

test('naming a secret keeps their message home; her own line only when a value is beside the word', () => {
  assert.equal(mayLeaveTheMachine("what's my wifi password again").safe, false);
  assert.equal(mayLeaveTheMachine("you're using my name like a password. What do you want?", false, { namesAlone: false }).safe, true);
  assert.equal(mayLeaveTheMachine('fine, the password is hunter2now', false, { namesAlone: false }).safe, false);
  assert.equal(mayLeaveTheMachine('your api key: abcd1234efgh', false, { namesAlone: false }).safe, false);
  assert.equal(mayLeaveTheMachine('sk-abcdefghijklmnopqrstuvwxyz', false, { namesAlone: false }).safe, false, 'a key-shaped thing is refused whoever said it');
  const hers = { role: 'assistant', content: "you're using my name like a password" };
  assert.equal(conversationMayLeave([hers, { role: 'user', content: 'how was your day' }]).safe, true, 'her teasing does not keep the conversation home');
  assert.equal(conversationMayLeave([{ role: 'user', content: 'remind me of my password later' }, { role: 'user', content: 'how was your day' }]).safe, false, 'his does');
  assert.equal(conversationMayLeave([{ role: 'user', content: 'remind me of my password later' }, { role: 'user', content: 'hi' }]).because, 'it is about passwords or keys', 'their own earlier message, said plainly');
  assert.match(conversationMayLeave([{ role: 'assistant', content: 'the password is hunter2now' }, { role: 'user', content: 'hi' }]).because, /from earlier in this conversation/, 'hers, with a value in it');
});

test('explicit local-only requests block both routing and final cloud dispatch',()=>{
 for(const content of ['Keep this local: suggest a hat colour.','Keep this conversation on this machine.','Please process my data locally.','Do not send this to the cloud.']){
  assert.equal(conversationMayLeave([{role:'user',content}]).safe,false);
  assert.throws(()=>assertOutboundSafe([{role:'user',content}]),/local_only/);
 }
 assert.equal(conversationMayLeave([{role:'user',content:'Is there a local shop?'}]).safe,true);
 assert.equal(conversationMayLeave([{role:'assistant',content:'Keep this local.'},{role:'user',content:'Hello.'}]).safe,true);
});
