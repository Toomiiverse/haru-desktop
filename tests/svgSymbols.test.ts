import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { REACTION_SYMBOLS, HAIR_SYMBOLS, EXPRESSION_SYMBOLS, ANIMATION_SYMBOLS, symbolSvg, symbolFrames, hairSymbolFrames } from '../src/companion/svgSymbols';
import { EXPRESSION_REACTIONS } from '../src/companion/svgReactions';

const outline = (radius: number, reverse = false): any => ({ getTotalLength: () => 128, getPointAtLength: (t: number) => ({ x: 623 + Math.sin(t / 128 * Math.PI * 2 * (reverse ? -1 : 1)) * radius, y: 384 - radius + Math.cos(t / 128 * Math.PI * 2) * radius }) });

test('cartoon hair changes size, flexes its base and returns to the authored outline', () => {
  const frames = hairSymbolFrames(outline(100), outline(60, true));
  for (const frame of frames) {
    assert.match(String(frame.d), /^path\("M /);
    assert.equal((String(frame.d).match(/ C /g) || []).length, 128);
    assert.ok(!String(frame.d).match(/NaN|Infinity/));
  }
  assert.equal(frames[0].d, frames.at(-1)!.d);
  const roots = frames.map(frame => String(frame.d).match(/^path\("M ([\d.-]+) ([\d.-]+)/)!.slice(1).map(Number));
  assert.ok(new Set(roots.map(p => p.join(','))).size > 4, 'the base travels with the cartoon recoil');
  roots.forEach(([x,y]) => { assert.ok(Math.abs(x - 623) <= 10 && y >= 384 && y <= 394, 'root stays inside the crown'); });
  const still = hairSymbolFrames(outline(100), outline(60, true), outline(100), 2800, 320, false, 0);
  const height = (frame: Keyframe) => { const n = String(frame.d).match(/-?\d+\.\d+/g)!.map(Number).filter((_,i)=>i%2); return Math.max(...n)-Math.min(...n); };
  assert.ok(height(frames[1]) < height(still[1]) * .8, 'visible anticipation squash');
  assert.ok(height(frames[2]) > height(still[2]) * 1.2, 'visible stretchy peak');
  assert.notEqual(frames[5].d, frames[6].d, 'the readable symbol beat keeps moving');
  const interrupted = hairSymbolFrames(outline(80), outline(60), outline(100));
  assert.notEqual(interrupted[0].d, frames[0].d, 'starts from the currently visible contour');
  assert.equal(interrupted.at(-1)!.d, frames.at(-1)!.d, 'returns to the authored heart');
  assert.throws(() => hairSymbolFrames({ getTotalLength: () => 0 } as any, outline(60)), /Invalid/);
  const fast = hairSymbolFrames(outline(100), outline(60), outline(100), 1800, 140);
  assert.equal(fast[2].offset! * 1800, 140, 'startle forms its cue with the first head recoil');
  for (const mark of Object.values(HAIR_SYMBOLS)) {
    const timed = hairSymbolFrames(outline(100), outline(60), outline(100), 1700, mark.rise);
    timed.forEach((frame, i) => { if (i) assert.ok(frame.offset! > timed[i - 1].offset!); });
  }
  const held = hairSymbolFrames(outline(100), outline(60), outline(100), 6500, 760, true);
  assert.notEqual(held[0].d, held.at(-1)!.d, 'sleep keeps the relaxed curl');
  const shifted = outline(80), originalPoint = shifted.getPointAtLength;
  shifted.getPointAtLength = (t: number) => { const p = originalPoint(t); return { x: p.x + 9, y: p.y + 7 }; };
  assert.match(String(hairSymbolFrames(shifted, outline(60))[0].d), /^path\("M 632.00 391.00/, 'interruptions retain the moving base');
});

test('symbols and automatic mappings are allowlisted, bounded and self-contained', () => {
  assert.equal(Object.keys(REACTION_SYMBOLS).length, 13); assert.equal(Object.keys(HAIR_SYMBOLS).length, 5);
  assert.equal(EXPRESSION_SYMBOLS.attentive, 'hair-surprise');
  for (const [face, reaction] of Object.entries(EXPRESSION_REACTIONS)) {
    assert.equal(EXPRESSION_SYMBOLS[face], ANIMATION_SYMBOLS[reaction], face + ' and its animation share a hair cue');
    assert.ok(Object.hasOwn(HAIR_SYMBOLS, EXPRESSION_SYMBOLS[face]));
  }
  for (const mark of Object.values(HAIR_SYMBOLS)) assert.ok(Object.hasOwn(REACTION_SYMBOLS, mark.fallback));
  for (const name of [...Object.values(EXPRESSION_SYMBOLS), ...Object.values(ANIMATION_SYMBOLS)]) assert.ok(Object.hasOwn(REACTION_SYMBOLS, name) || Object.hasOwn(HAIR_SYMBOLS, name));
  for (const [name, mark] of Object.entries(REACTION_SYMBOLS)) {
    assert.match(symbolSvg(name), /viewBox="0 0 1254 1254"/);
    assert.ok(!symbolSvg(name).match(/<script|href=|<image|<text/));
    const frames = symbolFrames(mark.motion);
    assert.equal(frames[0].opacity, 0); assert.equal(frames.at(-1)!.opacity, 0);
    assert.ok(mark.duration >= 1500 && mark.duration <= 4000);
  }
  assert.equal(symbolSvg('toString'), ''); assert.equal(symbolSvg('<script>'), '');
});

function drive() {
  const source = readFileSync('src/components/SvgAvatarCanvas.tsx', 'utf8');
  const code = source.slice(source.indexOf('    function clearSymbol()'), source.indexOf('    function stopReaction('));
  const animations: any[] = [], errors: string[] = [];
  const element = (): any => ({ attrs: { d: 'original' }, ...outline(100),
    getAttribute(k: string) { return this.attrs[k]; }, setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; },
    animate(frames: Keyframe[], options: any) { const a = { frames, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(a); return a; },
  });
  const makeLayer = () => ({ innerHTML: '', replaceChildren() { this.innerHTML = ''; }, querySelectorAll() { return Array.from({ length: (this.innerHTML.match(/data-symbol-part/g) || []).length }, element); } });
  const layer = makeLayer(), floatingLayer = makeLayer();
  const timers = new Map<number, () => void>(); let serial = 0;
  const box = element(), tuft = element();
  const context: any = { REACTION_SYMBOLS, HAIR_SYMBOLS, hairSymbolFrames, symbolFrames,
    symbolTimer: null, symbolAnimations: new Set(), symbolLayer: layer, floatingSymbolLayer: floatingLayer, box,
    nextEarTwitch: 0, clock: () => 1000,
    faces: [{ querySelector: () => tuft }], front: 0, document: { createElementNS: element },
    motionPreference: { matches: false }, callbacks: { current: { onError: (s: string) => errors.push(s) } },
    setTimeout: (f: () => void) => { timers.set(++serial, f); return serial; }, clearTimeout: (id: number) => timers.delete(id),
  };
  vm.runInNewContext(stripTypeScriptTypes(code) + '\nglobalThis.controls = { showSymbol, clearSymbol };', context);
  return { controls: context.controls, context, layer, floatingLayer, box, animations, timers, tuft, errors };
}

test('floating cues animate outside the face while eye and blush effects remain attached', () => {
  const d = drive();
  d.controls.showSymbol('sweatdrop');
  assert.ok(d.floatingLayer.innerHTML); assert.equal(d.layer.innerHTML, '');
  const prior = [...d.animations];
  d.controls.showSymbol('blush');
  assert.ok(d.layer.innerHTML); assert.equal(d.floatingLayer.innerHTML, '');
  assert.ok(prior.every(a => a.cancelled));
  d.controls.showSymbol('sparkle-eyes');
  assert.equal((String(d.layer.innerHTML).match(/data-symbol-part/g) || []).length, 2);
  assert.equal((String(d.floatingLayer.innerHTML).match(/data-symbol-part/g) || []).length, 1);
  d.controls.clearSymbol(); assert.equal(d.layer.innerHTML, '');
  for (const [name, kind] of [['curious', 'ray'], ['surprised', 'ray'], ['thinking', 'dot']]) {
    const svg = readFileSync('build/emotions/' + name + '.svg', 'utf8');
    assert.equal((svg.match(new RegExp('data-reaction-mark="' + kind + '"', 'g')) || []).length, 3);
  }
});

test('replacing and clearing symbols cancels old animations and restores normal eyes', () => {
  const d = drive(); d.controls.showSymbol('dizzy'); assert.equal(d.box.attrs['data-symbol-eyes'], 'true');
  const prior = [...d.animations]; d.controls.showSymbol('hair-surprise');
  assert.ok(prior.every(a => a.cancelled)); assert.equal(d.box.attrs['data-symbol-eyes'], undefined);
  assert.equal(d.layer.innerHTML, ''); assert.equal(d.timers.size, 1);
  assert.ok(d.context.nextEarTwitch >= 1000 + HAIR_SYMBOLS['hair-surprise'].duration + 2000, 'idle ear flicks cannot interrupt the morph');
  assert.equal(d.tuft.attrs.d, 'original', 'morphs never overwrite the authored SVG');
  d.controls.showSymbol('toString'); assert.equal(d.box.attrs['data-symbol'], 'hair-surprise');
  d.controls.clearSymbol(); assert.ok(d.animations.every(a => a.cancelled)); assert.equal(d.timers.size, 0);
  assert.equal(d.box.attrs['data-symbol'], undefined); assert.deepEqual(d.errors, []);
});

test('reduced motion uses a temporary still mark instead of a hair morph', () => {
  const d = drive(); d.context.motionPreference.matches = true;
  d.controls.showSymbol('hair-question'); assert.equal(d.box.attrs['data-symbol'], 'question');
  assert.equal(d.animations.length, 0); assert.ok(d.floatingLayer.innerHTML);
  [...d.timers.values()][0](); assert.equal(d.layer.innerHTML, ''); assert.equal(d.timers.size, 0);
});

test('cross-fading faces share a continuous morph; held sleep lasts until cleared', () => {
  const d = drive();
  d.context.faces.push(d.context.faces[0]);
  d.controls.showSymbol('hair-droop', { duration: 6500, hold: true, source: outline(80) });
  assert.equal(d.animations.length, 2);
  assert.deepEqual(d.animations[0].frames, d.animations[1].frames);
  assert.equal(d.animations[0].options.duration, 6500);
  assert.equal(d.animations[0].options.fill, 'forwards'); assert.equal(d.timers.size, 0);
  assert.equal(d.animations[0].frames[0].d, hairSymbolFrames(outline(80), outline(100))[0].d);
  d.controls.showSymbol('hair-surprise', { duration: 2300 });
  assert.ok(d.animations.slice(0, 2).every(a => a.cancelled)); assert.equal(d.timers.size, 1);
  d.controls.showSymbol(null);
  assert.equal(d.box.attrs['data-symbol'], 'hair-rest', 'neutral and Clear symbols ease back to the authored tuft');
  assert.equal(d.animations.at(-1).options.duration, 420);
  assert.equal(d.timers.size, 1);
  d.controls.clearSymbol(); assert.ok(d.animations.every(a => a.cancelled));
});
