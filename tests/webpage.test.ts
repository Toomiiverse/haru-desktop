// The two pages the phone ever sees, checked against the policy they are served
// under.
//
// There is deliberately not much here. webpage.ts is a static asset that happens
// to live in a .ts file: two functions taking no arguments and returning a
// constant string, most of it CSS. Asserting that the markup still says what it
// says would be a change-detector — it would fail every time somebody edited the
// page and teach nobody anything.
//
// What is worth pinning is the contract with webserver.ts, because breaking it
// is silent. The policy those pages go out under names no host at all:
// default-src 'none', with 'self' for scripts, images, media and fetches. Add a
// webfont or a CDN script and nothing throws and no log complains — the phone
// just quietly does not load it. These tests are the thing that complains.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appPage, loginPage } from '../electron/webpage';

const PAGES: [string, string][] = [['the login page', loginPage()], ['the app page', appPage()]];

for (const [name, html] of PAGES) {
  test(`${name} reaches outside for nothing`, () => {
    // default-src 'none' and not one host named. Her portrait is served by us,
    // from us; so is everything else.
    const absolute = html.match(/https?:\/\/[^\s"'`)]+|(?<![:\w])\/\/[a-z0-9-]+\.[a-z]/gi) ?? [];
    // A namespace declaration is not a fetch — nothing is retrieved from it.
    const fetched = absolute.filter(url => !url.includes('www.w3.org'));
    assert.deepEqual(fetched, [], `${name} would try to load: ${fetched.join(', ')}`);
    assert.ok(!html.includes('@import'), 'an @import is an outside origin by another name');
  });

  test(`${name} asks only its own server`, () => {
    // connect-src 'self'. Every one of these has to be a relative path.
    const calls = [...html.matchAll(/fetch\(\s*(['"`])([^'"`]*)\1/g)].map(match => match[2]);
    assert.ok(calls.length > 0, 'no fetches found — has the page changed shape?');
    for (const url of calls) {
      assert.ok(url.startsWith('/'), `${url} is not same-origin`);
      assert.ok(!url.startsWith('//'), `${url} is protocol-relative, which leaves the origin`);
    }
  });

  test(`${name} declares no base, which the policy forbids`, () => {
    // base-uri 'none'. A <base> would also silently re-point every relative path
    // above, which is the whole reason the policy refuses it.
    assert.ok(!/<base\b/i.test(html));
  });

  test(`${name} is a whole document`, () => {
    // Built by joining template literals, so the failure mode is truncation —
    // one stray backtick in nine hundred lines of CSS and the page ends early.
    assert.ok(html.startsWith('<!doctype html>'), 'no doctype');
    assert.ok(html.includes('<meta charset=utf-8>'), 'no charset');
    assert.ok(html.includes('name=viewport'), 'no viewport, so the phone renders it at desktop width');
    assert.ok(html.includes('<title>Haru</title>'), 'no title');
    assert.equal(
      (html.match(/<script>/g) ?? []).length,
      (html.match(/<\/script>/g) ?? []).length,
      'a script tag was left open',
    );
    assert.equal(
      (html.match(/<style>/g) ?? []).length,
      (html.match(/<\/style>/g) ?? []).length,
      'a style tag was left open',
    );
    assert.ok(html.trimEnd().endsWith('</script>'), 'the page does not end where it should');
  });

  test(`${name} ships a script the browser can actually parse`, () => {
    // The pages are template literals, and a \n or \/ meant for the emitted
    // JS collapses in the literal unless doubled — a syntax error nothing here
    // type-checks and the phone reports as a page that silently does nothing.
    // Caught twice by hand; this is the check that catches it third time.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.ok(scripts.length > 0, 'no script found — has the page changed shape?');
    for (const source of scripts) {
      assert.doesNotThrow(() => new Function(source), `${name}'s script does not parse`);
    }
  });

  test(`${name} carries no unresolved interpolation`, () => {
    // A `${` that survives into the output is a template literal that was quoted
    // when it meant to be evaluated, and it ships as visible junk.
    assert.ok(!html.includes('${'), 'an unresolved ${ reached the page');
  });

  test(`${name} installs to the home screen from our own files`, () => {
    for (const href of [...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map(match => match[1])) {
      assert.ok(href.startsWith('/'), `${href} is not served by us`);
    }
  });
}

test('the login form never relies on the browser to submit it', () => {
  // form-action 'none'. A native submit would be blocked by the policy and the
  // page would appear to do nothing at all, so the handler has to stop it.
  const html = loginPage();
  assert.ok(html.includes("addEventListener('submit'"), 'nothing intercepts the submit');
  assert.ok(html.includes('preventDefault()'), 'the browser would be left to post it, and be refused');
  assert.ok(!/<form\b[^>]*\baction=/i.test(html), 'a form action is exactly what the policy forbids');
});

test('nothing is rendered as markup until it has been escaped', () => {
  // The one genuinely dangerous line on either page: her replies are turned into
  // <b>, <i> and <code> by hand. Escaping first is what keeps those three the
  // only tags that can ever reach the page — reverse the two calls and any reply
  // containing a tag becomes that tag.
  const html = appPage();
  const calls = (html.match(/\bmd\(/g) ?? []).length;
  const guarded = (html.match(/\bmd\(\s*esc\(/g) ?? []).length;
  assert.ok(calls > 0, 'no markdown rendering found — has the page changed shape?');
  assert.equal(guarded, calls, 'md() was handed something that had not been escaped');
});

test('the escaper covers every character that can open a tag or close an attribute', () => {
  const html = appPage();
  const escaper = html.match(/const esc=[^\n]*/)?.[0] ?? '';
  assert.ok(escaper, 'no escaper found');
  for (const [character, entity] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]) {
    assert.ok(escaper.includes(entity), `${character} is not escaped to ${entity}`);
  }
});

test('the two pages are the same shell, so a change lands on both', () => {
  // Both are built from SHELL. If one drifts off it, the phone gets two
  // different-looking screens either side of a sign-in.
  const [login, app] = [loginPage(), appPage()];
  assert.ok(login.includes('--hue:') && app.includes('--hue:'), 'one of them is not on the shared palette');
  assert.ok(login.includes('color-scheme: dark') && app.includes('color-scheme: dark'));
});

// Her face, driven.
//
// Three things are checked here. The engine, with numbers: it is pure and
// clock-free, so a time goes in and a frame comes out — a face, a float, a
// gaze — and what it does when a face changes mid-fade can be asserted to the
// decimal. The eye-finding, on a face built to look like the real files: a
// backdrop, dark eyes in fill groups, pink blush beneath them. And the
// renderer, in a vm with a document of stubs and a fetch that answers at once.
type Stub = any;
function drive({ reduced = false, transition, frozenAt, missing = [] as string[] }: { reduced?: boolean; transition?: string; frozenAt?: string; missing?: string[] } = {}) {
  const app = appPage();
  const anchor = app.indexOf('window.haruAvatar = {');
  const start = anchor < 0 ? -1 : app.lastIndexOf('(() => {', app.indexOf('window.HaruEmotionEngine ='));
  assert.ok(start > 0, 'the avatar block is no longer where this test can find it');
  const end = app.indexOf('})();', anchor);
  const source = app.slice(start, end + 5);
  const classes = () => { const set = new Set<string>(); return { add: (c: string) => { set.add(c); }, remove: (c: string) => { set.delete(c); }, contains: (c: string) => set.has(c) }; };
  const element = (name: string, attrs: Record<string, string> = {}, kids: Stub[] = []): Stub => {
    const el: Stub = { nodeName: name, attrs: { ...attrs }, classList: classes(), style: {} as Record<string, string>, children: kids, parentNode: null,
      getAttribute(k: string) { return this.attrs[k] ?? null; }, setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; },
      replaceChildren(...nodes: Stub[]) { this.children = nodes; for (const n of nodes) n.parentNode = this; },
      querySelectorAll(sel: string) { const out: Stub[] = []; const walk = (n: Stub) => { for (const c of n.children) { if (sel.split(/,\s*/).includes(c.nodeName)) out.push(c); walk(c); } }; walk(this); return out; } };
    for (const k of kids) k.parentNode = el;
    return el;
  };
  // A face like the files: a black square first, dark eyes in a fill group,
  // pink blush under them in another, a mouth in the middle. 1254 square.
  const faceTree = () => element('svg', { viewBox: '0.00 0.00 1254.00 1254.00' }, [
    element('path', { fill: '#000000', d: 'M 1254.00 0.00 L 1254.00 1254.00 L 0.00 1254.00 L 0.00 0.00 L 1254.00 0.00 Z' }),
    element('g', { fill: '#2d2b30' }, [
      element('path', { d: 'M 455 788 l 60 0 l 0 112 l -60 0 Z' }),
      element('path', { d: 'M 726 788 L 783 788 L 783 900 L 726 900 Z' }),
    ]),
    element('g', { fill: '#f9bac9' }, [
      element('path', { d: 'M 398 895 L 448 895 L 448 919 L 398 919 Z' }),
      element('path', { d: 'M 768 895 L 818 895 L 818 919 L 768 919 Z' }),
    ]),
    element('path', { fill: '#2d2b30', d: 'M 573 908 L 691 908 L 691 983 L 573 983 Z' }),
  ]);
  const faces = [element('div'), element('div')];
  const box: Stub = element('div'); box.offsetWidth = 1; box.querySelectorAll = () => faces;
  const body: Stub = element('div'); body.offsetWidth = 1;
  const dataset: Record<string, string> = {}; if (transition !== undefined) dataset.transition = transition; if (frozenAt !== undefined) dataset.frozenAt = frozenAt;
  const host: Stub = { dataset, style: { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } }, innerHTML: '' };
  box.style = { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } };
  const timers: (() => void)[] = [];
  let now = 1000;
  const win: Stub = {
    Math, JSON, Number, Array, Object, String, Boolean, Map, Set, Promise, Error, Infinity,
    document: { getElementById: (id: string) => (id === 'stage' ? host : id === 'avatar' ? box : id === 'avatar-body' ? body : null), adoptNode: (n: Stub) => n, addEventListener() {} },
    DOMParser: function () { return { parseFromString: () => ({ documentElement: faceTree() }) }; },
    fetch: (url: string) => { const name = url.replace('/emotions/', '').replace('.svg', ''); return Promise.resolve({ ok: !missing.includes(name), status: missing.includes(name) ? 404 : 200, text: () => Promise.resolve('<svg/>') }); },
    matchMedia: () => ({ matches: reduced }),
    performance: { now: () => now },
    setTimeout: (cb: () => void) => { timers.push(cb); return timers.length; },
    clearTimeout: () => { timers.length = 0; },
    setInterval: () => 1, clearInterval() {}, addEventListener() {},
  };
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'avatar.js' });
  const shown = () => faces.find(face => face.classList.contains('on'));
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  return { avatar: win.haruAvatar, Engine: win.HaruEmotionEngine, box, body, faces, host, shown, flush, tick: (ms: number) => { now += ms; }, fire: () => { for (const cb of timers.splice(0)) cb(); } };
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test('the engine is clock-free: a time in, a frame out, eased and never overshooting', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  assert.deepEqual(plain(engine.sample(0)), { emotion: 'neutral', previousEmotion: null, transitionProgress: 1, opacity: 1, previousOpacity: 0, transitioning: false });
  assert.equal(engine.set('happy', 1000), true);
  assert.equal(engine.set('happy', 1000), false);
  const mid = engine.sample(1100);
  assert.ok(mid.opacity > 0.5 && mid.opacity < 1 && Math.abs(mid.opacity + mid.previousOpacity - 1) < 1e-9);
  assert.equal(engine.sample(1200).opacity, 1); assert.equal(engine.sample(5000).opacity, 1);
  assert.deepEqual(plain(engine.sample(1150)), plain(engine.sample(1150)));
});

test('a face that changes mid-fade starts from what is visible — nothing jumps', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  engine.set('happy', 1000); const before = engine.sample(1050); engine.set('angry', 1050); const after = engine.sample(1050);
  assert.equal(after.previousEmotion, 'happy'); assert.equal(after.previousOpacity, before.opacity); assert.equal(after.opacity, 0);
  let t = 1050;
  for (const face of ['sad', 'excited', 'neutral', 'happy']) { t += 30; engine.set(face, t); const f = engine.sample(t + 10); assert.ok(f.opacity >= 0 && f.opacity <= 1 && f.previousOpacity >= 0 && f.previousOpacity <= 1, face); }
});

test('how she floats and where she looks are pure functions of time: bounded, repeatable, and mostly at rest', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  const a = engine.idle(1234); assert.deepEqual(plain(a), plain(engine.idle(1234)));
  assert.ok(Math.abs(engine.idle(0).bob - engine.idle(a.periodMs).bob) < 1e-9);
  let looking = 0, resting = 0;
  for (let t = 0; t < 3000 * 200; t += 3000) { const g = engine.gaze(t + 1); assert.ok(g.x >= -1 && g.x <= 1 && g.y >= -1 && g.y <= 1); assert.deepEqual(plain(g), plain(engine.gaze(t + 1))); if (g.looking) looking++; else resting++; }
  assert.ok(resting > looking, `she rests more than she looks (${resting} vs ${looking})`);
  assert.ok(looking > 30, 'but she does look around');
  const rest = engine.gaze(1); assert.ok(Math.abs(rest.x) < 0.1 && Math.abs(rest.y) < 0.1 || rest.looking, 'a resting beat sits near centre');
});

test('her eyes are found by shape alone — the larger mirrored pair in the eye band, not the blush below it, not the backdrop', async () => {
  const { avatar, shown, flush } = drive();
  avatar.express('happy'); await flush();
  const svg = shown()?.children[0];
  const paths = svg.querySelectorAll('path');
  const marked = paths.map((p: Stub) => p.getAttribute('class'));
  assert.deepEqual(marked, ['backdrop', 'eye', 'eye', null, null, null]);
  assert.equal(avatar.eyes(), 2);
});

test('a change of face settles the body, not the float, so she stays where the float had her', async () => {
  const { avatar, box, body, flush } = drive();
  avatar.express('happy'); await flush();
  assert.ok(body.classList.contains('changed'));
  assert.ok(!box.classList.contains('changed'));
  assert.equal(box.style.vars['--idle-bob'], '5px', 'the amplitude follows the face; the period does not');
  assert.equal(box.style.vars['--idle-period'], undefined, 'no period is handed to the float, because a running animation given a new duration jumps');
});

test('her attention: them typing, her talking, her thinking, a face with no eyes to move — and then the wander again', async () => {
  const { avatar, box, tick, flush } = drive();
  avatar.express('neutral'); await flush();
  avatar.attend('typing', 1500);
  assert.equal(avatar.gaze().why, 'typing'); assert.ok(avatar.gaze().y > 0.5, 'she looks down at the box');
  assert.match(box.style.vars['--gaze-y'], /^[0-9.]+px$/);
  tick(2000);
  assert.ok(['looking', 'resting'].includes(avatar.gaze().why), 'a spent claim hands her back to the wander');
  avatar.attend('talking', 1000); assert.equal(avatar.gaze().why, 'talking');
  avatar.attend(null);
  avatar.express('thinking'); await flush(); assert.equal(avatar.gaze().why, 'thinking'); assert.ok(avatar.gaze().y < 0, 'up and away');
  avatar.express('surprised'); await flush(); assert.deepEqual(plain(avatar.gaze()), { x: 0, y: 0, why: 'fixed' });
  avatar.express('sleepy'); await flush(); const g = avatar.gaze(); assert.ok(Math.abs(g.x) <= 0.15 && Math.abs(g.y) <= 0.15, 'closed eyes barely move');
});

test('the mood engine’s word becomes the face for it, as the SVG itself, with the black square hidden', async () => {
  const { avatar, box, shown, flush } = drive();
  avatar.express('determined'); await flush();
  assert.equal(avatar.state().emotion, 'excited');
  assert.equal(box.getAttribute('aria-label'), 'Haru feeling excited');
  const svg = shown()?.children[0];
  assert.equal(svg?.nodeName, 'svg'); assert.equal(svg.getAttribute('viewBox'), '0.00 0.00 1254.00 1254.00'); assert.equal(svg.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  assert.equal(svg.children[0].getAttribute('class'), 'backdrop');
  avatar.express('no such mood'); await flush(); assert.equal(avatar.state().emotion, 'neutral');
});

test('thinking holds until the mood lands, and otherwise settles back on its own', async () => {
  const { avatar, fire, flush } = drive();
  avatar.express('happy'); avatar.think(); await flush(); assert.equal(avatar.state().emotion, 'thinking');
  fire(); await flush(); assert.equal(avatar.state().emotion, 'happy');
  avatar.think(); avatar.express('smug'); await flush(); assert.equal(avatar.state().emotion, 'smug');
});

test('a poke is a face for a moment, then back to how she was', async () => {
  const { avatar, fire, flush } = drive();
  avatar.express('curious'); avatar.poke('exclaim'); await flush(); assert.equal(avatar.state().emotion, 'angry');
  fire(); await flush(); assert.equal(avatar.state().emotion, 'curious');
});

test('the crossfade runs for the configured time with the engine’s easing, and not at all when motion is reduced', async () => {
  const timed = drive({ transition: '150' }); timed.avatar.express('happy'); await timed.flush();
  assert.equal(timed.shown()?.style.transition, 'opacity 150ms cubic-bezier(0.33, 1, 0.68, 1)');
  const still = drive({ reduced: true }); still.avatar.express('happy'); await still.flush();
  assert.equal(still.shown()?.style.transition, 'none'); assert.equal(still.avatar.state().transitionProgress, 1);
  assert.equal(still.body.classList.contains('changed'), false, 'no settle when motion is reduced');
  assert.equal(still.box.style.vars['--gaze-x'], '0px', 'and her eyes stay put');
  const dialled = drive(); dialled.avatar.setTransition(0); dialled.avatar.express('sad'); await dialled.flush();
  assert.equal(dialled.shown()?.style.transition, 'none'); dialled.avatar.setSize(320); assert.equal(dialled.host.style.vars['--avatar-size'], '320px');
});

test('frozen, the exact frame for that instant is drawn and nothing moves', async () => {
  const { avatar, faces, tick, shown, box, body, flush } = drive({ transition: '200' });
  avatar.express('happy'); await flush(); tick(100); avatar.freeze();
  const frame = avatar.sample();
  assert.ok(frame.transitioning && avatar.state().frozen && box.classList.contains('frozen'));
  assert.equal(shown()?.style.transition, 'none');
  assert.equal(Number(shown()?.style.opacity).toFixed(4), frame.opacity.toFixed(4));
  assert.equal(Number(faces.find(f => f !== shown())?.style.opacity).toFixed(4), frame.previousOpacity.toFixed(4));
  assert.equal(box.style.vars['--gaze-x'], '0px');
  avatar.notify(); assert.equal(body.classList.contains('pop'), false);
  avatar.play(); assert.equal(avatar.state().frozen, false);
  assert.equal(drive({ frozenAt: '0' }).avatar.state().frozen, true);
});

test('a face whose file is missing shows nothing, not a broken image; a newer face wins a race', async () => {
  const gone = drive({ missing: ['sad'] }); gone.avatar.express('sad'); await gone.flush();
  assert.ok(gone.faces.some(f => f.classList.contains('missing')));
  const race = drive(); race.avatar.express('happy'); race.avatar.express('angry'); await race.flush();
  assert.equal(race.avatar.state().emotion, 'angry'); assert.equal(race.shown()?.children[0]?.nodeName, 'svg');
});

test('the old engine is gone from the page, and the faces come from her own server', () => {
  const html = appPage();
  assert.ok(!/bloub/i.test(html));
  assert.ok(html.includes("'/emotions/'") && html.includes('prefers-reduced-motion') && html.includes('role=img'));
  assert.ok(html.includes('.backdrop { display:none; }'));
  assert.ok(html.includes("attend('typing'"), 'typing in the box is her cue');
});
