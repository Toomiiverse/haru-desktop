import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderAsk} from '../electron/remindme';
import {recallRequest} from '../electron/request-kind';
import {taskIntent} from '../electron/task-router';
import {evidenceProblem} from '../electron/evidence-check';
test('recall does not demand a fabricated reminder creation receipt',()=>{
 for(const request of ['Remind me of the fictional Lantern project mascot and budget.','Remind me what colour I chose.','Please remind me which number you read.']){
  assert.equal(reminderAsk(request,new Date('2026-10-01T09:00:00Z')),null);
  assert.equal(recallRequest(request),true);assert.equal(taskIntent(request).role,'conversation');
  assert.equal(evidenceProblem('The mascot is a moth and the budget is 23 tokens.',[],Date.now(),request),null);
 }
});
test('actual reminders and timed recall continue to require successful action receipts',()=>{
 for(const request of ['Remind me to stretch.','Remind me of the meeting tomorrow.','Remind me of the badge at noon.','Remind me of the budget in 20 minutes.']){
  assert.equal(recallRequest(request),false);assert.equal(taskIntent(request).role,'everyday');
  assert.match(evidenceProblem('Done, I will remind you.',[],Date.now(),request)!,/reminder|receipt/i);
 }
});
