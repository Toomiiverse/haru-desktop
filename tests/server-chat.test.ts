import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendServerChat, serverOrigin, type ServerRequest } from '../electron/server-chat';
import type { Attachment } from '../electron/attachments';

const local: Attachment = { id: 'local', kind: 'document', name: 'Topic 1.pdf', saved: 'C:/Pictures/Haru/topic.pdf', url: '', bytes: 3 };
const remote = { ...local, id: 'server', saved: '/home/haru/Pictures/Haru/topic.pdf' };

test('server credentials only go to a configured HTTPS Tailscale origin', () => {
  assert.equal(serverOrigin(undefined), null);
  assert.equal(serverOrigin('https://haruserver.tail6da04d.ts.net/'), 'https://haruserver.tail6da04d.ts.net');
  for (const url of ['http://haruserver.tail6da04d.ts.net', 'https://example.com', 'https://user:pass@haruserver.tail6da04d.ts.net', 'file:///secret']) assert.throws(() => serverOrigin(url));
});

test('native uploads arrive before chat and only server file references travel with the current request', async () => {
  const calls: string[] = [];
  const request: ServerRequest = async (route, init) => {
    calls.push(route);
    if (route.startsWith('/api/attach?')) {
      assert.deepEqual(Array.from(init!.body as Uint8Array), [1, 2, 3]);
      return Response.json({ attachment: remote });
    }
    assert.deepEqual(JSON.parse(String(init!.body)), { text: 'Help with topic one', attachments: [remote] });
    return Response.json({ reply: 'Here is topic one.' });
  };
  const answer = await sendServerChat(request, 'Help with topic one', [{ attachment: local, bytes: new Uint8Array([1, 2, 3]) }]);
  assert.equal(answer.content, 'Here is topic one.');
  assert.deepEqual(calls, ['/api/attach?name=Topic%201.pdf', '/api/chat']);
});

test('failed uploads never send an empty chat; completed staging is cleaned up', async () => {
  const calls: string[] = [];
  const request: ServerRequest = async (route) => {
    calls.push(route);
    if (calls.length === 1) return Response.json({ attachment: remote });
    if (calls.length === 2) return Response.json({ error: 'Upload failed' }, { status: 500 });
    return Response.json({ ok: true });
  };
  const file = { attachment: local, bytes: new Uint8Array([1]) };
  await assert.rejects(sendServerChat(request, '', [file, file]), /Upload failed/);
  assert.deepEqual(calls, ['/api/attach?name=Topic%201.pdf', '/api/attach?name=Topic%201.pdf', '/api/attach/discard']);
});

test('expired login and uncertain sends never retry or switch to the desktop model', async () => {
  for (const status of [401, 503]) {
    let calls = 0;
    await assert.rejects(sendServerChat(async () => { calls++; return Response.json({}, { status }); }, 'hello', []));
    assert.equal(calls, 1);
  }
});
