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
// The avatar block is the one part of the page that is not static markup: it
// takes the mood engine's word, finds the face for it, and crossfades. Driven
// here in a vm with a document of stubs, so what is checked is what the script
// does with a name — not what a browser does with an image.
function drive({ reduced = false, transition }: { reduced?: boolean; transition?: string } = {}) {
  const app = appPage();
  const anchor = app.indexOf('window.haruAvatar = {');
  const start = anchor < 0 ? -1 : app.lastIndexOf('(() => {', anchor);
  assert.ok(start > 0, 'the avatar block is no longer where this test can find it');
  const end = app.indexOf('})();', anchor);
  const source = app.slice(start, end + 5);
  const classes = () => { const set = new Set<string>(); return { add: (c: string) => { set.add(c); }, remove: (c: string) => { set.delete(c); }, contains: (c: string) => set.has(c) }; };
  const img = () => {
    const el: any = { classList: classes(), style: {} as Record<string, string>, onload: null as null | (() => void), onerror: null as null | (() => void), removeAttribute() {}, current: '' };
    Object.defineProperty(el, 'src', { get: () => el.current, set: (value: string) => { el.current = value; if (el.onload) el.onload(); } });
    return el;
  };
  const faces = [img(), img()];
  const box: any = { attrs: {} as Record<string, string>, classList: classes(), offsetWidth: 1, setAttribute(k: string, v: string) { this.attrs[k] = v; }, getAttribute(k: string) { return this.attrs[k] ?? null; }, querySelectorAll: () => faces };
  const host: any = { dataset: transition === undefined ? {} : { transition }, style: { vars: {} as Record<string, string>, setProperty(k: string, v: string) { this.vars[k] = v; } }, innerHTML: '' };
  const timers: (() => void)[] = [];
  const win: any = {
    Math, JSON, Number, Array, Object, String, Boolean, Map, Set,
    document: { getElementById: (id: string) => (id === 'stage' ? host : id === 'avatar' ? box : null) },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (cb: () => void) => { timers.push(cb); return timers.length; },
    clearTimeout: () => { timers.length = 0; },
  };
  win.window = win;
  vm.runInContext(source, vm.createContext(win), { filename: 'avatar.js' });
  const shown = () => faces.find(face => face.classList.contains('on'));
  return { avatar: win.haruAvatar, box, faces, host, shown, fire: () => { for (const cb of timers.splice(0)) cb(); } };
}

test('the mood engine’s word becomes the face for it, said out loud, from her own server', () => {
  const { avatar, box, shown } = drive();
  assert.equal(avatar.state().emotion, 'neutral');
  avatar.express('determined');
  assert.equal(avatar.state().emotion, 'excited');
  assert.equal(box.getAttribute('aria-label'), 'Haru feeling excited');
  assert.equal(shown()?.src, '/emotions/excited.svg');
  avatar.express('affectionate');
  assert.equal(shown()?.src, '/emotions/love.svg');
  avatar.express('no such mood');
  assert.equal(avatar.state().emotion, 'neutral');
});

test('thinking holds until the mood lands, and otherwise settles back on its own', () => {
  const { avatar, fire } = drive();
  avatar.express('happy');
  avatar.think();
  assert.equal(avatar.state().emotion, 'thinking');
  fire();
  assert.equal(avatar.state().emotion, 'happy', 'left thinking too long, she goes back to how she was');
  avatar.think();
  avatar.express('smug');
  assert.equal(avatar.state().emotion, 'smug', 'the reply’s mood ends the thinking');
});

test('a poke is a face for a moment, then back to how she was', () => {
  const { avatar, fire } = drive();
  avatar.express('curious');
  avatar.poke('exclaim');
  assert.equal(avatar.state().emotion, 'angry');
  fire();
  assert.equal(avatar.state().emotion, 'curious');
  avatar.poke('not a thing');
  assert.equal(avatar.state().emotion, 'curious');
});

test('the crossfade runs for the configured time, and not at all when motion is reduced', () => {
  const timed = drive({ transition: '150' });
  timed.avatar.express('happy');
  assert.equal(timed.shown()?.style.transition, 'opacity 150ms ease');
  const still = drive({ reduced: true });
  still.avatar.express('happy');
  assert.equal(still.shown()?.style.transition, 'none');
  const dialled = drive();
  dialled.avatar.setTransition(0);
  dialled.avatar.express('sad');
  assert.equal(dialled.shown()?.style.transition, 'none');
  dialled.avatar.setSize(320);
  assert.equal(dialled.host.style.vars['--avatar-size'], '320px');
});

test('a face whose file is missing shows nothing, not a broken image', () => {
  const { avatar, faces } = drive();
  avatar.express('sad');
  const face = faces.find(f => f.src === '/emotions/sad.svg')!;
  face.onerror?.();
  assert.ok(face.classList.contains('missing'));
});

test('the old engine is gone from the page, and the faces come from her own server', () => {
  const html = appPage();
  assert.ok(!/bloub/i.test(html), 'a bloub reference survives on the page');
  assert.ok(html.includes("'/emotions/'"));
  assert.ok(html.includes('prefers-reduced-motion'));
  assert.ok(html.includes('role=img'));
});
