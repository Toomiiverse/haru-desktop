import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appPage } from '../electron/webpage';

test('phone refuses a truncated stream and finishes on the done event without waiting for socket EOF', async () => {
  const html = appPage();
  const source = html.slice(html.indexOf('async function readStream('), html.indexOf('// What a message becomes'));
  const sandbox: any = { TextDecoder, stopVoice() {}, cancelBreath() {}, voiceFeed() {} };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const response = (chunks: string[], hanging = false) => ({ body: { getReader: () => ({
    read: async () => chunks.length ? { done: false, value: new TextEncoder().encode(chunks.shift()!) }
      : hanging ? new Promise(() => {}) : { done: true }, cancel: async () => {},
  }) } });
  await assert.rejects(sandbox.readStream(response(['data: {"text":"partial"}\n\n']), () => {}), /interrupted/);
  await assert.rejects(sandbox.readStream(response([]), () => {}), /interrupted/);
  const done = await sandbox.readStream(response([': waiting\n\ndata: {"text":"hi"}\n\ndata: {"done":true,"reply":"hi"}\n\n'], true), () => {});
  assert.equal(done.reply, 'hi');
  const failed = await sandbox.readStream(response(['data: {"error":"failed"}\n\n'], true), () => {});
  assert.equal(failed.error, 'failed');
});

function recovery(receipt: object, status = 200) {
  const html = appPage();
  const source = html.slice(html.indexOf('let activeDelivery=null'), html.indexOf('// One reader for both ways'));
  const kept = new Map<string, any>([['pendingSend', { id: 'pending-request-id', text: 'My message', files: [], at: 0 }]]);
  const elements: Record<string, any> = {
    cb: { disabled: true }, chat: { appendChild(el: any) { elements[el.id] = el; }, insertAdjacentHTML(_where: string, text: string) { output.push(text); } },
  };
  const output: string[] = []; const requests: string[] = []; let aborted = false;
  const sandbox: any = { AbortController, encodeURIComponent, clearTimeout() {}, setTimeout() { return 1; }, setInterval() {},
    window: { haruKeep: { get: (key: string) => kept.get(key), set: (key: string, value: unknown) => kept.set(key, value), drop: (key: string) => kept.delete(key) },
      haruNet: { fetch: async (url: string) => { requests.push(url); return { status, ok: status === 200, json: async () => receipt }; } } },
    document: { hidden: false, createElement: () => ({}) }, $: (id: string) => elements[id],
    ci: { value: '' }, staged: [], drawChips() {}, stopVoice() {}, cancelBreath() {}, load: async () => [], esc: (s: string) => s,
    location: { reload() {} }, activeController: { abort() { aborted = true; } },
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  vm.runInContext("activeDelivery={id:'pending-request-id',settled:false,controller:activeController}", sandbox);
  return { sandbox, kept, elements, output, requests, aborted: () => aborted };
}

test('resuming the phone recovers a finished reply through GET, never another POST', async () => {
  const h = recovery({ state: 'done', reply: 'Recovered answer' });
  await h.sandbox.recoverPending();
  assert.equal(h.aborted(), true);
  assert.equal(h.elements.cb.disabled, false);
  assert.equal(h.kept.has('pendingSend'), false);
  assert.match(h.output.join(''), /Recovered answer/);
  assert.deepEqual(h.requests, ['/api/chat/receipt?id=pending-request-id']);
});

test('a pending receipt keeps send locked; unknown delivery preserves draft without resending', async () => {
  const pending = recovery({ state: 'pending' });
  await pending.sandbox.recoverPending();
  assert.equal(pending.aborted(), false);
  assert.equal(pending.elements.cb.disabled, true);
  assert.equal(pending.kept.has('pendingSend'), true);
  assert.match(pending.elements['delivery-status'].textContent, /received/);
  const unknown = recovery({ state: 'unknown' }, 404);
  await unknown.sandbox.recoverPending();
  assert.equal(unknown.sandbox.ci.value, 'My message');
  assert.equal(unknown.kept.get('draft'), 'My message');
  assert.equal(unknown.kept.has('unconfirmedSend'), true);
  assert.equal(unknown.elements.cb.disabled, false);
  assert.match(unknown.elements['delivery-status'].textContent, /could not be confirmed/);
  assert.equal(unknown.requests.length, 1);
});
