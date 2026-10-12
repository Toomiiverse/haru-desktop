import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vrmWardrobe, wardrobeControls } from '../electron/vrmWardrobe';
import { discoverWardrobe, readWardrobe } from '../electron/wardrobe';

const pack = () => ({ version: 1, controls: [{ id: 'jacket', name: 'Jacket', kind: 'toggle', default: 1, options: [{ label: 'Off', visible: { Jacket: false } }, { label: 'On', visible: { Jacket: true } }] }] });
test('VRM choices retain names and model defaults', () => {
  assert.deepEqual(wardrobeControls(vrmWardrobe(pack())), [{ id: 'jacket', name: 'Jacket', kind: 'toggle', default: 1, labels: ['Off', 'On'], values: [0, 1] }]);
});
test('rejects ambiguous controls and invalid target values', () => {
  const duplicate = pack(); duplicate.controls.push(duplicate.controls[0]); assert.throws(() => vrmWardrobe(duplicate));
  const invalidDefault = pack(); invalidDefault.controls[0].default = 2; assert.throws(() => vrmWardrobe(invalidDefault));
  const invalidWeight = pack(); Object.assign(invalidWeight.controls[0].options[0], { morphs: { Jacket: { FrontOpen: 3 } } }); assert.throws(() => vrmWardrobe(invalidWeight));
  assert.throws(() => vrmWardrobe({ version: 2, controls: [] }));
});
test('discovers a wardrobe beside a binary VRM and tolerates absent wardrobe', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'haru-wardrobe-'));
  try {
    const model = path.join(dir, 'avatar.vrm'); writeFileSync(model, Buffer.from([0, 1, 2]));
    assert.deepEqual(discoverWardrobe(model), []);
    writeFileSync(path.join(dir, 'wardrobe.json'), JSON.stringify(pack()));
    assert.equal(discoverWardrobe(model)[0].default, 1);
    writeFileSync(path.join(dir, 'wardrobe.json'), '{'); assert.deepEqual(discoverWardrobe(model), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Live2D parameter discovery still uses actual parameter bounds', () => {
  assert.deepEqual(readWardrobe({ Parameters: [{ Id: 'Hair', Name: 'Slider - Hair Length', GroupId: 'Options' }], ParameterGroups: [{ Id: 'Options', Name: 'Sliders' }] }, new Map(), { Hair: { min: -1, max: 1 } })[0].values, [-1, 0, 1]);
});
