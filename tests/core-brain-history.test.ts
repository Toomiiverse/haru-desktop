import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPhoneTurn} from '../electron/core-brain-history';
test('phone history persists both sides once and preserves attachment/reply context',()=>{
  const turn={text:'read this',reply:'copper',ignored:false,attachments:[{saved:'fixture'}],replyTo:{id:'earlier'}};
  const rows=appendPhoneTurn([],turn,'request','now');
  assert.equal(rows.length,2);assert.deepEqual(rows[0].attachments,turn.attachments);assert.deepEqual(rows[0].replyTo,turn.replyTo);
  assert.deepEqual(appendPhoneTurn(rows,turn,'request','later'),rows);
});
test('ignored and retry turns preserve renderer semantics',()=>{
  const rows=appendPhoneTurn([],{text:'hello',reply:'hey',ignored:false},'first','now');
  const retried=appendPhoneTurn(rows,{text:'hello',reply:'hi',ignored:false,retry:true},'retry','later');
  assert.equal(retried.length,2);assert.equal(retried[1].content,'hi');
  assert.equal(appendPhoneTurn(rows,{text:'hello',reply:'',ignored:true,retry:true},'retry','later').length,1);
  const ignored=appendPhoneTurn([],{text:'hello',reply:'',ignored:true},'first','now');
  assert.equal(ignored.length,1);assert.deepEqual(appendPhoneTurn(ignored,{text:'hello',reply:'',ignored:true},'first','later'),ignored);
});
