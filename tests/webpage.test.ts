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
// Two things are checked here. The engine, with numbers: it is pure and
// clock-free, so a time goes in and a frame comes out, and what it does when a
// face changes mid-fade can be asserted to the decimal. And the renderer, in a
// vm with a document of stubs and a fetch that answers at once: what the page
// script does with a name, including hiding the black square the files ship.
const FACE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 1254.00 1254.00"><path fill="#000000" d="M 1254.00 0.00 L 1254.00 1254.00 L 0.00 1254.00 L 0.00 0.00 L 1254.00 0.00 Z"/><path fill="#fec4cc" d="M 10 10 L 20 20 Z"/></svg>';
function drive({ reduced = false, transition, frozenAt, missing = [] as string[] }: { reduced?: boolean; transition?: string; frozenAt?: string; missing?: string[] } = {}) {
  const app = appPage();
  const anchor = app.indexOf('window.haruAvatar = {');
  const start = anchor < 0 ? -1 : app.lastIndexOf('(() => {', app.indexOf('window.HaruEmotionEngine ='));
  assert.ok(start > 0, 'the avatar block is no longer where this test can find it');
  const end = app.indexOf('})();', anchor);
  const source = app.slice(start, end + 5);
  const classes = () => { const set = new Set<string>(); return { add: (c: string) => { set.add(c); }, remove: (c: string) => { set.delete(c); }, contains: (c: string) => set.has(c) }; };
  // A stub element: attributes, a class list, and children for replaceChildren.
  const element = (name: string, attrs: Record<string, string> = {}) => {
    const el: any = { nodeName: name, attrs: { ...attrs }, classList: classes(), style: {} as Record<string, string>, children: [] as any[],
      getAttribute(k: string) { return this.attrs[k] ?? null; }, setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; },
      replaceChildren(...nodes: any[]) { this.children = nodes; }, querySelectorAll(sel: string) { return this.children.flatMap((c: any) => sel.includes(c.nodeName) ? [c] : []); } };
    return el;
  };
  // A parser that understands exactly the face above: an svg with two paths.
  const parse = (text: string) => {
    const svg = element('svg', { viewBox: text.match(/viewBox="([^"]+)"/)![1] });
    svg.children = [...text.matchAll(/<path ([^>]*)\/>/g)].map(m => element('path', Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]))));
    return { documentElement: svg };
  };
  const faces = [element('div'), element('div')];
  const box: any = { ...element('div'), offsetWidth: 1, querySelectorAll: () => faces };
  const dataset: Record<string, string> = {}; if (transition !== undefined) dataset.transition = transition; if (frozenAt !== undefined) dataset.frozenAt = frozenAt;
  const host: any = { dataset, style: { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } }, innerHTML: '' };
  box.style = { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } };
  const timers: (() => void)[] = [];
  let now = 1000;
  const win: any = {
    Math, JSON, Number, Array, Object, String, Boolean, Map, Set, Promise, Error,
    document: { getElementById: (id: string) => (id === 'stage' ? host : id === 'avatar' ? box : null), adoptNode: (n: any) => n },
    DOMParser: function () { return { parseFromString: parse }; },
    fetch: (url: string) => { const name = url.replace('/emotions/', '').replace('.svg', ''); return Promise.resolve({ ok: !missing.includes(name), status: missing.includes(name) ? 404 : 200, text: () => Promise.resolve(FACE) }); },
    matchMedia: () => ({ matches: reduced }),
    performance: { now: () => now },
    setTimeout: (cb: () => void) => { timers.push(cb); return timers.length; },
    clearTimeout: () => { timers.length = 0; },
  };
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'avatar.js' });
  const shown = () => faces.find(face => face.classList.contains('on'));
  // The fetch answers on the microtask queue; a few turns of it are enough.
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  return { avatar: win.haruAvatar, Engine: win.HaruEmotionEngine, box, faces, host, shown, flush, tick: (ms: number) => { now += ms; }, fire: () => { for (const cb of timers.splice(0)) cb(); } };
}

test('the engine is clock-free: a time in, a frame out, eased and never overshooting', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  const plain = (frame: unknown) => JSON.parse(JSON.stringify(frame));
  assert.deepEqual(plain(engine.sample(0)), { emotion: 'neutral', previousEmotion: null, transitionProgress: 1, opacity: 1, previousOpacity: 0, transitioning: false });
  assert.equal(engine.set('happy', 1000), true);
  assert.equal(engine.set('happy', 1000), false, 'the same face again is not a change');
  const mid = engine.sample(1100);
  assert.equal(mid.emotion, 'happy'); assert.equal(mid.previousEmotion, 'neutral'); assert.equal(mid.transitioning, true);
  assert.ok(mid.opacity > 0.5 && mid.opacity < 1, `ease-out is past half way at half time (${mid.opacity})`);
  assert.ok(Math.abs(mid.opacity + mid.previousOpacity - 1) < 1e-9, 'the two faces always add up to one');
  const done = engine.sample(1200);
  assert.equal(done.opacity, 1); assert.equal(done.previousOpacity, 0); assert.equal(done.transitioning, false);
  assert.equal(engine.sample(5000).opacity, 1, 'never above one, however late');
  assert.deepEqual(plain(engine.sample(1150)), plain(engine.sample(1150)));
});

test('a face that changes mid-fade starts from what is visible — nothing jumps', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  engine.set('happy', 1000);
  const before = engine.sample(1050);
  engine.set('angry', 1050);
  const after = engine.sample(1050);
  assert.equal(after.emotion, 'angry'); assert.equal(after.previousEmotion, 'happy');
  assert.equal(after.previousOpacity, before.opacity, 'the leaving face keeps the opacity it had');
  assert.equal(after.opacity, 0, 'the arriving face starts from nothing');
  let t = 1050;
  for (const face of ['sad', 'excited', 'neutral', 'happy']) { t += 30; engine.set(face, t); const f = engine.sample(t + 10); assert.ok(f.opacity >= 0 && f.opacity <= 1 && f.previousOpacity >= 0 && f.previousOpacity <= 1, face); }
  assert.equal(engine.sample(t + 1000).emotion, 'happy');
});

test('how she moves is a pure function of time and face: subtle, periodic, and faster excited than sleepy', () => {
  const { Engine } = drive();
  const engine = Engine({ duration: () => 200 });
  const a = engine.idle(1234), b = engine.idle(1234);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(Math.abs(engine.idle(0).bob - engine.idle(a.periodMs).bob) < 1e-9, 'a period later she is where she was');
  assert.ok(Math.abs(a.bob) <= 10 && Math.abs(a.sway) <= 4 && a.breath >= 1 && a.breath <= 1.05);
  engine.set('excited', 0); const quick = engine.idle(0).periodMs;
  engine.set('sleepy', 0); const slow = engine.idle(0).periodMs;
  assert.ok(quick < slow);
});

test('the mood engine’s word becomes the face for it, as the SVG itself, with the black square hidden', async () => {
  const { avatar, box, shown, flush } = drive();
  avatar.express('determined');
  await flush();
  assert.equal(avatar.state().emotion, 'excited');
  assert.equal(box.getAttribute('aria-label'), 'Haru feeling excited');
  const svg = shown()?.children[0];
  assert.equal(svg?.nodeName, 'svg', 'the face is the SVG itself, not an image of it');
  assert.equal(svg.getAttribute('viewBox'), '0.00 0.00 1254.00 1254.00', 'the artwork keeps its own viewBox');
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'xMidYMid meet', 'never stretched');
  const [backdrop, art] = svg.children;
  assert.equal(backdrop.getAttribute('class'), 'backdrop', 'the full-canvas black path is marked for hiding');
  assert.equal(art.getAttribute('class'), null, 'her own paths are untouched');
  assert.equal(box.style.vars['--idle-period'], '2200ms', 'excited moves at its own speed');
  assert.ok(box.classList.contains('changed'), 'a change of face settles');
  avatar.express('no such mood'); await flush();
  assert.equal(avatar.state().emotion, 'neutral');
});

test('thinking holds until the mood lands, and otherwise settles back on its own', async () => {
  const { avatar, fire, flush } = drive();
  avatar.express('happy'); avatar.think(); await flush();
  assert.equal(avatar.state().emotion, 'thinking');
  fire(); await flush();
  assert.equal(avatar.state().emotion, 'happy', 'left thinking too long, she goes back to how she was');
  avatar.think(); avatar.express('smug'); await flush();
  assert.equal(avatar.state().emotion, 'smug', 'the reply’s mood ends the thinking');
});

test('a poke is a face for a moment, then back to how she was', async () => {
  const { avatar, fire, flush } = drive();
  avatar.express('curious'); avatar.poke('exclaim'); await flush();
  assert.equal(avatar.state().emotion, 'angry');
  fire(); await flush();
  assert.equal(avatar.state().emotion, 'curious');
});

test('the crossfade runs for the configured time with the engine’s easing, and not at all when motion is reduced', async () => {
  const timed = drive({ transition: '150' });
  timed.avatar.express('happy'); await timed.flush();
  assert.equal(timed.shown()?.style.transition, 'opacity 150ms cubic-bezier(0.33, 1, 0.68, 1)');
  const still = drive({ reduced: true });
  still.avatar.express('happy'); await still.flush();
  assert.equal(still.shown()?.style.transition, 'none');
  assert.equal(still.avatar.state().transitionProgress, 1);
  assert.equal(still.box.classList.contains('changed'), false, 'no settle when motion is reduced');
  const dialled = drive();
  dialled.avatar.setTransition(0); dialled.avatar.express('sad'); await dialled.flush();
  assert.equal(dialled.shown()?.style.transition, 'none');
  dialled.avatar.setSize(320);
  assert.equal(dialled.host.style.vars['--avatar-size'], '320px');
});

test('frozen, the exact frame for that instant is drawn and nothing moves', async () => {
  const { avatar, faces, tick, shown, box, flush } = drive({ transition: '200' });
  avatar.express('happy'); await flush();
  tick(100);
  avatar.freeze();
  const frame = avatar.sample();
  assert.equal(avatar.state().frozen, true);
  assert.ok(frame.transitioning, 'frozen half way through the fade');
  assert.ok(box.classList.contains('frozen'), 'the idle float is paused');
  assert.equal(shown()?.style.transition, 'none');
  assert.equal(Number(shown()?.style.opacity).toFixed(4), frame.opacity.toFixed(4));
  assert.equal(Number(faces.find(f => f !== shown())?.style.opacity).toFixed(4), frame.previousOpacity.toFixed(4));
  avatar.notify();
  assert.equal(box.classList.contains('pop'), false, 'a pop is playback, and playback is stopped');
  avatar.play();
  assert.equal(avatar.state().frozen, false);
  const fromAttribute = drive({ frozenAt: '0' });
  assert.equal(fromAttribute.avatar.state().frozen, true);
});

test('a face whose file is missing shows nothing, not a broken image; a newer face wins a race', async () => {
  const gone = drive({ missing: ['sad'] });
  gone.avatar.express('sad'); await gone.flush();
  assert.ok(gone.faces.some(f => f.classList.contains('missing')));
  const race = drive();
  race.avatar.express('happy'); race.avatar.express('angry'); await race.flush();
  assert.equal(race.avatar.state().emotion, 'angry');
  assert.equal(race.shown()?.children[0]?.nodeName, 'svg');
});

test('the old engine is gone from the page, and the faces come from her own server', () => {
  const html = appPage();
  assert.ok(!/bloub/i.test(html), 'a bloub reference survives on the page');
  assert.ok(html.includes("'/emotions/'"));
  assert.ok(html.includes('prefers-reduced-motion'));
  assert.ok(html.includes('role=img'));
  assert.ok(html.includes('.backdrop { display:none; }'), 'the black square is hidden on the page, not in the file');
});
