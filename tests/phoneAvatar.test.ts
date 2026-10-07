import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { adaptEmotion } from '../electron/emotions';

test('phone handover preserves its resting mood and forwards thinking, speech and reactions', () => {
  const text = readFileSync('src/phoneAvatar.tsx', 'utf8');
  const source = text.slice(0, text.indexOf('  const loadFace')).replace(/^import .*;\r?\n/gm, '') + '\nglobalThis.ready = onReady; }';
  let stopped = 0, replaced = 0, serial = 0;
  const timers = new Map<number, () => void>(), calls: unknown[][] = [];
  const host = { replaceChildren() { replaced++; }, setAttribute() {}, addEventListener() {}, removeEventListener() {} };
  const context: any = { createPhoneSpeech: () => ({ dispose: () => calls.push(['speech-stop']) }), adaptEmotion, stylesheet: '',
    window: { haruAvatar: { state: () => ({ resting: 'affectionate' }), stop: () => stopped++ } },
    document: { getElementById: () => host, head: { appendChild() {} }, createElement: () => ({ style: {} }) },
    createRoot: () => ({ unmount: () => calls.push(['stop']) }),
    setTimeout: (f: () => void, ms: number) => { assert.equal(ms, 20000); timers.set(++serial, f); return serial; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  vm.runInNewContext(stripTypeScriptTypes(source), context);
  context.ready({ tap: () => calls.push(['tap']), expression: (n: string) => calls.push(['express', n]), notify: () => calls.push(['notify']),
    attend: (...v: unknown[]) => calls.push(['attend', ...v]), play: (n: string) => calls.push(['play', n]), symbol: (n: string) => calls.push(['symbol', n]) });
  const avatar = context.window.haruAvatar;
  assert.equal(stopped, 1); assert.equal(replaced, 1); assert.deepEqual(calls[0], ['express', 'love']);
  avatar.think(); assert.deepEqual(calls.at(-1), ['express', 'thinking']); assert.equal(timers.size, 1);
  avatar.notify(); assert.equal(timers.size, 0); assert.deepEqual(calls.slice(-2), [['express', 'love'], ['notify']]);
  avatar.express('triumph'); avatar.play('celebrate'); avatar.symbol('hair-surprise'); avatar.attend('typing', 1500);
  assert.deepEqual(calls.slice(-4), [['express', 'triumph'], ['play', 'celebrate'], ['symbol', 'hair-surprise'], ['attend', 'typing', 1500]]);
  for (const name of ['exclaim', 'burst', 'orbit', 'comet', 'play']) { avatar.poke(name); assert.deepEqual(calls.at(-1), ['tap']); }
  avatar.tap(); assert.deepEqual(calls.at(-1), ['tap']);
  avatar.stop(); assert.deepEqual(calls.slice(-2), [['speech-stop'], ['stop']]);
});
