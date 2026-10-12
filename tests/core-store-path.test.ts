import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreStore } from '../electron/core-store';

// Exercise the real snapshot reader without starting an authority worker. No
// persistence behavior changes here; both readers use the same cached state.
function snapshot(config: unknown) {
  const core = Object.create(CoreStore.prototype) as CoreStore;
  Object.assign(core, { state: { documents: { config } }, staged: null });
  return core;
}

test('branch reads preserve absent, null, scalar and nested configuration semantics', () => {
  const core = snapshot({ ai: { model: 'Large V2', nullable: null, list: [{ id: 1 }] }, falseValue: false });
  assert.equal(core.getPath('config', ['ai', 'model']), 'Large V2');
  assert.equal(core.getPath('config', ['ai', 'nullable'], 'fallback'), null);
  assert.equal(core.getPath('config', ['missing'], 'fallback'), 'fallback');
  assert.equal(core.getPath('config', ['falseValue'], true), false);
  assert.equal(core.getPath('config', ['toString']), undefined);
  const list = core.getPath('config', ['ai', 'list']); list[0].id = 2;
  assert.equal(core.getPath('config', ['ai', 'list', '0', 'id']), 1);
});

test('branch reads see transaction edits and deletions immediately without cloning unrelated history', () => {
  const config = { ai: { model: 'before' }, get unrelatedHistory(): never { throw Error('unrelated branch was read'); } };
  const core = snapshot(config);
  assert.equal(core.getPath('config', ['ai', 'model']), 'before');
  Object.assign(core, { staged: { config: { ai: { model: 'edited' } } } });
  assert.equal(core.getPath('config', ['ai', 'model']), 'edited');
  Object.assign(core, { staged: { config: {} } });
  assert.equal(core.getPath('config', ['ai', 'model']), undefined);
  Object.assign(core, { staged: null });
  assert.equal(core.getPath('config', ['ai', 'model']), 'before');
});

test('batched interaction state commits once and rolls back a failed update', () => {
  const core = snapshot({ mood: { ego: 0 }, her: { feelings: { bored: 0 } } });
  const commits: any[] = [];
  Object.assign(core, { depth: 0, call: (_method: string, input: any) => {
    commits.push(input.patches); return { revision: commits.length, currentRevision: commits.length };
  } });
  core.transaction(() => {
    const config = core.get('config'); config.her.feelings.bored = 1; core.set('config', config);
    const next = core.get('config'); next.mood.ego = 2; core.set('config', next);
    assert.equal(core.getPath('config', ['her', 'feelings', 'bored']), 1);
  });
  assert.equal(commits.length, 1); assert.equal(commits[0].config.mood.ego, 2);
  assert.equal(core.getPath('config', ['mood', 'ego']), 2);
  assert.throws(() => core.transaction(() => { core.set('config', { mood: { ego: 99 } }); throw Error('cancel'); }));
  assert.equal(commits.length, 1); assert.equal(core.getPath('config', ['mood', 'ego']), 2);
});

test('nested rollback isolates touched documents without visiting an unrelated archive', () => {
  const core = snapshot({ mood: { ego: 0 } });
  const state = (core as any).state;
  state.documents.archive = { get huge(): never { throw Error('archive cloned'); } };
  const commits: any[] = [];
  Object.assign(core, { depth: 0, call: (_method: string, input: any) => {
    commits.push(input.patches); return { revision: commits.length, currentRevision: commits.length };
  } });
  core.transaction(() => {
    core.set('config', { mood: { ego: 1 } });
    assert.throws(() => core.transaction(() => { core.set('config', { mood: { ego: 9 } }); core.set('knowledge', {}); throw Error('rollback'); }));
    assert.equal(core.getPath('config', ['mood', 'ego']), 1);
    core.transaction(() => core.set('config', { mood: { ego: 2 } }));
  });
  assert.equal(commits.length, 1);
  assert.deepEqual(Object.keys(commits[0]), ['config']);
  core.transaction(() => core.set('config', { mood: { ego: 2 } }));
  assert.equal(commits.length, 1, 'identical writes need no commit');
  assert.throws(() => core.transaction(() => Promise.resolve()), /synchronous/);
});
