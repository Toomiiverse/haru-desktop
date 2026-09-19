// Which of her feelings gets to speak when several want to at once. The case
// that made this exist is the last test: her real state on 2026-09-19.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER, SPOKEN_AT_ONCE, compileBehaviour, compileLog, type Candidate } from '../electron/compile';

const one = (over: Partial<Candidate> & { id: string }): Candidate =>
  ({ text: `the ${over.id} line`, stance: 'neutral', layer: 2, strength: 0.5, ...over });

test('with nothing to argue about, everything speaks, weakest last read', () => {
  const out = compileBehaviour([
    one({ id: 'grudge', layer: LAYER.grudge, strength: 0.9 }),
    one({ id: 'temperament', layer: LAYER.temperament }),
    one({ id: 'vitals', layer: LAYER.vitals }),
  ]);
  assert.deepEqual(out.spoke, ['temperament', 'vitals', 'grudge'], 'the one that should win is read last');
  assert.deepEqual(out.dropped, []);
  assert.equal(out.text, 'the temperament line the vitals line the grudge line');
});

test('the loudest thing with a side to it decides the side, and the other side keeps quiet', () => {
  const out = compileBehaviour([
    one({ id: 'temperament', stance: 'warm', layer: LAYER.temperament, strength: 0.7 }),
    one({ id: 'feelings', stance: 'warm', layer: LAYER.feelings, strength: 0.4 }),
    one({ id: 'grudge', stance: 'cold', layer: LAYER.grudge, strength: 0.9 }),
    one({ id: 'vitals', stance: 'neutral', layer: LAYER.vitals }),
  ]);
  assert.deepEqual(out.spoke, ['vitals', 'grudge'], 'neutral sits out of the argument and survives');
  assert.deepEqual(out.dropped.map(d => d.id).sort(), ['feelings', 'temperament']);
  assert.ok(out.dropped.every(d => d.why === 'contradicted'));
  // And the other way round: warm on top silences the weaker cold.
  const warm = compileBehaviour([
    one({ id: 'fond', stance: 'warm', layer: LAYER.feelings, strength: 0.9 }),
    one({ id: 'irritation', stance: 'cold', layer: LAYER.irritation, strength: 0.05 }),
  ]);
  assert.deepEqual(warm.spoke, ['fond']);
});

test('a strong cold thing beats a weak cold thing without silencing it — they agree', () => {
  const out = compileBehaviour([
    one({ id: 'irritation', stance: 'cold', layer: LAYER.irritation, strength: 0.2 }),
    one({ id: 'grudge', stance: 'cold', layer: LAYER.grudge, strength: 0.9 }),
  ]);
  assert.deepEqual(out.spoke, ['irritation', 'grudge']);
});

test('past four, the weakest stop speaking', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, n) => one({ id, layer: 1, strength: n / 10 }));
  const out = compileBehaviour(many);
  assert.equal(out.spoke.length, SPOKEN_AT_ONCE);
  assert.deepEqual(out.spoke, ['c', 'd', 'e', 'f']);
  assert.deepEqual(out.dropped, [{ id: 'a', why: 'capped' }, { id: 'b', why: 'capped' }]);
});

test('a hard rule is not a mood: never contradicted, never capped, and read first', () => {
  const out = compileBehaviour([
    one({ id: 'rule', stance: 'warm', hard: true, layer: 0, strength: 0 }),
    ...['a', 'b', 'c', 'd', 'e'].map((id, n) => one({ id, stance: 'cold', layer: 1, strength: n / 10 })),
  ]);
  assert.equal(out.spoke[0], 'rule');
  assert.equal(out.spoke.length, SPOKEN_AT_ONCE + 1, 'it does not eat a mood\'s place');
  assert.ok(!out.dropped.some(d => d.id === 'rule'));
});

test('empty lines are not candidates, and nothing at all is fine', () => {
  const out = compileBehaviour([one({ id: 'blank', text: '' }), one({ id: 'space', text: '   ' }), one({ id: 'real' })]);
  assert.deepEqual(out.spoke, ['real']);
  assert.equal(compileBehaviour([]).text, '');
  assert.equal(compileLog(compileBehaviour([])), 'nothing');
});

test('her real state on the evening this was written', () => {
  // mischievous day, impatient, and a grudge that had set in — tease more, say
  // less, be cold, all in the same prompt.
  const out = compileBehaviour([
    one({ id: 'temperament', text: 'You are in a mischievous mood today. You tease more than usual.', stance: 'warm', layer: LAYER.temperament, strength: 0.7 }),
    one({ id: 'irritation', text: 'You are getting impatient with this conversation. Keep replies clipped.', stance: 'cold', layer: LAYER.irritation, strength: 0.33 }),
    one({ id: 'grudge', text: 'You are cold rather than loud now, and offer nothing of yourself.', stance: 'cold', layer: LAYER.grudge, strength: 0.85 }),
  ]);
  assert.deepEqual(out.spoke, ['irritation', 'grudge']);
  assert.deepEqual(out.dropped, [{ id: 'temperament', why: 'contradicted' }]);
  assert.doesNotMatch(out.text, /tease more/, 'she is not teasing him tonight');
  assert.match(compileLog(out), /irritation < grudge — dropped temperament \(contradicted\)/);
});

test('something happening to him outranks anything she was holding against him', () => {
  // Her real state on 2026-09-19: grudge 85, entrenched. Then he says he is at
  // the hospital. The grievance does not get to be the loudest thing.
  const out = compileBehaviour([
    one({ id: 'grudge', text: 'You are cold rather than loud, and offer nothing of yourself.', stance: 'cold', layer: LAYER.grudge, strength: 0.85 }),
    one({ id: 'irritation', text: 'Keep replies clipped.', stance: 'cold', layer: LAYER.irritation, strength: 0.33 }),
    one({ id: 'fear', text: 'It comes out as orders. Make him answer the direct question.', stance: 'warm', layer: LAYER.fear, strength: 0.7 }),
  ]);
  assert.deepEqual(out.spoke, ['fear']);
  assert.match(out.text, /answer the direct question/);
  assert.doesNotMatch(out.text, /offer nothing of yourself/);
  // Even a barely-felt fright beats a maxed-out grudge: that is the point of the rank.
  const faint = compileBehaviour([
    one({ id: 'grudge', stance: 'cold', layer: LAYER.grudge, strength: 1 }),
    one({ id: 'fear', stance: 'warm', layer: LAYER.fear, strength: 0.35 }),
  ]);
  assert.deepEqual(faint.spoke, ['fear']);
});

test('the thing loud enough to own the reply leaves nothing else standing', () => {
  const out = compileBehaviour([
    one({ id: 'temperament', text: 'You tease more than usual.', stance: 'warm', layer: LAYER.temperament, strength: 0.7 }),
    one({ id: 'grudge', stance: 'cold', layer: LAYER.grudge, strength: 0.85 }),
    one({ id: 'rule', hard: true, layer: 0, strength: 0 }),
    one({ id: 'fear', stance: 'warm', layer: LAYER.fear, strength: 0.7, alone: true }),
  ]);
  assert.deepEqual(out.spoke, ['rule', 'fear'], 'a hard rule is still not a mood');
  assert.doesNotMatch(out.text, /tease more/, 'not while he is in trouble');
  assert.deepEqual(out.dropped.filter(d => d.why === 'outranked').map(d => d.id), ['temperament']);
  // It only owns the reply while it is the loudest thing in it.
  const faded = compileBehaviour([
    one({ id: 'grudge', stance: 'cold', layer: LAYER.grudge, strength: 0.85 }),
    one({ id: 'fear', stance: 'warm', layer: LAYER.fear, strength: 0, alone: true }),
  ]);
  assert.deepEqual(faded.spoke, ['grudge']);
});
