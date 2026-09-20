// A breath of hers for the gap between two paragraphs, by mood.
//
// The first reel gave her sighs and grunts, cut from a scene, with the room's
// reverb and a stepping sound in them that threw a line off now and then.
// The set he recorded on 2026-09-07 is clean and wider: a soft "hmmm", an
// "hmph", a throat-clear, two soft laughs. A laugh in an annoyed gap or a
// grunt in a fond one reads as the wrong person in the room, so the kind is
// read off the file name and the mood chooses the kind. Pure; voice.ts's
// pickSigh stays for the older two-way split.

export type BreathKind = 'laugh' | 'hmph' | 'throat' | 'sigh';

/** What a file is, by the name it was given. Anything unnamed is a sigh. */
export function breathKind(file: string): BreathKind {
  const name = file.split(/[\\/]/).pop() ?? file;
  if (/laugh|chuckl|giggl|snort/i.test(name)) return 'laugh';
  if (/hmph|grunt|tch|scoff|loud/i.test(name)) return 'hmph';
  if (/throat|ahem|cough/i.test(name)) return 'throat';
  return 'sigh';
}

/** The kinds a mood may breathe, first choice first. */
export function kindsFor(emotion: string | null | undefined): BreathKind[] {
  switch (emotion) {
    case 'happy': case 'affectionate': case 'curious': return ['laugh', 'sigh'];
    case 'smug': return ['laugh', 'hmph'];
    case 'annoyed': case 'determined': case 'surprised': return ['hmph', 'throat'];
    case 'embarrassed': return ['laugh', 'sigh'];
    case 'sleepy': case 'bored': case 'worried': return ['sigh'];
    case 'neutral': return ['throat', 'sigh'];
    default: return [];
  }
}

/**
 * The breath for the moment. The mood's first kind that has a file wins;
 * with none of them on disk, whatever there is. `files` is voice.sighs.
 */
export function pickBreath(files: readonly string[], emotion: string | null | undefined, random: () => number = Math.random): string | null {
  const all = files.filter(Boolean);
  if (!all.length) return null;
  const byKind = new Map<BreathKind, string[]>();
  for (const file of all) {
    const kind = breathKind(file);
    byKind.set(kind, [...(byKind.get(kind) ?? []), file]);
  }
  const wanted = kindsFor(emotion).map(kind => byKind.get(kind) ?? []).find(pool => pool.length);
  const pool = wanted ?? all;
  return pool[Math.floor(random() * pool.length) % pool.length] ?? null;
}
