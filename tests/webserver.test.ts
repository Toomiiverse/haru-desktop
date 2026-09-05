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
import WebSocket from 'ws';
import { startWebServer, type WebDeps } from '../electron/webserver';
import { standingFrom } from '../electron/standing';
import { DEFAULT_VITALS } from '../electron/vitals';
import { setPassword, type WebAccess } from '../electron/web';
import { readPushPrefs } from '../electron/push';
import { mergeMemories } from '../electron/memorysync';
import { mergeActivity, type ActivityLog } from '../electron/activitylog';
import { heldShots, keepShot } from '../electron/shotstore';
import type { MemoryRecord } from '../electron/memory';

const USERNAME = 'tom';
const PASSWORD = 'a-long-enough-password';
const SECRET = setPassword(PASSWORD);

function access(overrides: Partial<WebAccess> = {}): WebAccess {
  return { enabled: true, username: USERNAME, salt: SECRET.salt, hash: SECRET.hash, devices: [], ...overrides };
}

/** The desk's copy, as the server would hold it. Module scope so a test can
 *  post to the route and then read the same store back through it. */
let syncedMemories: MemoryRecord[] = [];
let pushedActivity: ActivityLog = {};
let shotRoot = '';

function deps(overrides: Partial<WebDeps> = {}): WebDeps {
  let stored = access();
  let whereOn = false, whereAt: string | null = null; const reported: unknown[] = [];
  let bodyOn = false;
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
    diary: () => [{ day: '2026-08-29', title: 'Tommy was a pain.', text: 'Tommy was a pain. I read about Elden Ring instead.' }],
    her: () => ({ things: [], adventures: [], likes: [], wants: [], diary: { entries: 0 }, nightsOut: { count: 0 } }),
    standing: () => standingFrom({
      vitals: DEFAULT_VITALS, irritation: 0, ego: 0, grudge: 0, ignoredToday: 0,
      daysTalked: 0, kept: [], weekday: new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }), now: Date.parse('2026-08-29T12:00:00.000Z'), today: '2026-08-29',
    }),
    memoryRecords: () => syncedMemories,
    activityLog: () => pushedActivity,
    shots: {
      held: () => heldShots(shotRoot),
      keep: (day, name, bytes) => { keepShot(shotRoot, day, name, bytes); },
    },
    mergeActivity: (theirs) => {
      pushedActivity = mergeActivity(pushedActivity, theirs);
      return {
        days: Object.keys(pushedActivity).length,
        entries: Object.values(pushedActivity).reduce((total, list) => total + list.length, 0),
      };
    },
    mergeMemories: (theirs) => {
      const merged = mergeMemories(syncedMemories, theirs, '2026-08-29T12:00:00.000Z');
      syncedMemories = merged.memories;
      return { added: merged.added, updated: merged.updated };
    },
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
    sigh: async () => null,
    google: { status: () => ({ connected: false }), connect: async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', port: 8790 }) },
    revoice: { run: async () => ({ shown: 0, rewritten: 0, kept: 0, dropped: 0, model: 'test' }), status: () => ({ lastAt: null, kept: 0, since: 0, every: 500, model: 'test' }) },
    where: {
      get: () => ({ enabled: whereOn, at: whereAt, fresh: whereAt !== null, net: null, places: whereAt ? [whereAt] : [] }),
      enable(on) { whereOn = on; if (!on) whereAt = null; },
      report(spot) { const s = spot as { lat?: unknown }; if (typeof s.lat !== 'number') return false; reported.push(spot); return true; },
      name(name) { if (!reported.length) return false; whereAt = name; return true; },
      forget() { whereAt = null; },
      lookUp: async () => 'Wembley, Perth, Western Australia',
    },
    body: {
      get: () => ({ enabled: bodyOn, at: null, fresh: false, day: null, sleepMinutes: null, steps: null }),
      enable(on) { bodyOn = on; },
      report(report) { const r = report as { day?: unknown }; return typeof r.day === 'string'; },
    },
push: {
      subscribeApns: () => {}, unsubscribeApns: () => {}, apnsReady: () => false,
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
  return { call, signIn, from, stop: running.stop, port: running.port, cookie: () => jar };
}

// -- who gets an answer at all ---------------------------------------------------

test('a stranger gets the sign-in page and nothing else', async () => {
  const web = await door();
  try {
    const front = await web.call('/');
    assert.equal(front.status, 200);
    assert.ok((await front.text()).includes('Sign in to reach her'));

    for (const path of ['/api/chat', '/api/agenda', '/api/status', '/api/diary', '/api/her', '/api/memory', '/api/memory/records', '/api/activity', '/api/activity/shots', '/api/journal', '/api/checkins', '/api/knowledge/stats', '/api/model', '/api/push', '/api/attach', '/api/where', '/api/evi/status']) {
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
      subscribeApns: () => {}, unsubscribeApns: () => {}, apnsReady: () => false,
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
      subscribeApns: () => {}, unsubscribeApns: () => {}, apnsReady: () => false,
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

test('the day handed to the page carries what she said on her own, marked as such', async () => {
  const web = await door({ history: () => [
    { id: 'u1', role: 'user', content: 'hi', at: '2026-08-29T01:00:00.000Z' },
    { id: 'a1', role: 'assistant', content: 'What.', at: '2026-08-29T01:00:05.000Z' },
    { id: 's1', role: 'assistant', content: 'You forgot the bins.', at: '2026-08-29T02:00:00.000Z', aside: 'reminder' },
  ] });
  try {
    await web.signIn();
    const { messages } = await (await web.call('/api/chat')).json() as { messages: { id: string; aside?: string }[] };
    assert.deepEqual(messages.map(m => m.id), ['u1', 'a1', 's1']);
    assert.equal(messages[2].aside, 'reminder');
    assert.equal(messages[1].aside, undefined);
  } finally { await web.stop(); }
});

// -- the other half of her -------------------------------------------------------

test('the desk trades memories with the server, and is not trusted while it does', async () => {
  syncedMemories = [];
  const web = await door();
  try {
    assert.equal((await web.signIn()).status, 200);

    const sent = await web.call('/api/memory/records', {
      method: 'POST',
      body: JSON.stringify({ memories: [{ id: 'a', text: 'likes tea', kind: 'fact', mentions: 2 }] }),
    });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).added, 1);

    const back = await web.call('/api/memory/records');
    assert.equal(back.status, 200);
    assert.deepEqual((await back.json()).memories.map((memory: { text: string }) => memory.text), ['likes tea']);

    // Whatever arrives is a claim, not a record. A shape that is not a list is
    // refused outright, and rubbish inside a list is dropped rather than stored.
    for (const body of [{ memories: 'all of them' }, { memories: { id: 'a' } }, {}]) {
      const refused = await web.call('/api/memory/records', { method: 'POST', body: JSON.stringify(body) });
      assert.equal(refused.status, 400, `took ${JSON.stringify(body)}`);
    }
    const junk = await web.call('/api/memory/records', {
      method: 'POST',
      body: JSON.stringify({ memories: [null, 7, { text: '  ' }, { id: 'a', text: 'likes tea', mentions: 2 }] }),
    });
    assert.equal(junk.status, 200);
    assert.equal((await junk.json()).memories.length, 1, 'only the real one survived');
  } finally { await web.stop(); }
});

test('the desk pushes its day, and a log of the wrong shape is refused', async () => {
  pushedActivity = {};
  const web = await door();
  try {
    assert.equal((await web.signIn()).status, 200);

    const day = { '2026-08-29': [{ at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:40:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'poster' }] };
    const sent = await web.call('/api/activity', { method: 'POST', body: JSON.stringify({ activity: day }) });
    assert.equal(sent.status, 200);
    assert.deepEqual(await sent.json(), { days: 1, entries: 1 });

    const back = await web.call('/api/activity');
    assert.equal(back.status, 200);
    assert.equal((await back.json()).activity['2026-08-29'][0].label, 'Figma');

    // A day-keyed object or nothing: a list and a string are both refused
    // outright rather than normalised into an empty log and quietly accepted.
    for (const activity of ['a log', ['a log'], 7, null]) {
      const refused = await web.call('/api/activity', { method: 'POST', body: JSON.stringify({ activity }) });
      assert.equal(refused.status, 400, `took ${JSON.stringify(activity)}`);
    }
  } finally { await web.stop(); }
});

test('a screenshot is taken from the desk, and a climbing name is refused at the door', async () => {
  shotRoot = mkdtempSync(join(tmpdir(), 'haru-web-shots-'));
  const web = await door();
  try {
    assert.equal((await web.signIn()).status, 200);
    assert.deepEqual((await (await web.call('/api/activity/shots')).json()).shots, {});

    const sent = await web.call('/api/activity/shots?day=2026-08-29&name=shot.png', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('some bytes'),
    });
    assert.equal(sent.status, 200);
    assert.deepEqual((await (await web.call('/api/activity/shots')).json()).shots, { '2026-08-29': ['shot.png'] });

    // The name and the day are the caller's claim and nothing more. Each of
    // these is refused outright; none of them writes anything anywhere.
    for (const query of [
      '?day=2026-08-29&name=../escape.png',
      '?day=../..&name=shot.png',
      '?day=2026-08-29&name=shot.exe',
      '?day=nope&name=shot.png',
      '?name=shot.png',
      '?day=2026-08-29',
    ]) {
      const refused = await web.call('/api/activity/shots' + query, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Buffer.from('some bytes'),
      });
      assert.equal(refused.status, 400, `took ${query}`);
    }
    assert.deepEqual((await (await web.call('/api/activity/shots')).json()).shots, { '2026-08-29': ['shot.png'] });
  } finally { await web.stop(); }
});

test('the status tab is served her live standing, signed in', async () => {
  const web = await door();
  try {
    await web.signIn();
    const got = await web.call('/api/status');
    assert.equal(got.status, 200);
    const screen = await got.json() as { emotion: string; face: string; bond: { value: number; title: string }; meters: { key: string; value: number }[]; patience: { value: number } };
    // Enough of the shape that the page can render without guarding every field.
    assert.equal(typeof screen.emotion, 'string');
    assert.equal(typeof screen.face, 'string');
    assert.equal(typeof screen.bond.title, 'string');
    assert.ok(screen.meters.length >= 5);
    assert.ok(screen.meters.every(meter => meter.value >= 0 && meter.value <= 100));
    assert.equal(screen.patience.value, 100);
  } finally { await web.stop(); }
});

test('her diary is served to the phone, newest first, behind the door', async () => {
  const web = await door();
  try {
    await web.signIn();
    const got = await web.call('/api/diary');
    assert.equal(got.status, 200);
    const { entries } = await got.json() as { entries: { day: string; text: string }[] };
    assert.equal(entries[0].day, '2026-08-29');
    assert.match(entries[0].text, /Tommy was a pain/);
  } finally { await web.stop(); }
});

test('her diary is served to the phone, newest first, behind the door', async () => {
  const web = await door();
  try {
    await web.signIn();
    const got = await web.call('/api/diary');
    assert.equal(got.status, 200);
    const { entries } = await got.json() as { entries: { day: string; text: string }[] };
    assert.equal(entries[0].day, '2026-08-29');
    assert.match(entries[0].text, /Tommy was a pain/);
  } finally { await web.stop(); }
});

// -- speech to speech: the hook, the status, the call ----------------------------------

type Evi = NonNullable<WebDeps['evi']>;

/** A call that can be placed, a hook that answers one live session. */
function eviDeps(overrides: Partial<Evi> = {}): Evi {
  return {
    status: () => ({ enabled: true, minutesToday: 3, cap: 60 }),
    secret: () => 'hook-secret',
    open: async (_device, handlers) => ({ sendAudio: () => {}, close: reason => handlers.onClose(reason ?? 'hung up') }),
    turn: async (sessionId, text, _prosody, onChunk) => {
      if (sessionId !== 'dev.live') return null;
      onChunk('Fine, ');
      // A thrown-away round: the marker must not reach Hume.
      onChunk('�');
      onChunk(text.toUpperCase());
      return { reply: 'Fine, ' + text.toUpperCase() };
    },
    ...overrides,
  };
}

const HOOK = '/api/evi/chat/completions?custom_session_id=dev.live';
const hookBody = (text: string) => JSON.stringify({ messages: [{ role: 'user', content: text, models: { prosody: { scores: { Anger: 0.5 } } } }] });
const dataLines = (body: string) => body.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6));

test('the call status is behind the sign-in and says when nothing is built', async () => {
  const bare = await door();
  try {
    await bare.signIn();
    const status = await bare.call('/api/evi/status');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { enabled: false, minutesToday: 0, cap: 0, reason: 'not built' });
  } finally { await bare.stop(); }
  const built = await door({ evi: eviDeps() });
  try {
    await built.signIn();
    assert.deepEqual(await (await built.call('/api/evi/status')).json(), { enabled: true, minutesToday: 3, cap: 60 });
  } finally { await built.stop(); }
});

test('the brain hook answers Hume by bearer, never by cookie, and locks out guessing', async () => {
  const web = await door({ evi: eviDeps() });
  try {
    // No cookie is ever involved: Hume's servers call this, not the phone.
    const bare = await web.call(HOOK, { method: 'POST', body: hookBody('hello'), anonymous: true });
    assert.equal(bare.status, 401);
    for (let i = 0; i < 3; i++) {
      const wrong = await web.call(HOOK, { method: 'POST', body: hookBody('hello'), anonymous: true, headers: { authorization: 'Bearer nope' } });
      assert.equal(wrong.status, 401);
    }
    const locked = await web.call(HOOK, { method: 'POST', body: hookBody('hello'), anonymous: true, headers: { authorization: 'Bearer nope' } });
    assert.equal(locked.status, 429, 'the fifth wrong bearer waits, like the fifth wrong password');
  } finally { await web.stop(); }
});

test('the brain hook streams her words as OpenAI chunks and ends with DONE', async () => {
  const web = await door({ evi: eviDeps() });
  try {
    const right = { authorization: 'Bearer hook-secret' };
    const noSession = await web.call('/api/evi/chat/completions', { method: 'POST', body: hookBody('hello'), anonymous: true, headers: right });
    assert.equal(noSession.status, 400);
    const strange = await web.call('/api/evi/chat/completions?custom_session_id=dev.stale', { method: 'POST', body: hookBody('hello'), anonymous: true, headers: right });
    assert.equal(strange.status, 403, 'a right bearer with a session that is not a call of ours is refused');
    const nothing = await web.call(HOOK, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'assistant', content: 'x' }] }), anonymous: true, headers: right });
    assert.equal(nothing.status, 400);

    const answered = await web.call(HOOK, { method: 'POST', body: hookBody('hello'), anonymous: true, headers: right });
    assert.equal(answered.status, 200);
    assert.match(answered.headers.get('content-type') ?? '', /^text\/event-stream/);
    const lines = dataLines(await answered.text());
    assert.equal(lines.at(-1), '[DONE]');
    const chunks = lines.slice(0, -1).map(line => JSON.parse(line) as { object: string; choices: { delta: { content?: string }; finish_reason: string | null }[] });
    assert.ok(chunks.every(chunk => chunk.object === 'chat.completion.chunk'));
    assert.deepEqual(chunks.map(chunk => chunk.choices[0].delta.content ?? ''), ['Fine, ', 'HELLO', ''], 'the thrown-away marker never goes out');
    assert.deepEqual(chunks.map(chunk => chunk.choices[0].finish_reason), [null, null, 'stop']);
  } finally { await web.stop(); }
});

test('a reply she is not giving is a stop and DONE with no words in it', async () => {
  const web = await door({ evi: eviDeps({ turn: async () => ({ reply: '', ignored: true }) }) });
  try {
    const answered = await web.call(HOOK, { method: 'POST', body: hookBody('hello'), anonymous: true, headers: { authorization: 'Bearer hook-secret' } });
    assert.equal(answered.status, 200);
    const lines = dataLines(await answered.text());
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]) as { choices: { finish_reason: string }[] }).choices[0].finish_reason, 'stop');
    assert.equal(lines[1], '[DONE]');
  } finally { await web.stop(); }
});

/** The phone's end of a call: the socket, and its messages in the order they came. */
type Call = { ws: WebSocket; next(): Promise<Record<string, unknown>>; closed: Promise<{ code: number; reason: string }> };

/**
 * Opens the call socket and resolves with the call, or with the status the
 * server refused it with. Messages are queued from the first byte: the
 * server's `ready` can share a packet with the handshake and be emitted
 * before any listener a test attaches afterwards would hear it.
 */
function dial(port: number, path: string, cookie: string): Promise<Call | { refused: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: cookie ? { cookie } : {} });
    const queue: Record<string, unknown>[] = [];
    const waiting: ((message: Record<string, unknown>) => void)[] = [];
    ws.on('message', data => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      const taker = waiting.shift();
      if (taker) taker(message); else queue.push(message);
    });
    const closed = new Promise<{ code: number; reason: string }>(done => ws.once('close', (code, reason) => done({ code, reason: String(reason) })));
    const next = () => new Promise<Record<string, unknown>>(take => { const queued = queue.shift(); if (queued) take(queued); else waiting.push(take); });
    ws.once('unexpected-response', (_req, res) => { resolve({ refused: res.statusCode ?? 0 }); ws.terminate(); });
    ws.once('open', () => resolve({ ws, next, closed }));
    ws.once('error', reject);
  });
}

test('the call socket is refused to strangers and off every other path', async () => {
  const web = await door({ evi: eviDeps() });
  try {
    assert.deepEqual(await dial(web.port, '/api/evi/session', ''), { refused: 401 });
    await web.signIn(true);
    assert.deepEqual(await dial(web.port, '/api/chat', web.cookie()), { refused: 404 });
  } finally { await web.stop(); }
  const bare = await door();
  try {
    await bare.signIn(true);
    assert.deepEqual(await dial(bare.port, '/api/evi/session', bare.cookie()), { refused: 404 }, 'nothing built, nothing to connect to');
  } finally { await bare.stop(); }
});

test('a call carries audio up and events down, and stop hangs it up', async () => {
  const frames: number[] = [];
  const web = await door({
    evi: eviDeps({
      open: async (_device, handlers) => {
        setTimeout(() => handlers.onEvent({ type: 'user_message', text: 'hello', interim: false }), 5);
        return { sendAudio: pcm => frames.push(pcm.length), close: reason => handlers.onClose(reason ?? 'hung up') };
      },
    }),
  });
  try {
    await web.signIn(true);
    const dialled = await dial(web.port, '/api/evi/session', web.cookie());
    assert.ok('ws' in dialled, 'the phone gets its call');
    const call = dialled;
    assert.deepEqual(await call.next(), { type: 'ready' });
    assert.deepEqual(await call.next(), { type: 'user_message', text: 'hello', interim: false });
    call.ws.send(Buffer.alloc(1280));
    call.ws.send(Buffer.alloc(640));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(frames, [1280, 640]);
    call.ws.send(JSON.stringify({ type: 'stop' }));
    assert.deepEqual(await call.next(), { type: 'ended', reason: 'the phone hung up' });
    assert.equal((await call.closed).code, 1000);
  } finally { await web.stop(); }
});

test('a call that cannot be placed says why and closes', async () => {
  const web = await door({ evi: eviDeps({ open: async () => { throw new Error('She is asleep.'); } }) });
  try {
    await web.signIn(true);
    const dialled = await dial(web.port, '/api/evi/session', web.cookie());
    assert.ok('ws' in dialled);
    assert.deepEqual(await dialled.next(), { type: 'refused', reason: 'She is asleep.' });
    const end = await dialled.closed;
    assert.equal(end.code, 1008);
    assert.equal(end.reason, 'She is asleep.');
  } finally { await web.stop(); }
});
