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
    // Nor is a maps link: the phone's own maps app opens it, when they tap the
    // button she attached to a directions answer. Nothing is fetched from either.
    const fetched = absolute.filter(url => !url.includes('www.w3.org') && !/^https:\/\/(?:maps\.apple\.com|www\.google\.com\/maps)\//.test(url));
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
  const poseEl: Stub = element('div'); poseEl.style = { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } };
  const dataset: Record<string, string> = {}; if (transition !== undefined) dataset.transition = transition; if (frozenAt !== undefined) dataset.frozenAt = frozenAt;
  const host: Stub = { dataset, style: { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } }, innerHTML: '' };
  box.style = { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } };
  // Fake timers with ids, so clearing one leaves the others — a face change
  // clears its settle timer, not the blink that is booked.
  const timers = new Map<number, () => void>(); let nextTimer = 1;
  let now = 1000;
  const win: Stub = {
    Math, JSON, Number, Array, Object, String, Boolean, Map, Set, Promise, Error, Infinity,
    document: { getElementById: (id: string) => (id === 'stage' ? host : id === 'avatar' ? box : id === 'avatar-body' ? body : id === 'avatar-pose' ? poseEl : null), adoptNode: (n: Stub) => n, addEventListener() {} },
    DOMParser: function () { return { parseFromString: () => ({ documentElement: faceTree() }) }; },
    fetch: (url: string) => { const name = url.replace('/emotions/', '').replace('.svg', ''); return Promise.resolve({ ok: !missing.includes(name), status: missing.includes(name) ? 404 : 200, text: () => Promise.resolve('<svg/>') }); },
    matchMedia: () => ({ matches: reduced }),
    performance: { now: () => now },
    setTimeout: (cb: () => void) => { const id = nextTimer++; timers.set(id, cb); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    setInterval: () => 1, clearInterval() {}, addEventListener() {},
  };
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'avatar.js' });
  const shown = () => faces.find(face => face.classList.contains('on'));
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  return { avatar: win.haruAvatar, Engine: win.HaruEmotionEngine, box, body, poseEl, faces, host, shown, flush, tick: (ms: number) => { now += ms; }, fire: () => { const due = [...timers.values()]; timers.clear(); for (const cb of due) cb(); }, pending: () => timers.size };
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

test('how she floats and where she looks are pure functions of time: bounded, repeatable, looking about with rests between', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  const a = engine.idle(1234); assert.deepEqual(plain(a), plain(engine.idle(1234)));
  assert.ok(Math.abs(engine.idle(0).bob - engine.idle(a.periodMs).bob) < 1e-9);
  let looking = 0, resting = 0;
  for (let t = 0; t < 2400 * 200; t += 2400) { const g = engine.gaze(t + 1); assert.ok(g.x >= -1 && g.x <= 1 && g.y >= -1 && g.y <= 1); assert.deepEqual(plain(g), plain(engine.gaze(t + 1))); if (g.looking) looking++; else resting++; }
  assert.ok(looking > resting, `idle, she looks about more than she rests (${looking} vs ${resting})`);
  assert.ok(resting > 40, 'but she does rest, so a look reads as a look');
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
  // The voice starts before the mood is known: talking ends the thinking at
  // once, on the resting face, and the mood lands on top when it arrives.
  avatar.think(); await flush(); assert.equal(avatar.state().emotion, 'thinking');
  avatar.notify(); await flush();
  assert.equal(avatar.state().emotion, 'smug', 'starting to talk is the end of thinking');
  avatar.express('happy'); await flush(); assert.equal(avatar.state().emotion, 'happy');
  const still = drive({ reduced: true }); still.avatar.express('curious'); still.avatar.think(); await still.flush(); still.avatar.notify(); await still.flush();
  assert.equal(still.avatar.state().emotion, 'curious', 'even with motion reduced, the face leaves thinking');
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

test('she blinks on a calendar that never repeats on a schedule, with the odd double blink, and not on a face that cannot', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  const blinks: number[] = []; let t = 0;
  for (let i = 0; i < 60; i++) { const at = engine.nextBlink(t); blinks.push(at); t = at + 1; }
  const gaps = blinks.slice(1).map((b, i) => b - blinks[i]);
  assert.ok(gaps.every(g => (g >= 1900 && g <= 4600) || g === 240), `gaps out of range: ${gaps.filter(g => !((g >= 1900 && g <= 4600) || g === 240))}`);
  assert.ok(gaps.some(g => g === 240), 'now and then a double blink');
  assert.ok(new Set(gaps.map(g => Math.round(g / 100))).size > 8, 'not on a schedule');
  assert.equal(engine.nextBlink(t), engine.nextBlink(t), 'the same calendar every time');
  const first = engine.nextBlink(0);
  assert.equal(engine.blink(first - 1), 1, 'open before'); assert.ok(engine.blink(first + 70) < 0.15, 'shut at the bottom'); assert.equal(engine.blink(first + 181), 1, 'open after');
  engine.set('surprised', 0); assert.equal(engine.blinks(), false); assert.equal(engine.blink(first + 70), 1, 'no eyes to close');
  engine.set('sleepy', 0); assert.equal(engine.blinks(), false);
  engine.set('happy', 0); assert.equal(engine.blinks(), true);
});

test('a blink is a squash of the eyes, booked from the calendar, and none while frozen or still', async () => {
  const { avatar, box, fire, pending, flush } = drive();
  avatar.express('happy'); await flush();
  assert.ok(pending() > 0, 'a blink is booked');
  fire();
  assert.equal(box.style.vars['--lid'], '0.1', 'the lid comes down');
  fire();
  assert.equal(box.style.vars['--lid'], '1', 'and up again, with the next blink booked');
  assert.ok(pending() > 0);
  avatar.freeze(); assert.equal(pending(), 0, 'frozen, nothing is booked');
  const still = drive({ reduced: true }); still.avatar.express('happy'); await still.flush();
  assert.equal(still.pending(), 0, 'reduced motion: no blink is booked');
  const html = appPage();
  assert.ok(html.includes('scaleY(var(--lid))'), 'the squash is in the eye transform');
});

test('a glance is a real distance at the phone’s size', async () => {
  const { avatar, box, flush } = drive();
  avatar.express('neutral'); await flush();
  avatar.attend('typing', 1500);
  assert.ok(parseFloat(box.style.vars['--gaze-y']) >= 12, `at least a couple of screen pixels at 136px: ${box.style.vars['--gaze-y']}`);
});

test('how she holds herself is a pure function of time and face: a cock of the head held then released, a small roam, a droop that stays', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  let posed = 0, rested = 0, maxTilt = 0, maxRoam = 0;
  for (let t = 0; t < 5200 * 150; t += 260) {
    const p = engine.pose(t); assert.deepEqual(plain(p), plain(engine.pose(t)));
    maxTilt = Math.max(maxTilt, Math.abs(p.tilt)); maxRoam = Math.max(maxRoam, Math.hypot(p.dx, p.dy));
    if (p.posed) posed++; else rested++;
  }
  assert.ok(posed > 0 && rested > posed, `a tilt is a gesture, not a lean (${posed} posed, ${rested} rested)`);
  assert.ok(maxTilt <= 7 && maxTilt > 3, `neutral cocks her head up to seven degrees (${maxTilt})`);
  assert.ok(maxRoam <= 0.06 && maxRoam > 0.02, `and roams within six percent of her size (${maxRoam})`);
  engine.set('sleepy', 0);
  const droop = engine.pose(5200 * 0.8); assert.equal(droop.posed, false); assert.equal(droop.tilt, 5, 'sleepy droops even at rest');
  engine.set('curious', 0);
  let cocked = 0; for (let t = 0; t < 5200 * 150; t += 260) cocked = Math.max(cocked, Math.abs(engine.pose(t).tilt));
  assert.ok(cocked > 9, `curious cocks her head further (${cocked})`);
});

test('the pose is handed to its own wrapper, so neither the float nor the settle is disturbed, and stays put when still', async () => {
  const { avatar, poseEl, box, body, flush } = drive();
  avatar.express('sleepy'); await flush();
  assert.match(poseEl.style.vars['--tilt'], /deg$/);
  assert.ok(parseFloat(poseEl.style.vars['--tilt']) >= 5, 'the lean is carried');
  assert.match(poseEl.style.vars['--drift-x'], /^-?[0-9.]+$/);
  assert.equal(box.style.vars['--tilt'], undefined); assert.equal(body.style['--tilt'], undefined);
  const still = drive({ reduced: true }); still.avatar.express('curious'); await still.flush();
  assert.equal(still.poseEl.style.vars['--tilt'], '0.00deg'); assert.equal(still.poseEl.style.vars['--drift-x'], '0.000');
  const html = appPage();
  assert.ok(html.includes('id=avatar-pose') && html.includes('calc(var(--avatar-size) * var(--drift-x))'), 'the roam is a fraction of her size');
});

// -- what the phone keeps, and whether she can be reached ----------------------------

function phone({ storage = 'ok', onLine = true, connection }: { storage?: 'ok' | 'none' | 'throws'; onLine?: boolean; connection?: { type?: string } } = {}) {
  const app = appPage();
  const start = app.indexOf('(() => {\n  // ---- What this phone keeps for itself');
  assert.ok(start > 0, 'the phone block is no longer where this test can find it');
  const end = app.indexOf('})();', start);
  const source = app.slice(start, end + 5);
  const store = new Map<string, string>();
  const localStorage = storage === 'throws'
    ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } }
    : { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  const events: Record<string, () => void> = {};
  let fetchOutcome: 'ok' | 'down' = 'ok';
  const win: Stub = {
    JSON, Set, Error, Promise,
    navigator: { onLine, connection },
    fetch: () => (fetchOutcome === 'ok' ? Promise.resolve({ ok: true, status: 200 }) : Promise.reject(new TypeError('Load failed'))),
    addEventListener: (name: string, fn: () => void) => { events[name] = fn; },
  };
  if (storage !== 'none') win.localStorage = localStorage;
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'phone.js' });
  return { keep: win.haruKeep, net: win.haruNet, store, events, down: () => { fetchOutcome = 'down'; }, up: () => { fetchOutcome = 'ok'; }, goOffline: () => { win.navigator.onLine = false; events.offline(); }, goOnline: () => { win.navigator.onLine = true; events.online(); } };
}

test('what the phone keeps comes back as it went, under her own prefix, and a null drops it', () => {
  const { keep, store } = phone();
  assert.equal(keep.get('draft', ''), '');
  assert.equal(keep.set('draft', 'fine, go'), true);
  assert.equal(store.get('haru.draft'), '"fine, go"');
  assert.equal(keep.get('draft', ''), 'fine, go');
  keep.set('today', { savedAt: 5, messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(plain(keep.get('today', null)), { savedAt: 5, messages: [{ role: 'user', content: 'hi' }] });
  keep.set('draft', null);
  assert.equal(store.has('haru.draft'), false);
  keep.set('where', true); keep.drop('where');
  assert.equal(keep.get('where', false), false);
});

test('a phone with no storage, or one that throws, gets the defaults and no error', () => {
  for (const storage of ['none', 'throws'] as const) {
    const { keep } = phone({ storage });
    assert.equal(keep.get('draft', 'nothing'), 'nothing', storage);
    assert.equal(keep.set('draft', 'x'), false, storage);
    assert.equal(keep.get('draft', 'nothing'), 'nothing', storage);
  }
});

test('reachability: the phone says off, a request that never arrives says lost, an answer says on', async () => {
  const { net, down, up, goOffline, goOnline } = phone();
  const seen: string[] = [];
  net.onChange((s: string) => seen.push(s));
  assert.equal(net.state(), 'on');
  down();
  await assert.rejects(net.fetch('/api/chat'));
  assert.equal(net.state(), 'lost');
  assert.equal(net.online(), false);
  up();
  await net.fetch('/api/chat');
  assert.equal(net.state(), 'on');
  goOffline();
  assert.equal(net.state(), 'off');
  down();
  await assert.rejects(net.fetch('/api/chat'));
  assert.equal(net.state(), 'off', 'offline stays offline, not lost');
  goOnline();
  assert.equal(net.state(), 'on');
  assert.deepEqual(seen, ['on', 'lost', 'on', 'off', 'on']);
  assert.equal(phone({ onLine: false }).net.state(), 'off', 'born offline');
});

test('the kind of network is what the browser will say, and unknown where it says nothing', () => {
  assert.equal(phone().net.kind(), 'unknown', 'iOS has no connection object');
  assert.equal(phone({ connection: { type: 'cellular' } }).net.kind(), 'cellular');
  assert.equal(phone({ connection: { type: 'wifi' } }).net.kind(), 'wifi');
  assert.equal(phone({ connection: { type: 'bluetooth' } }).net.kind(), 'unknown');
});

// -- her maps link, as a button --------------------------------------------------------

function markdown(userAgent: string) {
  const app = appPage();
  const start = app.indexOf('function mapsHref(u){');
  const end = app.indexOf('\n', app.indexOf('const md=', start));
  assert.ok(start > 0 && end > start, 'the markdown helpers are no longer where this test can find them');
  const win: Stub = { navigator: { userAgent } };
  win.window = win;
  vm.runInContext(app.slice(start, end) + '\nwindow.md = md;', vm.createContext(win), { filename: 'md.js' });
  return win.md as (s: string) => string;
}

test('a directions link she attached becomes a button that opens Apple Maps on an iPhone and Google Maps elsewhere', () => {
  const text = 'Fine.\n\n[Directions to Coles](https://maps.apple.com/?daddr=-31.93300,115.79900&amp;dirflg=d)';
  const iphone = markdown('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)')(text);
  assert.equal(iphone, 'Fine.\n\n<a class=maps href="https://maps.apple.com/?daddr=-31.93300,115.79900&amp;dirflg=d" target=_blank rel="noopener">🗺️ Directions to Coles</a>');
  const android = markdown('Mozilla/5.0 (Linux; Android 16; Pixel 9)')(text);
  assert.equal(android, 'Fine.\n\n<a class=maps href="https://www.google.com/maps/dir/?api=1&amp;destination=-31.93300,115.79900" target=_blank rel="noopener">🗺️ Directions to Coles</a>');
});

test('only her two map hosts become links; anything else in her words stays text', () => {
  const md = markdown('iPhone');
  assert.equal(md('[click](https://evil.example/x)'), '[click](https://evil.example/x)');
  assert.equal(md('[x](https://maps.apple.com.evil.example/?daddr=1,2)'), '[x](https://maps.apple.com.evil.example/?daddr=1,2)');
  assert.equal(md('**bold** and *soft*'), '<b>bold</b> and <i>soft</i>');
});

// -- her ears kept open: voice activity, the conversation, the wave file -----------

function voice() {
  const app = appPage();
  const start = app.indexOf('(() => {\n  // ---- Voice activity');
  assert.ok(start > 0, 'the voice block is no longer where this test can find it');
  const end = app.indexOf('})();', start);
  const win: Stub = { Object, Math, RegExp, Float32Array, Int16Array, ArrayBuffer, DataView, JSON };
  win.window = win;
  vm.runInContext(app.slice(start, end + 5), vm.createContext(win), { filename: 'voice.js' });
  return { Vad: win.HaruVad, Talk: win.HaruTalk, wake: win.haruWake, wav: win.haruWav };
}

test('speech is a level well above the room held for a beat, and ends after a stretch of quiet', () => {
  const { Vad } = voice();
  const vad = Vad();
  const events: unknown[] = [];
  let t = 0;
  const feed = (level: number, ms: number, ratio?: number) => { for (let i = 0; i < ms / 30; i++) { t += 30; const ev = vad.feed(level, t, ratio); if (ev) events.push(plain(ev)); } };
  feed(0.002, 3000);
  assert.ok(vad.floor() < 0.003, 'the floor settles on the room');
  feed(0.02, 60); feed(0.002, 300);
  assert.deepEqual(events, [], 'a blip too short to start');
  feed(0.03, 500);
  assert.equal((events[0] as { type: string }).type, 'start');
  assert.equal(vad.speaking(), true);
  feed(0.002, 800);
  const end = events[1] as { type: string; from: number; to: number; ms: number };
  assert.equal(end.type, 'end');
  assert.ok(end.ms >= 400 && end.ms <= 600 && end.from < end.to, `an utterance of ${end.ms}ms`);
  assert.equal(vad.speaking(), false);
  feed(0.03, 200); feed(0.002, 800);
  assert.equal((events[3] as { type: string }).type, 'drop', 'too short to have been words');
  feed(0.03, 16000);
  const cut = events.filter(e => (e as { type: string }).type === 'end').at(-1) as unknown as { ms: number };
  assert.ok(cut.ms >= 14900 && cut.ms <= 15100, `a monologue is cut at the limit, not ${cut.ms}ms`);
  const quiet = Vad(); let tt = 0; for (let i = 0; i < 100; i++) { tt += 30; quiet.feed(0.002, tt); }
  assert.equal(quiet.feed(0.012, tt + 30, 7), null, 'with the ratio raised for her turn, that is not loud enough');
});

test('the conversation: her name wakes her, what follows is said, speaking over her cuts her off, silence puts her back to sleep', () => {
  const { Talk, wake } = voice();
  const talk = Talk({ wake, awakeMs: 25000 });
  assert.equal(talk.state(), 'off');
  assert.deepEqual(plain(talk.heard('hey haru', 0)), [], 'off is off');
  talk.start(0);
  assert.equal(talk.state(), 'asleep');
  assert.deepEqual(plain(talk.heard('so anyway, as I was saying', 100)), [], 'not for her');
  assert.deepEqual(plain(talk.heard('Hey Haru', 200)), [{ type: 'ack' }]);
  assert.equal(talk.state(), 'speaking');
  talk.spokeEnd(1200);
  assert.equal(talk.state(), 'awake');
  assert.deepEqual(plain(talk.heard('what is the weather like', 2000)), [{ type: 'say', text: 'what is the weather like', interrupted: false }]);
  assert.equal(talk.state(), 'thinking');
  assert.deepEqual(plain(talk.heard('and another thing', 2500)), [], 'not while she is thinking');
  assert.deepEqual(plain(talk.replied(4000, true)), [{ type: 'speaking' }]);
  assert.deepEqual(plain(talk.voiceStarted(5000)), [{ type: 'interrupt' }]);
  assert.equal(talk.state(), 'awake');
  assert.deepEqual(plain(talk.heard('no, stop, the other thing', 6000)), [{ type: 'say', text: 'no, stop, the other thing', interrupted: true }]);
  assert.deepEqual(plain(talk.replied(7000, false)), [{ type: 'awake' }]);
  assert.deepEqual(plain(talk.tick(20000)), []);
  assert.deepEqual(plain(talk.tick(7000 + 25000)), [{ type: 'asleep' }]);
  assert.deepEqual(plain(talk.heard('Haru, are you there', 40000)), [{ type: 'say', text: 'are you there', interrupted: false }], 'her name and the message in one breath');
  assert.deepEqual(plain(talk.stop()), [{ type: 'off' }]);
});

test('the wave file: 16 kHz mono 16-bit with a proper header, boxed down from the microphone rate', () => {
  const { wav } = voice();
  const frame = new Float32Array(4800); for (let i = 0; i < frame.length; i++) frame[i] = Math.sin(i / 10) * 0.5;
  const buf = wav([frame, frame], 48000, 16000) as ArrayBuffer;
  const dv = new DataView(buf);
  const tag = (at: number) => String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE'); assert.equal(tag(36), 'data');
  assert.equal(dv.getUint32(24, true), 16000);
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(buf.byteLength, 44 + 3200 * 2);
  assert.equal(dv.getUint32(40, true), 3200 * 2);
  const samples = new Int16Array(buf, 44);
  assert.ok(Math.max(...Array.from(samples).map(Math.abs)) > 10000, 'the signal survived');
});

test('opened by a tap, the ear starts awake — a tap is already her name — and drops to her name after the silence', () => {
  const { Talk, wake } = voice();
  const talk = Talk({ wake, awakeMs: 25000 });
  assert.deepEqual(plain(talk.start(0, true)), [{ type: 'awake' }]);
  assert.deepEqual(plain(talk.heard('what time is it', 1000)), [{ type: 'say', text: 'what time is it', interrupted: false }]);
  talk.replied(2000, false);
  assert.deepEqual(plain(talk.tick(2000 + 25000)), [{ type: 'asleep' }]);
  assert.deepEqual(plain(talk.heard('and the date', 30000)), [], 'asleep now: her name first');
  assert.deepEqual(plain(talk.heard('haru, and the date', 31000)), [{ type: 'say', text: 'and the date', interrupted: false }]);
});

// What she said on her own reaches the page, and the page hears about it.
//
// Tapping a notification used to open a page without the line on it: her
// unprompted lines are asides, not messages, and the page only drew messages.
// Now they are drawn as hers, without the rating dock (nothing to rate or ask
// again), and the worker tells an open page when a push lands or is tapped so
// the day is re-read.

test('an aside is drawn as hers, and never gets the rating dock', () => {
  const app = appPage();
  assert.ok(app.includes("(m.aside?'them aside':'them')"), 'asides are not marked');
  assert.ok(app.includes("m.role==='assistant'&&m.id&&!m.aside) html+=acts("), 'an aside would get a rating dock');
  assert.ok(app.includes(".them.aside {"), 'no style for an aside');
});

test('the worker tells the page when a push lands and when a notification is tapped', () => {
  const { serviceWorker } = require('../electron/webpage') as typeof import('../electron/webpage');
  const worker = serviceWorker();
  new vm.Script(worker, { filename: 'sw.js' });
  assert.ok(worker.includes("c.postMessage({type:'said'})"), 'a push does not reach an open page');
  assert.ok(worker.includes("client.postMessage({type:'opened'})"), 'a tap does not reach the page it focuses');
  const app = appPage();
  assert.ok(app.includes("e.data.type==='said'||e.data.type==='opened')) refreshIfIdle()"), 'the page does not listen');
  assert.ok(app.includes("if(!document.hidden){ refreshIfIdle();"), 'coming back does not re-read the day');
  assert.ok(app.includes("function refreshIfIdle(){ if($('cb').disabled) return;"), 'a re-read would clobber a reply in flight');
});

// -- the second tab -----------------------------------------------------------

/** The status-tab block, run the way the phone block above is: lifted out of
 *  the page and given only the handful of things it actually reaches for. */
function statusTab({ standing, fails = false }: { standing?: Record<string, unknown>; fails?: boolean } = {}) {
  const app = appPage();
  const start = app.indexOf('// ---- The second tab: where you stand with her');
  assert.ok(start > 0, 'the status block is no longer where this test can find it');
  const end = app.indexOf("document.addEventListener('visibilitychange'", start);
  assert.ok(end > start, 'the end of the status block moved');
  const source = app.slice(start, app.indexOf('\n', end) + 1);

  const made = new Map<string, Stub>();
  const el = (id: string): Stub => {
    if (!made.has(id)) made.set(id, { id, hidden: false, innerHTML: '', attrs: {} as Record<string, string>,
      setAttribute(name: string, value: string) { (this as Stub).attrs[name] = value; },
      addEventListener(name: string, fn: (e: Stub) => void) { (this as Stub).on = { ...(this as Stub).on, [name]: fn }; } });
    return made.get(id)!;
  };
  const screen = standing ?? {
    emotion: 'affectionate', face: 'love', mood: 'Warm towards you.',
    bond: { value: 62, level: 3, of: 5, title: 'Fond of you', note: 'She notices.', toNext: 16 },
    meters: [{ key: 'affection', label: 'Affection', value: 74, note: 'How warm she is.' },
             { key: 'stress', label: 'Stress', value: 80, note: 'Wound up.' }],
    patience: { key: 'patience', label: 'Patience', value: 100, note: 'Intact.' },
    grudge: { value: 3, of: 30, note: '3 unanswered.' },
    knownDays: 28, daysTalked: 12, minutesSinceSpoke: 90,
    waiting: [{ id: 'p', title: 'Get a present', when: 'yesterday', late: true },
              { id: 'v', title: 'Verge collection', when: 'Thursday, 5 days from now', late: false }],
    stale: [{ id: 'r', title: 'Rental Inspection', when: 'last Thursday, 9 days ago', late: true }],
  };
  const expressed: string[] = [];
  const timers: { every: number }[] = [];
  const ticked: string[] = [];
  const win: Stub = {
    JSON, Math, Promise, Set, Error, Object,
    $: el,
    esc: (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)),
    get: (url: string) => (fails ? Promise.reject(new Error('down'))
      : url === '/api/diary' ? Promise.resolve({ entries: [{ day: '2026-08-29', title: 'The night he said Boom', text: 'Tommy was a pain.\nI read about Elden Ring instead.' }, { day: '2026-08-28', title: 'Nothing much', text: 'Quiet.' }] })
      : url === '/api/her' ? Promise.resolve({ things: [{ name: 'Elden Ring', kind: 'game', since: '2026-08-29', nights: 2, because: 'to mock him', stance: 'Brilliant and cruel.', favourite: 'the freedom', wants: 'to beat a boss' }], adventures: [{ day: '2026-08-29', at: '', about: 'Elden Ring review', why: 'one of her things: Elden Ring', note: 'Read IGN.', sources: ['https://ign.example/x'] }], likes: [{ name: 'the freedom', of: 'Elden Ring' }], wants: [{ wish: 'to beat a boss', of: 'Elden Ring' }], diary: { entries: 1, since: '2026-08-29', latest: { day: '2026-08-29', title: 'The night he said Boom' } }, nightsOut: { count: 1, first: '2026-08-29' } })
      : Promise.resolve(JSON.parse(JSON.stringify(screen)))),
    post: (url: string, body: { id: string }) => { ticked.push(url + ':' + body.id); return Promise.resolve({}); },
    setInterval: (_fn: () => void, every: number) => { timers.push({ every }); return timers.length; },
    clearInterval: () => {},
    document: { hidden: false, addEventListener: () => {} },
    haruAvatar: { express: (name: string) => expressed.push(name) },
  };
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'status.js' });
  return { el, win, expressed, timers, made, ticked };
}

test('the status tab draws her standing, and the face follows it', async () => {
  const { el, win, expressed } = statusTab();
  await win.loadStatus();
  const html = String(el('status').innerHTML);
  assert.match(html, /Affectionate/);
  assert.match(html, /Fond of you/);
  assert.match(html, /3 \/ 5/);
  assert.match(html, /16 to go/);
  assert.match(html, /width:74%/);
  assert.match(html, /Get a present/);
  // Every row says when, and a late one is marked as such.
  assert.match(html, /<li class=late><span class=what>Get a present<span class=when>yesterday<\/span>/);
  assert.match(html, /Verge collection<span class=when>Thursday, 5 days from now/);
  // What she has given up asking about is kept apart, not mixed in and not hidden.
  assert.match(html, /She has stopped asking/);
  assert.match(html, /Rental Inspection/);
  assert.ok(html.indexOf('Waiting on you') < html.indexOf('She has stopped asking'));
  assert.match(html, /Known you <b>28<\/b> days/);
  assert.match(html, /Last word <b>1 hour ago<\/b>/);
  // The grudge arrives as a count and is drawn as a share of its own maximum.
  assert.match(html, /Held against you/);
  assert.match(html, /width:10%/);
  assert.deepEqual(expressed, ['affectionate']);
});

test('a high stress bar does not read as an achievement', () => {
  const { win } = statusTab();
  assert.equal(win.tone('stress', 80), 'warm');
  assert.equal(win.tone('sleepiness', 80), 'warm');
  assert.equal(win.tone('ego', 80), 'warm');
  assert.equal(win.tone('stress', 20), 'cool');
  // Everything else is plain accent, high or low.
  assert.equal(win.tone('affection', 90), '');
  assert.equal(win.tone('affection', 10), '');
});

test('how long ago she last heard from them, in words', () => {
  const { win } = statusTab();
  assert.equal(win.agoWords(null), 'not yet');
  assert.equal(win.agoWords(0), 'just now');
  assert.equal(win.agoWords(5), '5 min ago');
  assert.equal(win.agoWords(60), '1 hour ago');
  assert.equal(win.agoWords(200), '3 hours ago');
  assert.equal(win.agoWords(60 * 24), '1 day ago');
  assert.equal(win.agoWords(60 * 24 * 5), '5 days ago');
});

test('switching tabs takes the composer with the chat, and stops polling when it leaves', () => {
  const { el, win, timers } = statusTab();
  win.showTab('her');
  assert.equal(el('chat').hidden, true);
  assert.equal(el('status').hidden, false);
  assert.equal(el('cf').hidden, true, 'the composer stayed up on a screen with nothing to say to');
  assert.equal(el('chips').hidden, true);
  assert.equal(el('tab-her').attrs['aria-selected'], 'true');
  assert.equal(el('tab-chat').attrs['aria-selected'], 'false');
  assert.equal(timers.length, 1);
  win.showTab('chat');
  assert.equal(el('chat').hidden, false);
  assert.equal(el('status').hidden, true);
  assert.equal(el('cf').hidden, false);
  assert.equal(el('tab-chat').attrs['aria-selected'], 'true');
  // No second timer booked, and the first was cleared rather than left running.
  assert.equal(timers.length, 1);
});

test('a status that cannot be fetched says so once and does not blank what is there', async () => {
  const { el, win } = statusTab({ fails: true });
  await win.loadStatus();
  assert.match(String(el('status').innerHTML), /Could not reach her/);
  // With something already drawn, a failed refresh leaves it alone.
  el('status').innerHTML = '<h2>Curious</h2>';
  await win.loadStatus();
  assert.equal(el('status').innerHTML, '<h2>Curious</h2>');
});

test('nothing on her list means no empty section', async () => {
  const { el, win } = statusTab({ standing: {
    emotion: 'neutral', face: 'neutral', mood: 'Around.',
    bond: { value: 10, level: 0, of: 5, title: 'Nodding terms', note: 'She answers.', toNext: 10 },
    meters: [], patience: { key: 'patience', label: 'Patience', value: 100, note: 'Intact.' },
    grudge: { value: 0, of: 30, note: 'Nothing held against you.' },
    knownDays: 1, daysTalked: 1, minutesSinceSpoke: null, waiting: [], stale: [],
  } });
  await win.loadStatus();
  const html = String(el('status').innerHTML);
  assert.equal(html.includes('Waiting on you'), false);
  assert.equal(html.includes('She has stopped asking'), false);
  assert.match(html, /Known you <b>1<\/b> day[^s]/);
  assert.match(html, /Last word <b>not yet<\/b>/);
  assert.match(html, /As far as this goes|10 to go/);
});

test('ticking one off tells her, and redraws rather than guessing the new list', async () => {
  const { el, win, ticked } = statusTab();
  await win.loadStatus();
  const status = el('status');
  const pressed: string[] = [];
  const button = { getAttribute: () => 'p', set disabled(v: boolean) { pressed.push('disabled=' + v); }, closest: () => button } as unknown as Stub;
  await win.tickOff({ target: button });
  assert.deepEqual(ticked, ['/api/agenda/done:p']);
  assert.deepEqual(pressed, ['disabled=true']);
  // Redrawn from what came back, so a list that changed underneath is right.
  assert.match(String(status.innerHTML), /Get a present/);
  // A click on the card, not on a tick, does nothing at all.
  ticked.length = 0;
  win.tickOff({ target: { closest: () => null } });
  assert.deepEqual(ticked, []);
});

test('the diary tab reads like a diary, and takes the composer away with the chat', async () => {
  const { el, win } = statusTab();
  win.showTab('diary');
  assert.equal(el('diary').hidden, false);
  assert.equal(el('chat').hidden, true);
  assert.equal(el('status').hidden, true);
  assert.equal(el('cf').hidden, true);
  assert.equal(el('tab-diary').attrs['aria-selected'], 'true');
  await win.loadDiary();
  const html = String(el('diary').innerHTML);
  assert.match(html, /Haru’s Diary/);
  assert.match(html, /<span class=when>[^<]*29[^<]*August[^<]*<\/span>|<span class=when>[^<]*August[^<]*29[^<]*<\/span>/);
  assert.match(html, /Tommy was a pain\.\nI read about Elden Ring instead\./, 'line breaks kept, text escaped not summarised');
  // Each entry is a tab: date and title on the bar, the newest open, the rest closed.
  assert.match(html, /<details class=entry open><summary><span class=when>[^<]*<\/span><span class=title>The night he said Boom<\/span><\/summary>/);
  assert.match(html, /<details class=entry><summary><span class=when>[^<]*<\/span><span class=title>Nothing much<\/span>/);
  win.showTab('chat');
  assert.equal(el('diary').hidden, true);
  assert.equal(el('cf').hidden, false);
  // Nothing written yet says so, in her terms.
  win.drawDiary([]);
  assert.match(String(el('diary').innerHTML), /Nothing written yet/);
});

test('the tick button is actually wired to the status section, not just defined', () => {
  // The handler existed and the test called it directly; the page had lost the
  // line that attaches it, and the Done button did nothing on the phone.
  const html = appPage();
  assert.ok(html.includes("$('status').addEventListener('click',tickOff)"), 'tickOff must be registered on #status');
  assert.ok(html.includes("$('tab-diary').onclick=()=>showTab('diary')"), 'the diary tab must be wired');
});

test('under the standing: her things, what she rates and wants, her nights with sources, her diary', async () => {
  const { el, win } = statusTab();
  await win.loadStatus();
  // drawStatus leaves a slot and fetches her; the stub answers at once.
  await win.loadHer();
  const html = String(el('her').innerHTML);
  assert.match(html, /<h3>Her things<\/h3>/);
  assert.match(html, /<details class=fold><summary><span class=k>game · 2 nights · since [^<]*<\/span><span class=t>Elden Ring<\/span>/);
  assert.match(html, /Brilliant and cruel\./);
  assert.match(html, /Rates: the freedom/);
  assert.match(html, /What she rates<\/h3>[\s\S]*the freedom <span class=of>· Elden Ring/);
  assert.match(html, /What she wants<\/h3>[\s\S]*to beat a boss/);
  assert.match(html, /Her nights · 1<\/h3>/);
  assert.match(html, /one of her things: Elden Ring<\/span><span class=t>Elden Ring review/);
  assert.match(html, /<a href="https:\/\/ign\.example\/x" target=_blank rel=noopener>ign\.example\/x<\/a>/);
  assert.match(html, /Her diary<\/h3>[\s\S]*<b>1<\/b> entry[\s\S]*Latest: <b>The night he said Boom<\/b>/);
  // Nothing of her own yet says so, rather than an empty card.
  win.drawHer({ things: [], adventures: [], likes: [], wants: [], diary: { entries: 0 }, nightsOut: { count: 0 } });
  assert.match(String(el('her').innerHTML), /Nothing of her own yet/);
  assert.match(String(el('her').innerHTML), /Nothing written yet/);
});
