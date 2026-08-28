// The door, driven through the door.
//
// These start a real server on a loopback port and talk to it over HTTP,
// because what matters here is not what any one function returns — it is what
// comes back to a phone, and that is decided by the routing, the cookies and
// the order the checks run in. A unit test of whoIsThis would not have caught a
// route added above the sign-in gate.
//
// Three things it is really about. Nothing but the sign-in page and her icon
// answers a stranger. A wrong password is refused the same way whether or not
// the username exists, and repeating it locks the caller out. And the route
// that serves her model out of a folder serves nothing else on the disk,
// however the path is spelled.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer, type WebDeps } from '../electron/webserver';
import { setPassword, type WebAccess } from '../electron/web';
import { readPushPrefs } from '../electron/push';

const USERNAME = 'tom';
const PASSWORD = 'a-long-enough-password';
const SECRET = setPassword(PASSWORD);

function access(overrides: Partial<WebAccess> = {}): WebAccess {
  return { enabled: true, username: USERNAME, salt: SECRET.salt, hash: SECRET.hash, devices: [], ...overrides };
}

function deps(overrides: Partial<WebDeps> = {}): WebDeps {
  let stored = access();
  let whereOn = false, whereAt: string | null = null; const reported: unknown[] = [];
  return {
    readAccess: () => stored,
    saveAccess: (next) => { stored = next; },
    say: async () => ({ reply: 'Fine.' }),
    sayStream: async (_text, onChunk) => { onChunk('Fine.'); return { reply: 'Fine.' }; },
    retryStream: async (onChunk) => { onChunk('Again.'); return { reply: 'Again.' }; },
    rate: async (id) => (id === 'hers' ? { line: 'Finally, some taste.' } : null),
    expression: async () => ({ emotion: null, expression: null }),
    history: () => [],
    agenda: () => [],
    tickOff: () => {},
    memories: () => [],
    journal: () => [],
    writeJournal: () => {},
    checkIns: () => [],
    addCheckIn: () => [],
    nudge: async () => null,
    attach: {
      stage: (name: string, bytes: Buffer) => ({ id: 'staged', kind: 'image', name, saved: 'X:\\pictures\\' + name, url: '', bytes: bytes.length }),
      discard: () => {},
    },
    wake: () => ({ line: 'What.', emotion: 'annoyed' }),
    where: {
      get: () => ({ enabled: whereOn, at: whereAt, fresh: whereAt !== null, net: null, places: whereAt ? [whereAt] : [] }),
      enable(on) { whereOn = on; if (!on) whereAt = null; },
      report(spot) { const s = spot as { lat?: unknown }; if (typeof s.lat !== 'number') return false; reported.push(spot); return true; },
      name(name) { if (!reported.length) return false; whereAt = name; return true; },
      forget() { whereAt = null; },
      lookUp: async () => 'Wembley, Perth, Western Australia',
    },
    push: {
      key: () => 'B'.repeat(87),
      subscribe: () => {},
      unsubscribe: () => {},
      prefs: () => readPushPrefs({}),
      savePrefs: () => {},
      test: async () => true,
    },
    portrait: () => Buffer.from('not really a png'),
    model: () => null,
    emotionsFolder: () => null,
    libFolder: () => null,
    speak: async () => null,
    hear: async () => '',
    knowledge: {
      search: async () => ({ results: [] }),
      stats: () => ({}),
      ingest: async () => ({ queued: false, source: '', sourceType: '', category: '', action: '', chunks: 0 }),
      deleteDocument: async () => ({ deleted: false, removedChunks: 0 }),
      reindex: async () => ({ reindexed: 0 }),
      vault: async () => ({ added: 0, updated: 0, unchanged: 0, removed: 0, files: 0, ms: 0 }),
    },
    ...overrides,
  };
}

/** A server on a free loopback port, plus a fetch that keeps its cookies. */
let doors = 0;
async function door(overrides: Partial<WebDeps> = {}) {
  const running = await startWebServer(0, deps(overrides));
  const base = `http://127.0.0.1:${running.port}`;
  let jar = '';
  // Each harness gets its own address so the failure counter, which is keyed by
  // caller and outlives a single server, cannot leak a lockout between tests.
  // Its own address, never shared: the attempts map is module-wide, and two
  // servers whose ports agreed modulo 250 handed one test the other's lockout.
  const from = `10.${Math.floor(++doors / 250) % 250}.${doors % 250}.7`;
  const call = (path: string, init: RequestInit & { anonymous?: boolean } = {}) => {
    const headers = new Headers(init.headers);
    headers.set('cf-connecting-ip', from);
    // Her own page sends JSON, and every POST past the sign-in insists on it.
    // Left to itself, fetch labels a string body text/plain and the request is
    // refused before it reaches the route under test.
    if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (jar && !init.anonymous) headers.set('cookie', jar);
    return fetch(base + path, { ...init, headers, redirect: 'manual' }).then(response => {
      const set = response.headers.getSetCookie?.() ?? [];
      for (const cookie of set) {
        const pair = cookie.split(';')[0];
        if (pair.endsWith('=')) continue;
        jar = jar ? `${jar}; ${pair}` : pair;
      }
      return response;
    });
  };
  const signIn = (remember = false) =>
    call('/api/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD, remember }) });
  return { call, signIn, from, stop: running.stop };
}

// -- who gets an answer at all ---------------------------------------------------

test('a stranger gets the sign-in page and nothing else', async () => {
  const web = await door();
  try {
    const front = await web.call('/');
    assert.equal(front.status, 200);
    assert.ok((await front.text()).includes('Sign in to reach her'));

    for (const path of ['/api/chat', '/api/agenda', '/api/memory', '/api/journal', '/api/checkins', '/api/knowledge/stats', '/api/model', '/api/push', '/api/attach', '/api/where']) {
      const refused = await web.call(path);
      assert.equal(refused.status, 401, `${path} answered a stranger`);
    }
  } finally { await web.stop(); }
});

test('her model is not served to strangers either', async () => {
  // 28MB of somebody's paid asset, and the sign-in page has no use for it.
  const web = await door();
  try {
    assert.equal((await web.call('/model/anything.json')).status, 401);
    assert.equal((await web.call('/lib/pixi.js')).status, 401);
  } finally { await web.stop(); }
});

test('her face and the manifest are public, because they give nothing away', async () => {
  // A browser reads the manifest before anyone has signed in, to decide whether
  // it can install at all.
  const web = await door();
  try {
    assert.equal((await web.call('/portrait')).status, 200);
    const manifest = await web.call('/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).start_url, '/');
    // The worker too: the browser process fetches it on its own schedule, and
    // does not reliably carry the login cookie when it does.
    assert.equal((await web.call('/sw.js')).status, 200, 'the notification worker must be reachable without a cookie');
  } finally { await web.stop(); }
});

test('switched off, she says so and answers nothing', async () => {
  const web = await door({ readAccess: () => access({ enabled: false }) });
  try {
    for (const path of ['/', '/api/chat', '/portrait']) {
      const response = await web.call(path);
      assert.equal(response.status, 503, `${path} answered while the door was shut`);
    }
  } finally { await web.stop(); }
});

test('a password that was never set is the same as being switched off', async () => {
  const web = await door({ readAccess: () => access({ hash: '' }) });
  try {
    assert.equal((await web.call('/')).status, 503);
  } finally { await web.stop(); }
});

// -- signing in ------------------------------------------------------------------

test('the right password opens the door', async () => {
  const web = await door();
  try {
    assert.equal((await web.signIn()).status, 200);
    const chat = await web.call('/api/chat');
    assert.equal(chat.status, 200);
    assert.ok(Array.isArray((await chat.json()).messages));
    assert.ok((await (await web.call('/')).text()).includes('Say something'), 'the stage, not the sign-in page');
  } finally { await web.stop(); }
});

test('a wrong username and a wrong password are refused identically', async () => {
  // Saying "no such user" tells a stranger which half to keep working on.
  const web = await door();
  try {
    const badUser = await web.call('/api/login', { method: 'POST', body: JSON.stringify({ username: 'nobody', password: PASSWORD }) });
    const badPass = await web.call('/api/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: 'wrong' }) });
    assert.equal(badUser.status, 401);
    assert.equal(badPass.status, 401);
    assert.deepEqual(await badUser.json(), await badPass.json(), 'the two answers differ, which is the hint');
  } finally { await web.stop(); }
});

test('a refused sign-in leaves the door shut', async () => {
  const web = await door();
  try {
    await web.call('/api/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: 'wrong' }) });
    assert.equal((await web.call('/api/chat')).status, 401);
  } finally { await web.stop(); }
});

test('guessing repeatedly locks the caller out', async () => {
  const web = await door();
  try {
    const guess = () => web.call('/api/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: 'wrong' }) });
    let locked = null;
    for (let tries = 0; tries < 6 && !locked; tries += 1) {
      const response = await guess();
      if (response.status === 429) locked = response;
    }
    assert.ok(locked, 'it never stopped letting them guess');
    assert.match((await locked.json()).error, /Too many tries/);
    // And the lockout is not talked past by getting it right.
    const right = await web.signIn();
    assert.equal(right.status, 429, 'the correct password walked straight through the lockout');
  } finally { await web.stop(); }
});

test('the session cookie cannot be read by script, sent cross-site, or sent in the clear', async () => {
  const web = await door();
  try {
    const response = await web.signIn();
    const cookies = response.headers.getSetCookie?.() ?? [];
    assert.equal(cookies.length, 1, 'expected exactly one cookie');
    const [cookie] = cookies;
    assert.ok(cookie.includes('HttpOnly'), 'a script on the page can read it');
    assert.ok(cookie.includes('Secure'), 'it would go out over plain http');
    assert.ok(cookie.includes('SameSite=Strict'), 'another site could post on her behalf');
    assert.ok(cookie.startsWith('haru_session='), 'a session login should not be remembered');
  } finally { await web.stop(); }
});

test('"remember this device" writes a device down instead', async () => {
  const written: WebAccess[] = [];
  const web = await door({ saveAccess: (next) => { written.push(next); } });
  try {
    const response = await web.signIn(true);
    const [cookie] = response.headers.getSetCookie?.() ?? [];
    assert.ok(cookie.startsWith('haru_device='), 'a remembered login should outlive the session');
    const saved = written.at(-1);
    assert.equal(saved?.devices.length, 1, 'the device was not written down');
    assert.ok(!('token' in (saved?.devices[0] ?? {})), 'the raw token must not be stored beside the hash of it');
  } finally { await web.stop(); }
});

test('signing out shuts the door again', async () => {
  const web = await door();
  try {
    await web.signIn();
    assert.equal((await web.call('/api/chat')).status, 200);
    assert.equal((await web.call('/api/logout', { method: 'POST' })).status, 200);
    assert.equal((await web.call('/api/chat', { anonymous: true })).status, 401);
  } finally { await web.stop(); }
});

// -- serving her model, and nothing else -------------------------------------------

test('the model route serves the model and refuses the rest of the disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'haru-model-'));
  const secret = mkdtempSync(join(tmpdir(), 'haru-secret-'));
  try {
    mkdirSync(join(root, 'textures'), { recursive: true });
    writeFileSync(join(root, 'haru.model3.json'), JSON.stringify({ FileReferences: {} }));
    writeFileSync(join(root, 'textures', 'skin.png'), 'not really a png');
    writeFileSync(join(root, 'notes.txt'), 'not part of a model');
    writeFileSync(join(secret, 'secrets.json'), '{"password":"hunter2"}');
    // One level above the model folder, with an extension the route does serve.
    writeFileSync(join(root, '..', 'owner-secrets.json'), '{"password":"hunter2"}');

    const web = await door({ model: () => ({ root, entry: join(root, 'haru.model3.json') }) });
    try {
      await web.signIn();
      assert.equal((await web.call('/model/textures/skin.png')).status, 200, 'a real texture should be served');

      // Every spelling of "somewhere else". The resolve-then-contain check is
      // what has to catch these; none of them look wrong until the file arrives.
      const escapes = [
        '/model/../../etc/passwd',
        '/model/..%2f..%2fetc%2fpasswd',
        '/model/..%252f..%252fetc%252fpasswd',
        '/model/....//....//etc/passwd',
        '/model/..\\..\\windows\\win.ini',
        `/model/${encodeURIComponent(join(secret, 'secrets.json'))}`,
        '/model/%00../secrets.json',
      ];
      for (const path of escapes) {
        const response = await web.call(path);
        assert.equal(response.status, 404, `${path} was not refused`);
      }

      // Inside the folder but not part of a model: no by default, not by accident.
      assert.equal((await web.call('/model/notes.txt')).status, 404, 'a .txt is not a model file');

      // The one that actually reaches the containment check. The escapes above
      // all name a file the type allowlist would refuse anyway, so they prove
      // less than they look: a .ini is turned away for being a .ini, whether or
      // not it was ever going to be found outside the folder. This one climbs
      // one level to a file with an allowed extension that really is there, so
      // the only things standing between it and the phone are the backslash
      // rewrite and the check that the result is still under the root.
      for (const escape of ['/model/..%2Fowner-secrets.json', '/model/..%5Cowner-secrets.json', '/model/../owner-secrets.json']) {
        const response = await web.call(escape);
        assert.equal(response.status, 404, `${escape} climbed out of the model folder`);
      }
    } finally { await web.stop(); }
  } finally {
    rmSync(join(root, '..', 'owner-secrets.json'), { force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(secret, { recursive: true, force: true });
  }
});

test('with no model configured there is nothing to walk out of', async () => {
  const web = await door();
  try {
    await web.signIn();
    assert.equal((await web.call('/model/anything.json')).status, 404);
  } finally { await web.stop(); }
});

// -- files that ride a message -------------------------------------------------------

test('a file is staged under its own name and the record comes back', async () => {
  const staged: { name: string; bytes: number }[] = [];
  const web = await door({
    attach: {
      stage: (name, bytes) => { staged.push({ name, bytes: bytes.length }); return { id: 'a1', name }; },
      discard: () => {},
    },
  });
  try {
    await web.signIn();
    const ok = await web.call('/api/attach?name=cat.png', { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'not really a png' });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()).attachment as { id: string }).id, 'a1');
    assert.deepEqual(staged, [{ name: 'cat.png', bytes: 16 }]);

    assert.equal((await web.call('/api/attach', { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' })).status, 400, 'a nameless file was staged');
    assert.equal((await web.call('/api/attach?name=e.png', { method: 'POST', headers: { 'content-type': 'image/png' }, body: '' })).status, 400, 'an empty file was staged');
  } finally { await web.stop(); }
});

test('attachments ride the message into say, capped rather than unbounded', async () => {
  let got: unknown[] | undefined;
  const web = await door({ say: async (_text, attachments) => { got = attachments; return { reply: 'Fine.' }; } });
  try {
    await web.signIn();
    const files = Array.from({ length: 9 }, (_, i) => ({ id: 'f' + i }));
    assert.equal((await web.call('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'look', attachments: files }) })).status, 200);
    assert.equal(got?.length, 6, 'more files than a message can carry were passed through');
    // A file with nothing typed is still a message; nothing at all is not.
    assert.equal((await web.call('/api/chat', { method: 'POST', body: JSON.stringify({ attachments: [{ id: 'f' }] }) })).status, 200);
    assert.equal((await web.call('/api/chat', { method: 'POST', body: JSON.stringify({}) })).status, 400);
  } finally { await web.stop(); }
});

// -- being told about her ------------------------------------------------------------

test('a subscription is held to the shape a push service actually hands out', async () => {
  // The endpoint is a URL the server will later POST to, so this is the one
  // place a signed-in phone could point her at somewhere arbitrary.
  const taken: { endpoint: string; name: string }[] = [];
  const web = await door({
    push: {
      key: () => 'k', unsubscribe: () => {}, prefs: () => readPushPrefs({}), savePrefs: () => {}, test: async () => true,
      subscribe: (device, name) => { taken.push({ endpoint: device.endpoint, name }); },
    },
  });
  try {
    await web.signIn();
    const p256dh = Buffer.alloc(65, 4).toString('base64url');
    const auth = Buffer.alloc(16, 9).toString('base64url');
    const subscribe = (body: object) => web.call('/api/push/subscribe', { method: 'POST', body: JSON.stringify(body) });

    assert.equal((await subscribe({ endpoint: 'http://push.example/a', p256dh, auth })).status, 400, 'a plaintext endpoint was accepted');
    assert.equal((await subscribe({ endpoint: 'https://push.example/a', p256dh: 'short', auth })).status, 400, 'a wrong-sized key was accepted');
    assert.equal((await subscribe({ endpoint: 'https://push.example/a', p256dh, auth: 'short' })).status, 400, 'a wrong-sized secret was accepted');
    assert.equal(taken.length, 0, 'a refused subscription was stored anyway');

    assert.equal((await subscribe({ endpoint: 'https://push.example/a', p256dh, auth })).status, 200);
    assert.equal(taken.length, 1);
  } finally { await web.stop(); }
});

test('the worker and the public key are served to a signed-in phone, and preferences read back sane', async () => {
  let prefs = readPushPrefs({});
  const web = await door({
    push: {
      key: () => 'k', subscribe: () => {}, unsubscribe: () => {},
      prefs: () => prefs, savePrefs: (next) => { prefs = next; },
      test: async () => true,
    },
  });
  try {
    await web.signIn();
    const worker = await web.call('/sw.js');
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get('content-type') ?? '', /javascript/);
    assert.ok((await worker.text()).includes('showNotification'), 'the worker does not show notifications');

    const info = await (await web.call('/api/push')).json();
    assert.ok(info.key, 'no public key for the page to subscribe with');
    assert.equal(info.prefs.quietFrom, '23:00');

    // Junk fields come back as the defaults, not as junk — and a real change sticks.
    const saved = await (await web.call('/api/push/prefs', { method: 'POST', body: JSON.stringify({ random: 'yes', events: false, quietFrom: '99:99' }) })).json();
    assert.equal(saved.prefs.random, true, 'a string was taken for a flag');
    assert.equal(saved.prefs.quietFrom, '23:00', 'a nonsense time was stored');
    assert.equal(saved.prefs.events, false, 'a real preference did not stick');

    // And the proof button reports what the send path said.
    const tried = await (await web.call('/api/push/test', { method: 'POST', body: '{}' })).json();
    assert.equal(tried.delivered, true);
  } finally { await web.stop(); }
});

// -- what she sends back -------------------------------------------------------------

test('the pages go out under a policy that names no host', async () => {
  const web = await door();
  try {
    const policy = (await web.call('/')).headers.get('content-security-policy') ?? '';
    assert.ok(policy.includes("default-src 'none'"), 'the default is not to refuse');
    assert.ok(policy.includes("connect-src 'self'"));
    assert.ok(policy.includes("form-action 'none'"));
    assert.ok(policy.includes("frame-ancestors 'none'"), 'it could be framed by another site');
    assert.ok(!/https?:\/\//.test(policy), `the policy names a host: ${policy}`);
  } finally { await web.stop(); }
});

test('nothing is sniffed, referred or cached', async () => {
  const web = await door();
  try {
    const headers = (await web.call('/')).headers;
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('referrer-policy'), 'no-referrer');
    assert.equal(headers.get('cache-control'), 'no-store');
  } finally { await web.stop(); }
});

test('a post that a form could have sent is refused before it reaches anything', async () => {
  // The cheapest defence against another site posting on her behalf: a browser
  // will not let a cross-site form set this content type, so requiring it means
  // only her own page can reach anything that changes or reveals something.
  const web = await door();
  try {
    await web.signIn();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const response = await web.call('/api/chat', {
        method: 'POST',
        headers: { 'content-type': type },
        body: JSON.stringify({ text: 'hello' }),
      });
      assert.equal(response.status, 415, `a ${type} post got through`);
    }
    // And the same request from her own page does reach it.
    assert.equal((await web.call('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'hello' }) })).status, 200);
  } finally { await web.stop(); }
});

test('a body too big to be a message is refused rather than swallowed', async () => {
  const web = await door();
  try {
    await web.signIn();
    const response = await web.call('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(300 * 1024) }) });
    assert.ok(response.status >= 400, 'a quarter-megabyte message was accepted');
  } finally { await web.stop(); }
});

test('a body that is not json is refused, and says nothing about why', async () => {
  // It comes back 500 rather than 400: readBody throws and no route catches it,
  // so the top-level handler answers. Imprecise — this is the caller's mistake,
  // not hers — but safe, which is the part worth pinning: one flat sentence, no
  // parser message, no stack, and the door still standing afterwards.
  const web = await door();
  try {
    await web.signIn();
    const response = await web.call('/api/chat', { method: 'POST', body: 'not json at all' });
    assert.ok(response.status >= 400, 'malformed json was accepted');
    const body = await response.text();
    assert.ok(!body.includes('at '), 'a stack trace reached the phone');
    assert.ok(!/JSON|token|position/i.test(body), `the parser error reached the phone: ${body}`);
    assert.equal((await web.call('/api/agenda')).status, 200, 'the door fell over');
  } finally { await web.stop(); }
});

test('an unknown route is a plain 404, not a stack trace', async () => {
  const web = await door();
  try {
    await web.signIn();
    const response = await web.call('/api/there-is-no-such-thing');
    assert.equal(response.status, 404);
    const body = await response.text();
    assert.ok(!body.includes('at '), 'a stack trace reached the phone');
  } finally { await web.stop(); }
});

test('her last reply can be asked for again, and only by someone signed in', async () => {
  const web = await door();
  try {
    assert.equal((await web.call('/api/chat/retry', { method: 'POST', body: '{}', anonymous: true })).status, 401);
    await web.signIn();
    const again = await web.call('/api/chat/retry', { method: 'POST', body: '{}' });
    assert.equal(again.status, 200);
    assert.match(again.headers.get('content-type') ?? '', /text\/event-stream/);
    const body = await again.text();
    assert.ok(body.includes('data: {"text":"Again."}'), body);
    assert.ok(body.includes('data: {"done":true,"reply":"Again.","ignored":false}'), body);
  } finally { await web.stop(); }
});

test('nothing of hers to do again is said as much, not as a crash', async () => {
  const web = await door({ retryStream: async () => null });
  try {
    await web.signIn();
    const again = await web.call('/api/chat/retry', { method: 'POST', body: '{}' });
    assert.equal(again.status, 200);
    assert.ok((await again.text()).includes('"error":"There is nothing of hers to do again."'));
  } finally { await web.stop(); }
});

test('a reply of hers can be rated, and the page gets her comeback', async () => {
  const web = await door();
  try {
    assert.equal((await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ id: 'hers', reaction: 'up' }), anonymous: true })).status, 401);
    await web.signIn();
    const rated = await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ id: 'hers', reaction: 'up' }) });
    assert.equal(rated.status, 200);
    assert.deepEqual(await rated.json(), { ok: true, line: 'Finally, some taste.' });
    assert.equal((await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ id: 'hers', note: 'too nice' }) })).status, 200);
    assert.equal((await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ id: 'theirs', reaction: 'down' }) })).status, 404);
    assert.equal((await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ reaction: 'down' }) })).status, 400);
    assert.equal((await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ id: 'hers' }) })).status, 400);
    assert.equal((await web.call('/api/chat/rate', { method: 'POST', body: JSON.stringify({ id: 'hers', reaction: 'meh' }) })).status, 400);
  } finally { await web.stop(); }
});

test('her faces are served from her own folder, by name only, and only to someone signed in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'haru-faces-'));
  writeFileSync(join(dir, 'happy.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
  writeFileSync(join(dir, 'secret.svg'), '<svg/>');
  const web = await door({ emotionsFolder: () => dir });
  try {
    assert.equal((await web.call('/emotions/happy.svg', { anonymous: true })).status, 401);
    await web.signIn();
    const face = await web.call('/emotions/happy.svg');
    assert.equal(face.status, 200);
    assert.match(face.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.equal((await web.call('/emotions/secret.svg')).status, 404, 'a file that is not a face is not served, even from the folder');
    assert.equal((await web.call('/emotions/sad.svg')).status, 404, 'a face without a file is a 404, not a crash');
    assert.equal((await web.call('/emotions/..%2Fportrait')).status, 404);
  } finally { await web.stop(); rmSync(dir, { recursive: true, force: true }); }
});

// -- where the phone is ------------------------------------------------------------

test('a fix is refused while sharing is off, taken once it is on, and a name needs a fix to stand on', async () => {
  const web = await door();
  try {
    await web.signIn();
    const off = await web.call('/api/where');
    assert.deepEqual(await off.json(), { enabled: false, at: null, fresh: false, net: null, places: [] });

    const refused = await web.call('/api/where', { method: 'POST', body: JSON.stringify({ lat: -31.95, lon: 115.86, accuracy: 40 }) });
    assert.equal(refused.status, 409);
    const early = await web.call('/api/where/name', { method: 'POST', body: JSON.stringify({ name: 'home' }) });
    assert.equal(early.status, 409, 'nothing to name yet');

    const on = await web.call('/api/where/prefs', { method: 'POST', body: JSON.stringify({ enabled: true }) });
    assert.equal((await on.json()).enabled, true);
    const junk = await web.call('/api/where', { method: 'POST', body: JSON.stringify({ lat: 'here' }) });
    assert.equal(junk.status, 400);
    const taken = await web.call('/api/where', { method: 'POST', body: JSON.stringify({ lat: -31.95, lon: 115.86, accuracy: 40, net: 'wifi' }) });
    assert.equal(taken.status, 200);

    const unnamed = await web.call('/api/where/name', { method: 'POST', body: JSON.stringify({ name: '   ' }) });
    assert.equal(unnamed.status, 400);
    const named = await web.call('/api/where/name', { method: 'POST', body: JSON.stringify({ name: 'home' }) });
    assert.equal((await named.json()).at, 'home');
    const looked = await web.call('/api/where/lookup', { method: 'POST', body: '{}' });
    assert.equal((await looked.json()).name, 'Wembley, Perth, Western Australia');

    const forgot = await web.call('/api/where/forget', { method: 'POST', body: JSON.stringify({ name: 'home' }) });
    assert.equal((await forgot.json()).at, null);
    const back = await web.call('/api/where/prefs', { method: 'POST', body: JSON.stringify({ enabled: false }) });
    assert.equal((await back.json()).enabled, false);
  } finally { await web.stop(); }
});

test('the where routes, like the rest, are for the signed-in only', async () => {
  const web = await door();
  try {
    for (const path of ['/api/where', '/api/where/prefs', '/api/where/name', '/api/where/lookup']) {
      const refused = await web.call(path, { method: 'POST', body: '{}' });
      assert.equal(refused.status, 401, path);
    }
  } finally { await web.stop(); }
});

// -- her ears kept open --------------------------------------------------------

test('her name alone gets a word back; a line is spoken in its mood; a message said over her says so', async () => {
  const spoken: { text: string; emotion?: string | null }[] = [];
  const asides: unknown[] = [];
  const web = await door({
    speak: async (text, emotion) => { spoken.push({ text, emotion }); return { audio: new Uint8Array([1, 2, 3]), mime: 'audio/wav' }; },
    sayStream: async (_text, onChunk, _files, options) => { asides.push(options); onChunk('What.'); return { reply: 'What.' }; },
  });
  try {
    await web.signIn();
    const woke = await web.call('/api/wake', { method: 'POST', body: '{}' });
    assert.deepEqual(await woke.json(), { line: 'What.', emotion: 'annoyed' });

    const clip = await web.call('/api/speak', { method: 'POST', body: JSON.stringify({ text: 'Fine.', emotion: 'smug' }) });
    assert.equal(clip.status, 200);
    assert.deepEqual(spoken, [{ text: 'Fine.', emotion: 'smug' }]);

    const cut = await web.call('/api/chat/stream', { method: 'POST', body: JSON.stringify({ text: 'wait', interrupted: true }) });
    assert.equal(cut.status, 200); await cut.text();
    const plain = await web.call('/api/chat/stream', { method: 'POST', body: JSON.stringify({ text: 'go on', interrupted: 'yes' }) });
    await plain.text();
    assert.deepEqual(asides, [{ interrupted: true }, { interrupted: false }]);
  } finally { await web.stop(); }
});
