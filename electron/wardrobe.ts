// What she can change about how she looks.
//
// Outfits are not expressions, despite shipping as .exp3.json files. Those files
// only set a parameter to a value — "clothes color options 1 - 2- 3" is
// ParamOnOff6 = 3 — so treating them as expressions would mean firing a whole
// preset to change one thing, and no way to know which option is currently on.
// The parameters are the real control surface; this finds them.
//
// Discovery reads the model's own DisplayInfo (.cdi3.json), which carries human
// names and groups the author already wrote. Matching is on those group names
// rather than on parameter ids, so a different model with a "Toggles" group works
// without knowing anything about this one.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type WardrobeKind = 'toggle' | 'option' | 'pose';

/**
 * Parameters that place a limb rather than pick an outfit.
 *
 * They are excluded from the pickers above on purpose — arms are continuous, and
 * a row of twelve buttons is no way to choose an elbow angle — but they are the
 * ones that make a model look wrong when its author left them mid-gesture. This
 * model rigs ten of them and no bundled expression touches any.
 */
const POSE_NAME = /\b(arm|forearm|elbow|wrist|hand|shoulder)\b/i;
export type WardrobeControl = {
  id: string;
  name: string;
  kind: WardrobeKind;
  /**
   * The actual parameter values this control can be set to, in order. Not a
   * count and not a range: hair length runs -1..1, clothes colour runs 0..3, and
   * an earlier version that assumed options started at 1 and counted upward made
   * half this model's wardrobe unreachable — "long" sat at -1 where nothing
   * could select it, and two buttons both clamped to the same value.
   */
  values: number[];
};

/** Real parameter bounds, read from the loaded model rather than guessed. */
export type ParameterRange = { min: number; max: number };

type DisplayInfo = {
  Parameters?: { Id?: string; Name?: string; GroupId?: string }[];
  ParameterGroups?: { Id?: string; Name?: string }[];
};

// A group called "Toggles" or "Sliders" is the author telling us what these are.
const TOGGLE_GROUP = /toggle/i;
const OPTION_GROUP = /slider/i;
// Fallbacks for models without helpful group names. Deliberately narrow: an
// expression called "Chibi Toggle" must not be mistaken for a wardrobe item just
// because it contains the word.
const TOGGLE_NAME = /\boff\s*[\/-]?\s*on\b/i;
const OPTION_NAME = /^\s*slider\s*[-–—]/i;

/** Strips the scaffolding the author used to describe the control to themselves. */
function cleanName(raw: string) {
  const cleaned = raw
    .replace(/^\s*slider\s*[-–—]\s*/i, '')
    .replace(/\s*\boff\s*[\/-]?\s*on\b\s*$/i, '')
    .replace(/\s*\boptions?\b[\d\s,\-–—]*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "hat" and "Slider - Clothes Color" should sit together in one list without
  // one of them looking like a typo.
  return cleaned.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

/**
 * Highest value each parameter is set to across the model's expression files.
 * The author wrote "options 1 - 2- 3" and had it set 3, so the files state the
 * option count more reliably than any guess from the parameter name.
 */
export function optionCeilings(modelDirectory: string): Map<string, number> {
  const ceilings = new Map<string, number>();
  let files: string[] = [];
  try {
    files = readdirSync(modelDirectory).filter(name => name.toLowerCase().endsWith('.exp3.json'));
  } catch {
    return ceilings;
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(modelDirectory, file), 'utf8')) as { Parameters?: { Id?: string; Value?: number }[] };
      for (const entry of parsed.Parameters ?? []) {
        if (typeof entry?.Id !== 'string' || typeof entry.Value !== 'number') continue;
        ceilings.set(entry.Id, Math.max(ceilings.get(entry.Id) ?? 0, entry.Value));
      }
    } catch {
      // A malformed expression file costs that one file, not the wardrobe.
    }
  }
  return ceilings;
}

/**
 * The values a control should offer. Whole numbers inside the parameter's real
 * range, which is how these are almost always authored — a colour slider running
 * 0..3 is four variants, and hair length running -1..1 is long, middle, short.
 * A range too narrow to hold two whole numbers falls back to its endpoints.
 */
export function optionValues(range: ParameterRange): number[] {
  const first = Math.ceil(range.min - 1e-6);
  const last = Math.floor(range.max + 1e-6);
  const steps: number[] = [];
  // Capped: a parameter that happens to run 0..100 is a continuous control the
  // author never meant as a picker, and 101 buttons is not a wardrobe.
  for (let value = first; value <= last && steps.length < 12; value++) steps.push(value);
  return steps.length >= 2 ? steps : [range.min, range.max];
}

export function readWardrobe(displayInfo: unknown, ceilings: Map<string, number>, ranges?: Record<string, ParameterRange>): WardrobeControl[] {
  const info = (displayInfo ?? {}) as DisplayInfo;
  const groupNames = new Map((info.ParameterGroups ?? []).map(group => [group.Id ?? '', group.Name ?? '']));
  const controls: WardrobeControl[] = [];

  for (const parameter of info.Parameters ?? []) {
    const id = parameter?.Id;
    const label = parameter?.Name ?? '';
    if (typeof id !== 'string' || !id) continue;
    const group = groupNames.get(parameter.GroupId ?? '') ?? '';

    // Group first: it is the author's own classification, and it is what keeps
    // the emotional expressions out of the wardrobe.
    const kind: WardrobeKind | null =
      TOGGLE_GROUP.test(group) ? 'toggle'
      : OPTION_GROUP.test(group) ? 'option'
      : TOGGLE_NAME.test(label) ? 'toggle'
      : OPTION_NAME.test(label) ? 'option'
      // Last, so a sleeve colour named "left arm colour" is still an option.
      : POSE_NAME.test(label) ? 'pose'
      : null;
    if (!kind) continue;

    const range = ranges?.[id];
    // The model's own bounds when the companion window has reported them, which
    // is the only reliable source. The expression-file guess below is a stopgap
    // for the first frames after launch and is wrong whenever a control does not
    // happen to run upward from 1.
    const values = kind === 'pose'
      // Both ends and the middle. The slider interpolates; these exist so the
      // renderer knows the bounds and where the arm rests by default.
      ? (range ? [range.min, (range.min + range.max) / 2, range.max] : [-1, 0, 1])
      : kind === 'toggle'
      ? (range ? [range.min, range.max] : [0, 1])
      : range ? optionValues(range)
      : Array.from({ length: Math.max(2, Math.ceil(ceilings.get(id) ?? 0) || 3) }, (_, index) => index + 1);
    controls.push({ id, name: cleanName(label) || id, kind, values });
  }

  // Options before toggles: changing colour is the thing people came for, and
  // the on/off switches read as accessories to it.
  const order = { option: 0, toggle: 1, pose: 2 };
  return controls.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : order[a.kind] - order[b.kind]));
}

/** Reads the DisplayInfo the manifest points at, if the model ships one. */
export function readDisplayInfo(modelPath: string): unknown {
  try {
    const directory = path.dirname(modelPath);
    const manifest = JSON.parse(readFileSync(modelPath, 'utf8')) as { FileReferences?: { DisplayInfo?: string } };
    const relative = manifest.FileReferences?.DisplayInfo;
    if (!relative) return null;
    return JSON.parse(readFileSync(path.join(directory, relative), 'utf8'));
  } catch {
    return null;
  }
}

/** Everything she can change about her appearance, for the model at this path. */
export function discoverWardrobe(modelPath: string, ranges?: Record<string, ParameterRange>): WardrobeControl[] {
  const info = readDisplayInfo(modelPath);
  if (!info) return [];
  return readWardrobe(info, optionCeilings(path.dirname(modelPath)), ranges);
}
