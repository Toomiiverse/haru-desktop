import test from 'node:test';
import assert from 'node:assert/strict';
import {HarnessMedia} from '../electron/core-harness-media';

test('large image bytes round-trip without entering the control frame or changing caller messages',()=>{
 const media=new HarnessMedia(),bytes='A'.repeat(2*1024*1024),messages=[{role:'user',content:'A disposable image.',images:[bytes]}];
 const encoded=media.toCore(messages);
 assert.ok(JSON.stringify(encoded).length<200);assert.notEqual(encoded[0].images![0],bytes);
 assert.deepEqual(media.fromCore(encoded),messages);assert.equal(messages[0].images[0],bytes);
});
test('identical image references stay stable across rounds, and sessions are distinct',()=>{
 const messages=[{role:'user',images:['fixture-bytes','fixture-bytes']}];
 const media=new HarnessMedia(),first=media.toCore(messages);
 assert.equal(first[0].images![0],first[0].images![1]);assert.deepEqual(media.toCore(messages),first);
 assert.notEqual(new HarnessMedia().toCore(messages)[0].images![0],first[0].images![0]);
});
test('a foreign reference cannot acquire image bytes from another session',()=>{
 const first=new HarnessMedia(),second=new HarnessMedia();
 const encoded=first.toCore([{role:'user',images:['fixture-image']}]);
 assert.throws(()=>second.fromCore(encoded),/core_harness_media_unbound/);
 assert.throws(()=>first.fromCore([{role:'user',images:['file:\/\/etc/passwd']}]),/core_harness_media_unbound/);
});
test('text-only and tool-history messages preserve their transport shape',()=>{
 const messages=[{role:'user',content:'Read the note.'},{role:'tool',tool_name:'vault_read',content:'fixture receipt'}];
 const media=new HarnessMedia();assert.deepEqual(media.fromCore(media.toCore(messages)),messages);
});
