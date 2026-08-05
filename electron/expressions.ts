// Live2D models exported from VTube Studio routinely ship .exp3.json files that
// the model3.json never lists — the Narielle model has twenty on disk and an
// empty manifest — so the runtime loads none of them and the character cannot
// emote at all. These are discovered on disk and folded into the manifest as it
// is served, which leaves the user's own files untouched.

import { readdirSync } from 'node:fs';
import path from 'node:path';

export type ExpressionEntry = { Name: string; File: string };

const EXPRESSION_SUFFIX = '.exp3.json';

// Names keep their folder — "Emotions/upset" rather than "upset" — because a
// folder the user made to group emotional expressions is a strong signal about
// which ones are meant to be played as reactions, and that is worth preserving
// through to the picker.
export function expressionEntries(relativePaths: string[]): ExpressionEntry[] {
  const seen = new Set<string>();
  const entries: ExpressionEntry[] = [];
  for (const relative of relativePaths) {
    const file = relative.split(path.sep).join('/');
    if (!file.toLowerCase().endsWith(EXPRESSION_SUFFIX)) continue;
    const name = file.slice(0, -EXPRESSION_SUFFIX.length);
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({ Name: name, File: file });
  }
  return entries.sort((a, b) => a.Name.localeCompare(b.Name));
}

function walk(root: string, directory: string, depth: number): string[] {
  if (depth > 3) return [];
  let found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found = found.concat(walk(root, full, depth + 1));
    else if (entry.name.toLowerCase().endsWith(EXPRESSION_SUFFIX)) found.push(path.relative(root, full));
  }
  return found;
}

export function discoverExpressions(modelDirectory: string): ExpressionEntry[] {
  try {
    return expressionEntries(walk(modelDirectory, modelDirectory, 0));
  } catch {
    return [];
  }
}

// Only fills a gap: a model that already declares its expressions is left alone,
// since its author knew better than a directory scan would.
export function withDiscoveredExpressions(manifest: unknown, modelDirectory: string) {
  const model = (manifest ?? {}) as { FileReferences?: { Expressions?: unknown } };
  const references = model.FileReferences ?? (model.FileReferences = {});
  if (Array.isArray(references.Expressions) && references.Expressions.length) return { model, added: 0 };
  const discovered = discoverExpressions(modelDirectory);
  if (discovered.length) references.Expressions = discovered;
  return { model, added: discovered.length };
}
