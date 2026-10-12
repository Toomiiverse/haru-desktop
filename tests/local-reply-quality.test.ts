import test from 'node:test';
import assert from 'node:assert/strict';
import { localReplyIssue, withReplyCharacter } from '../electron/local-reply-quality';
import { composeLocalReply } from '../electron/local-reply';

const character={identity:'Complete identity '.repeat(60),style:'Complete expressive style '.repeat(45)};
const message=(reply:string,kind='ordinary')=>({role:'assistant',content:JSON.stringify({kind,basis:'Synthetic evidence.',previous_claim:'',correction:'',reply})});

test('character wrapping preserves evidence and gives grounding rules precedence',()=>{
  const input=[{role:'system',content:'Original grounding rules.'},{role:'user',content:'Original evidence and privacy instruction.'}];
  const result=withReplyCharacter(input,character);
  assert.ok(result[0].content!.includes(character.identity));assert.ok(result[0].content!.includes(character.style));
  assert.ok(result[0].content!.indexOf('Original grounding rules.')>result[0].content!.indexOf(character.style));
  assert.deepEqual(result[1],input[1]);assert.equal(input[0].content,'Original grounding rules.');
});

test('known failure checks preserve bounded unknowns, fiction and actual requested wording',()=>{
  assert.ok(localReplyIssue('unknown',"[neutral] You haven't told me about it before.",'What was my first pet?'));
  assert.ok(localReplyIssue('unknown',"[neutral] You never told me. [neutral] I am here.",'What was my first pet?'));
  assert.equal(localReplyIssue('unknown',"[neutral] You haven't mentioned that in this chat.",'What was my first pet?'),undefined);
  assert.equal(localReplyIssue('unknown',"[neutral] I don't have that recorded.",'What was my first pet?'),undefined);
  assert.equal(localReplyIssue('fiction','[neutral] You never told me.','Write a fictional scene.'),undefined);
  assert.ok(localReplyIssue('ordinary','[neutral] Fine.','Keep this local. Say that more gently.'));
  assert.ok(localReplyIssue('ordinary',"[neutral] Got it. I'll keep this local.",'Keep this local. I am tired today.'));
  assert.ok(localReplyIssue('ordinary','[neutral] I hear you. [neutral] Let me know what you need.','I am tired.'));
  assert.equal(localReplyIssue('ordinary','[neutral] Let me know when you arrive.','What would you like me to do?'),undefined);
  assert.equal(localReplyIssue('ordinary','[neutral] Let me know what you need.','Say “Let me know what you need.”'),undefined);
});

test('one local repair retains full persona, mood, privacy and history without including rejected prose',async()=>{
  const latest='Keep this local. Say that more gently.';
  const history=[{role:'user',content:'I made a mistake.'},{role:'assistant',content:'You should have checked.'},{role:'user',content:latest}];
  const evidence={mood:{irritation:40},voice:{requestedNextDelivery:'gentle'},recalled:'Synthetic memory.'};let calls=0;
  const answer=await composeLocalReply(history,latest,evidence,async turns=>{
    calls++;assert.ok(turns[0].content!.includes(character.identity));assert.ok(turns[0].content!.includes(character.style));
    const packet=JSON.parse(turns[1].content!);assert.deepEqual(packet.context,evidence);assert.equal(packet.latest_user,latest);
    assert.equal(packet.transcript.length,history.length);
    if(calls===1)return message('[neutral] Fine.');
    assert.equal(turns.length,3);assert.match(turns[2].content!,/withheld/);assert.doesNotMatch(turns[2].content!,/\[neutral\] Fine/);
    return message('[affectionate] We can take this slowly.');
  },character);
  assert.equal(calls,2);assert.equal(answer.content,'[affectionate] We can take this slowly.');
});

test('format repair is bounded and transport failures never initiate repair',async()=>{
  let calls=0;
  await assert.rejects(composeLocalReply([{role:'user',content:'Hello'}],'Hello',{},async()=>{calls++;return {role:'assistant',content:'invalid'};},character));
  assert.equal(calls,2);calls=0;
  await assert.rejects(composeLocalReply([{role:'user',content:'Hello'}],'Hello',{},async()=>{calls++;throw new Error('connection refused');},character),/Local reply check failed/);
  assert.equal(calls,1);
});

test('legacy composers keep their previous single-attempt behavior',async()=>{
  let calls=0;
  await assert.rejects(composeLocalReply([{role:'user',content:'Hello'}],'Hello',{},async()=>{calls++;return {role:'assistant',content:'invalid'};}));
  assert.equal(calls,1);
});
