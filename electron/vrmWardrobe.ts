// A model-local wardrobe.json describes named outfit choices for VRM avatars.
export type OutfitOption = {
  label: string;
  visible?: Record<string, boolean>;
  materials?: Record<string, number>;
  morphs?: Record<string, Record<string, number>>;
  additiveMorphs?: Record<string, Record<string, number>>;
  bones?: Record<string, [number, number, number, number]>;
};
export type OutfitControl = {
  id: string; name: string; kind: 'toggle' | 'option'; default: number;
  options: OutfitOption[];
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function named(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'constructor', 'prototype'].includes(value);
}
function map(value: unknown, valid: (v: unknown) => boolean): boolean {
  return value === undefined || (record(value) && Object.keys(value).length <= 64 && Object.entries(value).every(([key, v]) => named(key) && valid(v)));
}

export function vrmWardrobe(value: unknown): OutfitControl[] {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.controls) || value.controls.length > 32) throw Error('Invalid avatar wardrobe.');
  const ids = new Set<string>();
  for (const control of value.controls) {
    if (!record(control) || !named(control.id) || ids.has(control.id) || !named(control.name)
      || !['toggle', 'option'].includes(String(control.kind)) || !Array.isArray(control.options)
      || control.options.length < 2 || control.options.length > 12
      || (control.kind === 'toggle' && control.options.length !== 2)
      || !Number.isInteger(control.default) || Number(control.default) < 0 || Number(control.default) >= control.options.length) throw Error('Invalid wardrobe choice.');
    ids.add(control.id);
    for (const option of control.options) {
      if (!record(option) || !named(option.label)
        || !map(option.visible, v => typeof v === 'boolean')
        || !map(option.materials, v => Number.isInteger(v) && Number(v) >= 0)
        || ![option.morphs, option.additiveMorphs].every(m => map(m, v => record(v) && map(v, w => typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 1)))
        || !map(option.bones, q => Array.isArray(q) && q.length === 4 && q.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(Math.hypot(...q) - 1) < .001)) throw Error('Invalid wardrobe outfit.');
    }
  }
  return value.controls as OutfitControl[];
}

export function wardrobeControls(controls: OutfitControl[]) {
  return controls.map(c => ({ id: c.id, name: c.name, kind: c.kind, default: c.default, labels: c.options.map(o => o.label), values: c.options.map((_, i) => i) }));
}
