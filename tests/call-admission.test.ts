import test from 'node:test';
import assert from 'node:assert/strict';
import {addressedText,callInputCommand,callMicCheckReply} from '../electron/call-admission';
import {readCallConfig} from '../electron/call';
test('addressing requires the name at the start with a word boundary',()=>{
 assert.equal(addressedText('Haru, how are you?'),'how are you?');
 assert.equal(addressedText('Hey, Haru. Tell me something.'),'Tell me something.');
 for(const line of ['A video about Haru','Haruki says hello','What happened?'])assert.equal(addressedText(line),null);
 assert.equal(addressedText('Haru'), '');
});
test('mode switches are exact addressed controls, not arbitrary conversation',()=>{
 assert.equal(callInputCommand('Haru, noisy room mode.'),'addressed');
 assert.equal(callInputCommand('Haru, hands-free mode!'),'open');
 assert.equal(callInputCommand('noisy room mode'),null);
 assert.equal(callInputCommand('Haru, explain noisy room mode'),null);
 assert.equal(readCallConfig({inputMode:'addressed'}).inputMode,'addressed');
 assert.equal(readCallConfig({inputMode:'invalid'}).inputMode,undefined);
});

test('standalone microphone checks acknowledge only receipt',()=>{
 for(const text of ['Mic check.', 'Haru, can you hear me?', 'Can you hear my voice now?',
  'Is my microphone working?', 'Testing, one, two, three. Test, test, test.',
  'Hey Haru, testing 1 2 3!', 'This is a microphone test.']) {
  assert.equal(callMicCheckReply(text),'Your words came through.',text);
 }
});

test('diagnostic words never hide tools, memory, quotes or unfinished requests',()=>{
 for(const text of ['Can you hear me and read my notes?', 'Mic check, remind me tomorrow.',
  'Testing the deployment.', 'Testing one two three and', 'Testing one two three, what next?',
  'What did I say?', 'Can you hear me clearly?', 'Why is my microphone not working?',
  'Say "mic check"', 'Mic check; delete my notes', 'Testing\nread my notes',
  'one two three', 'How are you?', 'testing '.repeat(30)])assert.equal(callMicCheckReply(text),null,text);
});
