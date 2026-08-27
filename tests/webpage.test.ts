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

// The bloub, driven.
//
// Everything above treats webpage.ts as the static asset it mostly is. The one
// part that is not static is the bloub block: ~700 lines of geometry that ship
// as a string, so nothing type-checks it and nothing has ever run it. It is
// however written to be runnable — sample(t) is a pure function of time, with no
// clock of its own — so it can be lifted out of the page, given a stub DOM and
// stepped by hand.
//
// What is pinned here is continuity, because that is the failure this shape can
// have without anything throwing. blend() normalises a rotation delta to the
// shortest arc, which is right for two still poses and wrong for a rotation that
// keeps winding: orbit's did, and the frame its delta crossed π the blend
// reversed and the whole body jumped. No error, no log — she just twitched.
// Lift the block out of the page, give it somewhere to draw, and hand back a
// step() that advances it one frame at 60fps.
function drive() {
  const app = appPage();
  const anchor = app.indexOf('const TAU = Math.PI * 2;');
  const start = anchor < 0 ? -1 : app.lastIndexOf('(() => {', anchor);
  assert.ok(start > 0, 'the bloub block is no longer where this test can find it');
  const source = app.slice(start, app.lastIndexOf('</script>'));

  // Just enough DOM for the block to install itself and draw into.
  const nodes = new Map<string, any>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, attrs: {} as Record<string, string>, style: {}, innerHTML: '',
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      getAttribute(k: string) { return this.attrs[k] ?? null; } });
    return nodes.get(id);
  };
  let tick: ((ms: number) => void) | null = null;
  const win: any = {
    Math, JSON, Number, Array, Object, String, Boolean, Map, Set, Infinity, NaN,
    document: { getElementById: node, addEventListener() {} },
    requestAnimationFrame: (cb: (ms: number) => void) => { tick = cb; return 1; },
    // No fine pointer, so the gaze-follow branch stays out of the way.
    matchMedia: () => ({ matches: false }),
    addEventListener() {}
  };
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'bloub.js' });
  assert.ok(tick, 'the block never asked for a frame');

  let frame = 0;
  const step = () => (tick as (ms: number) => void)((++frame / 60) * 1000);
  return { bloub: win.bloub, node, step, at: () => frame / 60 };
}

test("she never jumps: the body moves a body's worth per frame, not a screen's", () => {
  const { bloub, node, step } = drive();

  // determined is the mood that puts her in orbit — the one state whose rotation
  // winds far enough to reach the wrap. Going through express() rather than
  // poking the engine also pins that mapping.
  bloub.express('determined');
  assert.equal(bloub.state().cur, 'orbit', 'determined no longer reaches orbit');

  // The body is drawn at radius 100 in a 316-wide viewBox, and orbit turns at
  // 1.25 revolutions a second, so at 60fps a point on the rim travels about 14
  // units between frames. The wrap moved it 130 — a third of the frame, in 16ms.
  // 40 is clear of honest motion and nowhere near a reversal.
  const coords = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let previous: number[] | null = null;
  let worst = 0;
  let worstAt = 0;
  for (let frame = 1; frame <= 90; frame++) {
    step();
    const d = node('bBody').getAttribute('d');
    assert.ok(d && !d.includes('NaN'), `frame ${frame} drew nothing usable: ${d}`);
    const now = coords(d);
    if (previous && previous.length === now.length) {
      for (let i = 0; i < now.length; i++) {
        const moved = Math.abs(now[i] - previous[i]);
        if (moved > worst) { worst = moved; worstAt = frame / 60; }
      }
    }
    previous = now;
  }
  assert.ok(worst < 40, `the body jumped ${worst.toFixed(1)} units in one frame at ${worstAt.toFixed(2)}s`);
});

// What she does when nobody is talking to her, which is nearly all of the time.
//
// idle is the state she rests in; wink and wide are gestures. Held as resting
// states in their own right — three to six seconds each, either free to follow
// the other — they took up half her idle time and ran sequences like wink, wide,
// wink, wide. Nothing was broken and nothing threw. She just read as twitchy,
// and a wink held for four seconds is not a wink.
//
// So: a gesture lasts as long as the catalogue says the gesture lasts, and is
// bracketed by idle on both sides. This pins the shape of that, not the numbers
// - the thresholds are wide enough that only a real change in kind trips them.
test('at rest she is mostly still, and a gesture stays a gesture', () => {
  const { bloub, step } = drive();

  const held: Record<string, number> = {};
  const order: string[] = [];
  let last = '';
  for (let i = 0; i < 5 * 60 * 60; i++) {    // five minutes at 60fps
    step();
    const cur = bloub.state().cur as string;
    held[cur] = (held[cur] ?? 0) + 1 / 60;
    if (cur !== last) { order.push(cur); last = cur; }
  }

  const total = Object.values(held).reduce((a, b) => a + b, 0);
  const idle = (held['idle'] ?? 0) / total;
  assert.ok(idle > 0.8, `she rests in idle only ${(idle * 100).toFixed(0)}% of the time`);

  // Two gestures in a row is the tic this is here to prevent.
  const runOn = order.filter((s, i) => i > 0 && s !== 'idle' && order[i - 1] !== 'idle');
  assert.deepEqual(runOn, [], `a gesture followed another with no idle between: ${runOn.join(', ')}`);

  // And she does still do them - stillness that never breaks is its own problem.
  assert.ok(order.length > 10, `only ${order.length} changes in five minutes; she has gone static`);
});
