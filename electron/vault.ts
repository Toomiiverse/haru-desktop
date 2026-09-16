// Her side of the vault.
//
// The Obsidian vault was his: notes he writes, which she reads as knowledge.
// This is the other direction — a folder in it that is hers, written by the
// app from what she already keeps: the diary, her nights, her things, how she
// stands with him, what she remembers, the places she knows. In Obsidian it is
// a wiki of her, with links between the days and the things, and the graph
// view draws it.
//
// Everything here is regenerated from the app's own state, so nothing in the
// folder is the source of anything: the diary file in his home folder, the
// store's nights and memories are. A note is rewritten only when its text
// changed, atomically, so Obsidian sees a quiet folder rather than a churning
// one. The knowledge sync skips the folder — she must not read her own diary
// back as a fact about his world.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Entry } from './diary';
import type { Night } from './nightlife';
import type { Her } from './her';
import type { Standing } from './standing';
import type { MemoryRecord } from './memory';
import type { Whereabouts } from './whereabouts';
import { HARU_FOLDER } from './obsidian';

export type Note = { relative: string; text: string };

const weekdayOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)));
};
const yaml = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
const link = (relative: string, shown?: string) => `[[${relative.replace(/\.md(?=#|$)/, '')}${shown ? `|${shown}` : ''}]]`;
const diaryPath = (day: string) => `${HARU_FOLDER}/Diary/${day}.md`;
const nightPath = (day: string) => `${HARU_FOLDER}/Nights/${day}.md`;
const herPath = `${HARU_FOLDER}/Her.md`;
const standingPath = `${HARU_FOLDER}/Standing.md`;
const memoriesPath = `${HARU_FOLDER}/Memories.md`;
const placesPath = `${HARU_FOLDER}/Places.md`;
const indexPath = `${HARU_FOLDER}/Haru.md`;

/** One note per diary day, linked to the night before it when there was one. */
export function diaryNotes(entries: Entry[], nightDays: Set<string>): Note[] {
  return entries.map(entry => ({
    relative: diaryPath(entry.day),
    text: [
      '---', `date: ${entry.day}`, `title: ${yaml(entry.title)}`, 'tags: [haru/diary]', '---', '',
      `# ${entry.title}`, '', `*${weekdayOf(entry.day)}, ${entry.day}* · ${link(indexPath, 'Haru')}`, '',
      entry.text.trim(), '',
      nightDays.has(entry.day) ? `— That night: ${link(nightPath(entry.day), 'what she got up to')}` : '',
    ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n').trim() + '\n',
  }));
}

/** One note per night, its sources as links, its thing linked into Her. */
export function nightNotes(nights: Night[]): Note[] {
  const byDay = new Map<string, Night[]>();
  for (const night of nights) byDay.set(night.day, [...(byDay.get(night.day) ?? []), night]);
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({
    relative: nightPath(day),
    text: [
      '---', `date: ${day}`, 'tags: [haru/night]', `things: [${list.map(n => n.interest).filter(Boolean).map(n => yaml(n!)).join(', ')}]`, '---', '',
      `# The night of ${weekdayOf(day)}, ${day}`, '', link(indexPath, 'Haru'), '',
      ...list.flatMap(night => [
        `## ${night.about}`, '',
        night.interest ? `One of her things — ${link(`${herPath}#${night.interest}`, night.interest)}.` : night.game ? `Sizing up his game: ${night.game}.` : 'On a whim.', '',
        night.note.trim(), '',
        ...(night.sources.length ? ['Sources:', ...night.sources.map(url => `- ${url}`), ''] : []),
      ]),
      `— The next day: ${link(diaryPath(day), 'her diary')}`,
    ].join('\n').trim() + '\n',
  }));
}

/** Her things, likes, wants and adventures — the Her tab, as a page. */
export function herNote(her: Her): Note {
  const lines = [
    '---', 'tags: [haru/her]', `things: ${her.things.length}`, `nights_out: ${her.nightsOut.count}`, '---', '',
    '# Her', '', link(indexPath, 'Haru'), '',
    `${her.things.length ? `${her.things.length} thing${her.things.length === 1 ? '' : 's'} of her own` : 'Nothing of her own yet'}; ${her.nightsOut.count} night${her.nightsOut.count === 1 ? '' : 's'} out${her.nightsOut.first ? ` since ${her.nightsOut.first}` : ''}; ${her.diary.entries} diary entr${her.diary.entries === 1 ? 'y' : 'ies'}${her.diary.since ? ` since ${her.diary.since}` : ''}.`, '',
  ];
  if (her.things.length) {
    lines.push('## Her things', '');
    for (const thing of her.things) {
      lines.push(`### ${thing.name}`, '', `*${thing.kind}* · since ${thing.since} · ${thing.nights} night${thing.nights === 1 ? '' : 's'}`, '', `Why: ${thing.because}`, '', thing.stance, '');
      if (thing.favourite) lines.push(`Favourite: ${thing.favourite}`, '');
      if (thing.wants) lines.push(`Wants: ${thing.wants}`, '');
    }
  }
  if (her.likes.length) lines.push('## Likes', '', ...her.likes.map(like => `- ${like.name} — of ${link(`${herPath}#${like.of}`, like.of)}`), '');
  if (her.wants.length) lines.push('## Wants', '', ...her.wants.map(want => `- ${want.wish} — of ${link(`${herPath}#${want.of}`, want.of)}`), '');
  if (her.adventures.length) {
    lines.push('## Adventures', '');
    for (const adventure of [...her.adventures].sort((a, b) => b.day.localeCompare(a.day))) lines.push(`- ${link(nightPath(adventure.day), adventure.day)} — ${adventure.about} (${adventure.why})`);
    lines.push('');
  }
  if (her.diary.latest) lines.push(`Latest diary entry: ${link(diaryPath(her.diary.latest.day), her.diary.latest.title)}`, '');
  return { relative: herPath, text: lines.join('\n').trim() + '\n' };
}

const bar = (value: number, of = 100) => { const n = Math.round((Math.max(0, Math.min(value, of)) / of) * 10); return `${'█'.repeat(n)}${'░'.repeat(10 - n)}`; };

/** How she stands with him right now — rewritten whenever it changes. */
export function standingNote(standing: Standing, updatedAt: string): Note {
  const lines = [
    '---', 'tags: [haru/standing]', `updated: ${updatedAt}`, `mood: ${standing.emotion}`, `bond_level: ${standing.bond.level}`, `bond: ${standing.bond.value}`, `waiting: ${standing.waiting.length}`, '---', '',
    '# Standing', '', link(indexPath, 'Haru'), '',
    `**${standing.mood}**`, '',
    `Bond: ${bar(standing.bond.value, standing.bond.of)} level ${standing.bond.level} — *${standing.bond.title}*. ${standing.bond.note}${standing.bond.toNext > 0 ? ` (${standing.bond.toNext} to the next)` : ''}`, '',
    '| Meter | | Note |', '|---|---|---|',
    ...standing.meters.map(meter => `| ${meter.label} | ${bar(meter.value)} ${meter.value} | ${meter.note} |`),
    `| ${standing.patience.label} | ${bar(standing.patience.value)} ${standing.patience.value} | ${standing.patience.note} |`,
    `| Grudge | ${bar(standing.grudge.value, standing.grudge.of)} ${standing.grudge.value}/${standing.grudge.of} | ${standing.grudge.note} |`, '',
    `Known ${standing.knownDays} day${standing.knownDays === 1 ? '' : 's'}, talked on ${standing.daysTalked}.${standing.minutesSinceSpoke !== null ? ` Last heard from him ${standing.minutesSinceSpoke < 60 ? `${standing.minutesSinceSpoke} min` : `${Math.round(standing.minutesSinceSpoke / 60)} h`} ago.` : ''}`, '',
  ];
  if (standing.waiting.length) lines.push('## Waiting on him', '', ...standing.waiting.map(item => `- [ ] ${item.title} — ${item.when}${item.late ? ' **(late)**' : ''}`), '');
  if (standing.stale.length) lines.push('## Let slide', '', ...standing.stale.map(item => `- [ ] ${item.title} — ${item.when}`), '');
  return { relative: standingPath, text: lines.join('\n').trim() + '\n' };
}

/** What she remembers about him, current facts only, by subject. */
export function memoriesNote(records: MemoryRecord[]): Note {
  // Current: not replaced by a later fact, not gone dormant, and not archived —
  // an archived memory is one she was stopped from using (three wrong ones were
  // archived on 2026-09-17), and the page kept listing them as current.
  const current = records.filter(record => !record.supersededBy && record.status !== 'dormant' && record.status !== 'archived' && record.text.trim());
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of current) { const key = (record.subject ?? '').trim() || 'General'; groups.set(key, [...(groups.get(key) ?? []), record]); }
  const lines = ['---', 'tags: [haru/memories]', `count: ${current.length}`, '---', '', '# What she remembers', '', link(indexPath, 'Haru'), '', `${current.length} thing${current.length === 1 ? '' : 's'} she holds as current. Superseded and forgotten ones are not here.`, ''];
  for (const [subject, list] of [...groups.entries()].sort(([a], [b]) => (a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b)))) {
    lines.push(`## ${subject}`, '');
    for (const record of [...list].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))) {
      lines.push(`- ${record.text.trim().replace(/\n+/g, ' ')} *(${record.kind}${record.mentions > 1 ? `, ×${record.mentions}` : ''}, ${record.lastSeenAt.slice(0, 10)})*`);
    }
    lines.push('');
  }
  return { relative: memoriesPath, text: lines.join('\n').trim() + '\n' };
}

/** The places she knows by name, and where he last said he was. */
export function placesNote(where: Whereabouts, told: string): Note {
  const lines = ['---', 'tags: [haru/places]', `count: ${where.places.length}`, '---', '', '# Places', '', link(indexPath, 'Haru'), ''];
  if (told) lines.push(`Where he said he is: ${told}`, '');
  if (where.places.length) {
    lines.push('| Place | Since | Map |', '|---|---|---|');
    for (const place of where.places) lines.push(`| ${place.name} | ${place.added.slice(0, 10)} | [open](https://www.google.com/maps/search/?api=1&query=${place.lat.toFixed(5)},${place.lon.toFixed(5)}) |`);
    lines.push('');
  } else lines.push('No named places yet.', '');
  return { relative: placesPath, text: lines.join('\n').trim() + '\n' };
}

/** The front page of her folder. */
export function indexNote(input: { latestDiary?: Entry; latestNight?: string; standing: Standing; her: Her; memories: number; places: number }): Note {
  const lines = [
    '---', 'tags: [haru]', '---', '', '# Haru', '',
    'Her side of the vault, written by the app from what she keeps. Nothing here is edited by hand — it is regenerated, and the diary in the home folder and her store are the originals.', '',
    `- ${link(standingPath, 'Standing')} — ${input.standing.mood}`,
    `- ${link(herPath, 'Her')} — ${input.her.things.length} thing${input.her.things.length === 1 ? '' : 's'}, ${input.her.nightsOut.count} night${input.her.nightsOut.count === 1 ? '' : 's'} out`,
    `- ${link(memoriesPath, 'Memories')} — ${input.memories} current`,
    `- ${link(placesPath, 'Places')} — ${input.places} named`,
    input.latestDiary ? `- Diary — latest ${link(diaryPath(input.latestDiary.day), `${input.latestDiary.day}: ${input.latestDiary.title}`)}` : '- Diary — nothing yet',
    input.latestNight ? `- Nights — latest ${link(nightPath(input.latestNight), input.latestNight)}` : '- Nights — none yet',
    '',
  ];
  return { relative: indexPath, text: lines.join('\n').trim() + '\n' };
}

/**
 * Written only where the text changed, each atomically, so an open Obsidian
 * sees finished files and a quiet folder. Nothing is ever deleted here.
 */
export function writeNotes(vault: string, notes: Note[]): { written: number; unchanged: number } {
  let written = 0, unchanged = 0;
  for (const note of notes) {
    const file = path.join(vault, note.relative);
    let current: string | null = null;
    try { current = existsSync(file) ? readFileSync(file, 'utf8') : null; } catch { current = null; }
    if (current === note.text) { unchanged++; continue; }
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, note.text, 'utf8');
    renameSync(tmp, file);
    written++;
  }
  return { written, unchanged };
}
