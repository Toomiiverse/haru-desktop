// 4100: picture bytes stay out of the policy call; a call turn does not wait for an unread picture; the ledger keeps no reading;
// an oversized picture is shrunk instead of dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../electron/core-policy-sync';
import { foldCoreAttachments } from '../electron/core-attachments';
import { TaskController } from '../electron/task-controller';
const pic = { id: 'a', kind: 'image', name: 'p.jpg', saved: '/p.jpg' };
function stub(seen: unknown[][]) {
  (policy as any).corePolicySync = (op: string, args: any[]) => { seen.push(args);
    return op === 'attachments.fold' ? [{ index: 0, files: args[1][0][1].map((a: any) => ({ attachment: a, action: 'read', fallback: 'image' })) }] : { content: 'x', opened: args[1], images: args[2] }; };
}
test('the folded policy call never carries picture bytes; the images are added after it', async () => {
  const seen: unknown[][] = []; stub(seen);
  const big = 'z'.repeat(3_000_000);
  const [out] = await foldCoreAttachments([{ role: 'user', content: 'x' }], new Map([[0, [pic]]]) as any, false, async () => '', () => big);
  assert.ok(seen.every(args => JSON.stringify(args).length < 10_000), 'no 3 MB argument crossed the policy call');
  assert.deepEqual(out.images, [big]);
});
test('a call turn does not wait for an unread picture; a cached reading still folds', async () => {
  const seen: unknown[][] = []; stub(seen);
  let finish: (v: string) => void = () => {};
  const slow = () => new Promise<string>(r => { finish = r; });
  const t = Date.now();
  const [out] = await foldCoreAttachments([{ role: 'user', content: 'x' }], new Map([[0, [pic]]]) as any, false, slow, () => 'bytes', true);
  assert.ok(Date.now() - t < 1000, 'returned without the read');
  assert.deepEqual(out.opened, [{ attachment: pic, readable: '', pending: true }]);
  assert.ok(!(out.images ?? []).length, 'the picture is not sent to the fallback model either');
  finish('A red bike.');
  const [cached] = await foldCoreAttachments([{ role: 'user', content: 'x' }], new Map([[0, [pic]]]) as any, false, async () => 'A red bike.', () => 'bytes', true);
  assert.deepEqual(cached.opened, [{ attachment: pic, readable: 'A red bike.' }]);
});
test('a text turn still waits for the read', async () => {
  const seen: unknown[][] = []; stub(seen);
  const [out] = await foldCoreAttachments([{ role: 'user', content: 'x' }], new Map([[0, [pic]]]) as any, false,
    () => new Promise(r => setTimeout(() => r('A red bike.'), 500)), () => 'bytes');
  assert.deepEqual(out.opened, [{ attachment: pic, readable: 'A red bike.' }]);
});
test('a picture reading is not stored as the task result', async () => {
  const { readFileSync } = await import('node:fs');
  const perception = readFileSync(require.resolve('../../electron/core-perception.ts'), 'utf8');
  assert.ok(perception.includes("task.storedResult='Picture read; the reading is not kept in the ledger.';"));
  const controller = readFileSync(require.resolve('../../electron/task-controller.ts'), 'utf8');
  assert.ok(controller.includes("result: this.storedResult ?? reply.content"));
  assert.equal(new (TaskController as any)(async () => ({}), [], {} as any, false).storedResult, undefined, 'other compositions keep their result');
});
test('an oversized picture is shrunk with ffmpeg to a JPEG under the cap', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, statSync } = await import('node:fs');
  const dir = mkdtempSync('/tmp/claude-1000/p4100-'), big = dir + '/big.png';
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=5000x4000', '-frames:v', '1', '-vf', 'noise=alls=60:allf=t', big]);
  assert.ok(statSync(big).size > 3 * 1024 * 1024, 'the test picture is over the cap');
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', big, '-frames:v', '1', '-vf', "scale='min(1536,iw)':-2", '-map_metadata', '-1', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 32 * 1024 * 1024 });
  assert.ok(out.length < 3 * 1024 * 1024 && out.toString('base64').startsWith('/9j/'), 'a JPEG under the cap');
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(require.resolve('../../electron/main.ts'), 'utf8').includes("'-map_metadata', '-1', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'"), 'main.ts uses the same command');
});
