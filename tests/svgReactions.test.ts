import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { SVG_REACTIONS, EXPRESSION_REACTIONS, TAP_REACTIONS } from '../src/companion/svgReactions';
import { ANIMATION_SYMBOLS } from '../src/companion/svgSymbols';
import { emotionConfig, isHaruEmotion } from '../electron/emotions';

test('all new expressions have layered artwork and an arrival reaction', () => {
  assert.equal(Object.keys(EXPRESSION_REACTIONS).length, 28);
  const eyeShapes = new Set<string>();
  for (const [face, reaction] of Object.entries(EXPRESSION_REACTIONS)) {
    assert.ok(isHaruEmotion(face)); assert.ok(SVG_REACTIONS[reaction]);
    const svg = readFileSync('build/emotions/' + emotionConfig[face].file, 'utf8');
    for (const part of ['eye-left', 'eye-right', 'ear-left', 'ear-right', 'tuft', 'fringe']) assert.equal(svg.split(`data-part="${part}"`).length, 2, face + ' ' + part);
    assert.equal((svg.match(/data-hair=/g) || []).length, 6);
    assert.ok(svg.includes(`id="${face}-fringe-cut"`));
    eyeShapes.add(svg.match(/<path[^>]*data-part="eye-left"[^>]*>/)?.[0] || '');
  }
  assert.equal(eyeShapes.size, 28, 'each expression has distinct eye artwork');
});

test('all requested animations and arrival reactions have complete timelines', () => {
  const requested = ['listening', 'head-pat', 'curiosity', 'head-shake', 'attention-return', 'sleep-transition'];
  requested.forEach(name => assert.ok(SVG_REACTIONS[name], name));
  for (const [name, reaction] of Object.entries(SVG_REACTIONS)) {
    assert.ok(reaction.duration >= 1000 && reaction.duration <= 7000);
    assert.equal(new Set(reaction.tracks.map(t => t.part)).size, reaction.tracks.length, name + ' has no competing tracks');
    for (const track of reaction.tracks) {
      assert.equal(track.frames[0].offset, 0); assert.equal(track.frames.at(-1)!.offset, 1);
      track.frames.forEach((frame, i) => {
        assert.ok(Number.isFinite(frame.offset));
        if (i) assert.ok(frame.offset! > track.frames[i - 1].offset!);
        assert.ok(!JSON.stringify(frame).match(/NaN|undefined|Infinity/));
      });
      if (!reaction.hold) {
        const { offset: start, ...first } = track.frames[0], { offset: end, ...last } = track.frames.at(-1)!;
        assert.deepEqual(first, last, name + ' returns to its starting pose');
      }
    }
  }
  const sleep = SVG_REACTIONS['sleep-transition'];
  assert.ok(sleep.hold);
  assert.equal(sleep.tracks.find(t => t.part === 'gaze')!.frames.at(-1)!['--lid'], '0.03');
});

// Exercise the actual animation orchestration without a browser or UI access.
function drive() {
  const source = readFileSync('src/components/SvgAvatarCanvas.tsx', 'utf8');
  const code = source.slice(source.indexOf('    function tap('), source.indexOf("    motionPreference.addEventListener('change'"));
  const created: any[] = [];
  const element = () => ({ style: {}, attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; },
    animate(frames: unknown, options: any) { const a: any = { effect: { target: this }, frames, options, cancelled: false, cancel() { this.cancelled = true; } }; created.push(a); return a; },
  });
  const parts = Object.fromEntries(['ear-left', 'ear-right', 'eye-right', 'tuft', 'accent-left', 'accent-right'].map(name => [name, element()]));
  const animations = new Map(), reactionAnimations = new Set(), box = element(), symbols: any[] = [];
  const context: any = { SVG_REACTIONS, TAP_REACTIONS, tapIndex: 0, dragPoint: null, dragVelocity: {x:0,y:0}, dragEl: element(), dragShape: [1,0,1,0], dragSpeed: [0,0,0,0], animations, reactionAnimations, box, gestureEl: element(),
    ANIMATION_SYMBOLS, showSymbol(name: string, options: any) { symbols.push({ name, options }); }, clearSymbol() { symbols.push(null); },
    faces: [{ querySelector: (selector: string) => parts[selector.match(/"(.*?)"/)![1]] }], front: 0,
    reactionName: '', reactionStart: 0, reactionUntil: 0, lastMotion: 0, nextEarTwitch: 0,
    motionPreference: { matches: false }, reduced: false, frozenAt: null, hairFrame: 0, hairLayers: new Map(),
    engine: { emotion: () => 'neutral' }, LABELS: { neutral: 'Haru feeling neutral' },
    clock: () => 1000, target: () => ({ x: 0 }), scheduleBlink() {}, look() {}, followHair() {},
    cancelAnimationFrame() {}, requestAnimationFrame: () => 1, EASE_OUT_CSS: 'ease-out',
  };
  vm.runInNewContext(stripTypeScriptTypes(code) + '\nglobalThis.controls = { play, tap, drag, stopReaction, onMotionPreference };', context);
  return { ...context.controls, context, created, animations, box, symbols };
}

test('replaying or replacing a reaction cancels the old tracks, including held sleep', () => {
  const d = drive(); d.play('sleep-transition');
  const asleep = [...d.created]; assert.equal(d.context.reactionUntil, Infinity);
  asleep.forEach(a => a.onfinish()); assert.equal(d.animations.size, 4);
  d.play('head-pat'); assert.ok(asleep.every(a => a.cancelled)); assert.equal(d.animations.size, 4);
  const pat = d.created.slice(4); d.play('head-pat'); assert.ok(pat.every((a: any) => a.cancelled));
  d.stopReaction(); assert.equal(d.animations.size, 0); assert.equal(d.context.reactionUntil, 0);
  assert.equal(d.box.attrs['data-reaction'], undefined);
});

test('reduced motion cancels held reactions and prevents new ones; unknown names do nothing', () => {
  const d = drive(); d.play('sleep-transition'); const count = d.created.length;
  d.play('toString'); assert.equal(d.created.length, count); assert.equal(d.context.reactionUntil, Infinity);
  d.context.motionPreference.matches = true; d.onMotionPreference();
  assert.ok(d.created.every((a: any) => a.cancelled)); assert.equal(d.animations.size, 0);
  d.play('curiosity'); assert.equal(d.created.length, count);
  d.context.motionPreference.matches = false; d.onMotionPreference(); d.play('curiosity');
  assert.equal(d.created.length, count + SVG_REACTIONS.curiosity.tracks.length);
});

test('hair cues follow listening and startle timing without clearing the source contour', () => {
  const d = drive(), source = {};
  d.play('listening', source);
  assert.equal(d.symbols.length, 1, 'no cancellation before sampling the visible outline');
  assert.equal(d.symbols[0].name, 'hair-surprise'); assert.equal(d.symbols[0].options.duration, 2300);
  assert.equal(d.symbols[0].options.source, source);
  d.play('startle'); assert.equal(d.symbols.at(-1).options.rise, 140);
  d.play('sleep-transition'); assert.equal(d.symbols.at(-1).options.hold, true);
  d.play('ear-twitch'); assert.equal(d.symbols.at(-1), null, 'waking clears held hair too');
});

test('reference reactions animate every authored part and release tracks when replaced', () => {
  const d = drive();
  for (const name of Object.values(EXPRESSION_REACTIONS)) {
    const before = d.created.length, previous = d.created.slice();
    d.play(name);
    assert.ok(previous.every((a: any) => a.cancelled));
    assert.equal(d.created.length - before, SVG_REACTIONS[name].tracks.length, name);
    assert.equal(d.symbols.at(-1).name, ANIMATION_SYMBOLS[name]);
  }
  d.stopReaction(); assert.equal(d.animations.size, 0);
});


test('ten taps give ten distinct shapes and hair cues; dragging cancels taps and reduced motion stays still', () => {
  const d = drive(), seen = new Set<string>(), shapes = new Set<string>();
  for (let i = 0; i < 10; i++) {
    d.tap(); const name = d.box.attrs['data-reaction'];
    seen.add(name); shapes.add(JSON.stringify(SVG_REACTIONS[name].tracks.find(t => t.part === 'head')));
    assert.equal(d.symbols.at(-1).name, ANIMATION_SYMBOLS[name]);
  }
  assert.equal(seen.size, 10); assert.equal(shapes.size, 10);
  d.drag({ x: 10, y: 20 }); assert.equal(d.context.reactionUntil, 0);
  const count = d.created.length; d.tap(); assert.equal(d.created.length, count);
  d.context.clock = () => 1016; d.drag({ x: 26, y: 12 });
  assert.equal(d.context.dragVelocity.x, 1000); assert.equal(d.context.dragVelocity.y, -500);
  d.drag(null); d.tap(); assert.equal(d.box.attrs['data-reaction'], TAP_REACTIONS[0]);
  d.context.motionPreference.matches = true; d.onMotionPreference();
  const still = d.created.length; d.tap(); assert.equal(d.created.length, still);
  assert.equal(d.context.dragPoint, null); assert.deepEqual(Array.from(d.context.dragShape), [1,0,1,0]);
});
