// What a memory is, and what follows from it.
//
// The sorting itself is a model call and is measured elsewhere (the hand-labelled
// set of 2026-09-17); what is tested here is everything around it — reading the
// answer strictly, the guess an unsorted record gets, a plan turning into an
// event when its day goes, and each category reaching the block it belongs in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_MEANING, categoryOf, guessCategory, isCategory, LEGACY_KIND, readSorting, sortInput, sortPrompt, UNDATED_PLAN_DAYS, type SortNote } from '../electron/categories';
import { importanceOf, migrateMemories, pruneMemories, rememberInto, retrieveMemories, tidyEvidence, type MemoryRecord } from '../electron/memory';
import { defaultMemoryBlocks, formatMemoryBlocks, withoutRestatements } from '../electron/blocks';
import { mergeMemories } from '../electron/memorysync';
import { memoriesNote } from '../electron/vault';

const NOW = new Date('2026-09-17T02:00:00.000Z');

function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    kind: 'fact',
    createdAt: '2026-09-10T00:00:00.000Z',
    lastSeenAt: '2026-09-10T00:00:00.000Z',
    mentions: 1,
    confidence: 0.8,
    importance: 0.45,
    source: 'conversation',
    status: 'active',
    ...overrides,
  };
}

const notes: SortNote[] = [
  { id: 'a', text: 'Their car registration is due on 6 October', kind: 'event', createdAt: '2026-09-12T03:00:00.000Z' },
  { id: 'b', text: 'Prefers dark mode', kind: 'preference', createdAt: '2026-09-12T03:00:00.000Z' },
  { id: 'c', text: 'Opened Discord', kind: 'event', createdAt: '2026-09-12T03:00:00.000Z' },
];

test('every category has a meaning and every kept one a kind the older code knows', () => {
  for (const category of CATEGORIES) {
    assert.ok(CATEGORY_MEANING[category].length > 20, category);
    if (category !== 'passing') assert.ok(LEGACY_KIND[category], category);
  }
  const prompt = sortPrompt();
  for (const category of CATEGORIES) assert.match(prompt, new RegExp(`^${category} — `, 'm'));
  assert.match(prompt, /<number> \| <category> \| <when>/);
});

test('each note goes to the model with the day it was written, so "tomorrow" can be worked out', () => {
  const input = sortInput([{ ...notes[0], subject: 'Car' }], iso => iso.slice(0, 10));
  assert.equal(input, '1. (written Sat 2026-09-12) [about: Car] Their car registration is due on 6 October');
});

test('the answer is read strictly: unknown categories, unknown numbers and repeats are left unsorted', () => {
  const sorted = readSorting([
    '1 | plan | 2026-10-06',
    '2 | preference | -',
    '2 | instruction | -',
    '3 | chatter | -',
    '9 | event | 2026-09-12',
    'Here you go!',
  ].join('\n'), notes);
  assert.deepEqual(sorted.get('a'), { category: 'plan', when: '2026-10-06' });
  assert.deepEqual(sorted.get('b'), { category: 'preference' }, 'the first answer for a note stands');
  assert.equal(sorted.has('c'), false);
  assert.equal(sorted.size, 2);
});

test('a day is only kept for a plan or an event, and only when it is a real day', () => {
  const sorted = readSorting('1. plan | 2026-13-40\n2) identity | 2026-09-12\n- 3 | event | 2026-09-11', notes);
  assert.deepEqual(sorted.get('a'), { category: 'plan' });
  assert.deepEqual(sorted.get('b'), { category: 'identity' });
  assert.deepEqual(sorted.get('c'), { category: 'event', when: '2026-09-11' });
});

test('an unsorted record is guessed from its kind and wording, and no guess is ever passing', () => {
  assert.equal(guessCategory({ kind: 'relationship', text: 'Johnny is their stepfather' }), 'person');
  assert.equal(guessCategory({ kind: 'preference', text: 'Reply length: as much as she wants.' }), 'instruction');
  assert.equal(guessCategory({ kind: 'preference', text: "Don't nag about the same thing twice" }), 'instruction');
  assert.equal(guessCategory({ kind: 'preference', text: 'Prefers dark mode for the interface.' }), 'preference');
  assert.equal(guessCategory({ kind: 'event', text: 'Pick up the motherboard from Umart tomorrow' }), 'plan');
  assert.equal(guessCategory({ kind: 'event', text: 'Replaced a faulty RAM stick' }), 'event');
  assert.equal(guessCategory({ kind: 'fact', text: 'Is currently rereading Chainsaw Man' }), 'ongoing');
  assert.equal(guessCategory({ kind: 'fact', text: 'Is allergic to shellfish' }), 'identity');
  assert.ok(isCategory('passing') && !isCategory('chatter'));
});

test('a plan whose day has gone is an event, and an undated one stops being ahead after a fortnight', () => {
  const dated = record({ id: 'p', text: 'Psychologist on Friday', kind: 'event', category: 'plan', when: '2026-09-18' });
  assert.equal(categoryOf(dated, NOW), 'plan');
  assert.equal(categoryOf(dated, new Date('2026-09-19T12:00:00.000Z')), 'plan', 'a day of grace either side of midnight');
  assert.equal(categoryOf(dated, new Date('2026-09-21T00:00:00.000Z')), 'event');
  const undated = record({ id: 'u', text: 'Considering an RX 6750 XT', kind: 'event', category: 'plan', lastSeenAt: '2026-09-10T00:00:00.000Z' });
  assert.equal(categoryOf(undated, NOW), 'plan');
  assert.equal(categoryOf(undated, new Date(Date.parse('2026-09-10T00:00:00.000Z') + (UNDATED_PLAN_DAYS + 1) * 86_400_000)), 'event');
  assert.equal(categoryOf(dated), 'plan', 'without a clock nothing settles');
});

test('importance follows the category once sorted, and is left alone until then', () => {
  const unsorted = record({ id: 'w', text: 'Works a long day from 10am to 4pm, then an event', importance: 0.85 });
  assert.equal(importanceOf(unsorted, NOW), 0.85);
  assert.equal(importanceOf({ ...unsorted, category: 'event' }, NOW), 0.6, 'a day is never permanent');
  assert.equal(importanceOf({ ...unsorted, category: 'instruction', importance: 0.2 }, NOW), 0.85);
  assert.equal(importanceOf({ ...unsorted, category: 'passing' }, NOW), 0.1);
  assert.equal(importanceOf(record({ id: 'o', text: 'x', category: 'ongoing', importance: 0.9 }), NOW), 0.45);
});

test('the sorting survives a read from disk, and anything that is not a category or a day is dropped', () => {
  const [kept, junk] = migrateMemories([
    record({ id: 'a', text: 'Psychologist on Friday', category: 'plan', when: '2026-09-18' }),
    { ...record({ id: 'b', text: 'Something' }), category: 'chatter', when: 'Friday' },
  ], NOW.toISOString());
  assert.equal(kept.category, 'plan');
  assert.equal(kept.when, '2026-09-18');
  assert.equal('category' in junk, false);
  assert.equal('when' in junk, false);
});

test('a copy from the desk, which drops the sorting on read, does not unsort a record', () => {
  const mine = [record({ id: 'a', text: 'Psychologist on Friday', kind: 'event', category: 'plan', when: '2026-09-18' })];
  const theirs = [record({ id: 'a', text: 'Psychologist on Friday', kind: 'event', lastSeenAt: '2026-09-12T00:00:00.000Z', mentions: 2 })];
  const merged = mergeMemories(mine, theirs, NOW.toISOString());
  assert.equal(merged.memories[0].category, 'plan');
  assert.equal(merged.memories[0].when, '2026-09-18');
  assert.equal(merged.memories[0].mentions, 2);
  // Nothing new either way: the same record again is not a change.
  assert.equal(mergeMemories(merged.memories, merged.memories, NOW.toISOString()).updated, 0);
});

test('hourly echoes leave the evidence log, and the days it was raised on stay countable', () => {
  const hourly = Array.from({ length: 48 }, (_, hour) => ({ at: new Date(Date.parse('2026-09-01T00:00:00.000Z') + hour * 3_600_000).toISOString(), kind: 'repeat' as const, source: 'explicit' as const }));
  const tidied = tidyEvidence([{ at: '2026-08-31T10:00:00.000Z', kind: 'statement', source: 'explicit' }, ...hourly, { at: '2026-09-02T05:00:00.000Z', kind: 'confirmation', source: 'explicit' }]);
  assert.deepEqual(tidied.map(entry => `${entry.kind} ${entry.at.slice(0, 10)}`), ['statement 2026-08-31', 'repeat 2026-09-01', 'repeat 2026-09-02', 'confirmation 2026-09-02']);
  // And a desk copy with the long log is not a change against the tidied one.
  const mine = migrateMemories([record({ id: 'v', text: 'Bins go out on Thursday', evidence: hourly })], NOW.toISOString());
  assert.equal(mergeMemories(mine, [record({ id: 'v', text: 'Bins go out on Thursday', evidence: hourly })], NOW.toISOString()).updated, 0);
});

test('a line read off the same page again is seen, not said again', () => {
  const page = record({ id: 'v', text: 'The bins go out on Thursday', source: 'explicit', mentions: 3 });
  const seen = rememberInto([page], { text: 'The bins go out on Thursday', kind: 'fact', id: 'new', now: NOW.toISOString(), source: 'explicit', resighting: true });
  assert.equal(seen.created, false);
  assert.equal(seen.record.mentions, 3);
  assert.equal(seen.record.lastSeenAt, NOW.toISOString());
  assert.equal(seen.record.evidence, undefined, 'no evidence entry for a resighting');
});

test('said again, a dormant or archived memory is current again — unless it was ticked off', () => {
  const dormant = record({ id: 'd', text: 'Is building a PC for Logan', status: 'dormant' });
  assert.equal(rememberInto([dormant], { text: 'Is building a PC for Logan', kind: 'fact', id: 'x', now: NOW.toISOString() }).record.status, 'active');
  const closed = record({ id: 'c', text: 'Pick up the motherboard from Umart', kind: 'event', status: 'dormant', evidence: [{ at: '2026-09-11T00:00:00.000Z', kind: 'closed', source: 'conversation' }] });
  assert.equal(rememberInto([closed], { text: 'Pick up the motherboard from Umart', kind: 'event', id: 'x', now: NOW.toISOString() }).record.status, 'dormant');
});

test('the cap takes what was sorted as passing first, and never what is lasting', () => {
  const memories = [
    record({ id: 'passing', text: 'Opened Discord', category: 'passing', mentions: 9, lastSeenAt: '2026-09-16T00:00:00.000Z' }),
    record({ id: 'event', text: 'Replaced a RAM stick', category: 'event', lastSeenAt: '2026-09-01T00:00:00.000Z' }),
    record({ id: 'identity', text: 'Works at Happytel on Sundays', category: 'identity', importance: 0.2, lastSeenAt: '2025-01-01T00:00:00.000Z' }),
  ];
  const result = pruneMemories(memories, 2);
  assert.deepEqual(result.evicted.map(memory => memory.id), ['passing']);
});

test('retrieval never offers a passing record, and keeps half its budget for what the message is about', () => {
  const rules = Array.from({ length: 20 }, (_, index) => record({ id: `rule${index}`, text: `Rule number ${index} for how she talks`, kind: 'preference', category: 'instruction', importance: 0.85 }));
  const psych = record({ id: 'psych', text: 'Rescheduled their psychologist appointment to Friday at 8:45', kind: 'event', category: 'plan', when: '2026-09-18' });
  const junk = record({ id: 'junk', text: 'Opened the psychologist booking page', kind: 'event', category: 'passing' });
  const picked = retrieveMemories([...rules, psych, junk], 'when is my psychologist appointment', { limit: 12, now: NOW, semantic: new Map([['psych', 0.6], ['junk', 0.7]]) });
  const ids = picked.map(entry => entry.memory.id);
  assert.ok(ids.includes('psych'), 'twenty rules used to push this out');
  assert.ok(!ids.includes('junk'));
  assert.equal(ids.length, 12);
});

test('the latest message is matched on its own too, so earlier lines about something else do not drown it', () => {
  const ram = record({ id: 'ram', text: 'Replaced a faulty RAM stick; the new kit runs stable', kind: 'event', category: 'event' });
  const query = 'the traffic was awful this morning ugh anyway did the shop open on time did I get the RAM working in the end';
  const diluted = retrieveMemories([ram], query, { now: NOW, floor: 0.3, semantic: new Map([['ram', 0.1]]) });
  assert.equal(diluted.length, 0);
  const focused = retrieveMemories([ram], query, { now: NOW, floor: 0.3, semantic: new Map([['ram', 0.1]]), focus: { message: 'did I get the RAM working in the end', semantic: new Map([['ram', 0.45]]) } });
  assert.deepEqual(focused.map(entry => entry.memory.id), ['ram']);
});

test('the same person written twice is one line, and the fuller one stays', () => {
  const kept = withoutRestatements([
    record({ id: 'short', text: "Tommy's stepfather is named Johnny", kind: 'relationship' }),
    record({ id: 'long', text: "Johnny — Tommy's stepfather; his mom's second husband, later divorced from her.", kind: 'relationship' }),
    record({ id: 'other', text: 'Sudin is their business partner', kind: 'relationship' }),
  ]);
  assert.deepEqual(kept.map(memory => memory.id), ['long', 'other']);
});

test('each category reaches its block: rules and tastes, people, who he is, the moment, what is ahead', () => {
  const memories = [
    ...['jokes', 'emoji', 'mornings', 'nagging', 'length', 'topics', 'reminders', 'interrupting', 'nicknames', 'therapy', 'repeating', 'corrections']
      .map((topic, index) => record({ id: `pref${index}`, text: `Standing rule about ${topic}`, kind: 'preference', category: 'instruction', importance: 0.85 })),
    ...Array.from({ length: 8 }, (_, index) => record({ id: `rel${index}`, text: `Friend${'abcdefgh'[index]} is someone they know`, kind: 'relationship', category: 'person', importance: 0.8 })),
    record({ id: 'job', text: 'Works at Happytel Rockingham on Sundays', category: 'identity', importance: 0.6 }),
    record({ id: 'ram', text: 'Replaced a faulty RAM stick; new kit runs stable at 4800 MHz', kind: 'event', category: 'event', when: '2026-09-13' }),
    record({ id: 'psu', text: 'Decided on a 1000W PSU for the dual-GPU build', kind: 'event', category: 'event', when: '2026-09-13' }),
    record({ id: 'psych', text: 'Psychologist appointment at 8:45 AM', kind: 'event', category: 'plan', when: '2026-09-18' }),
    record({ id: 'model', text: 'Is building a 3D character model in Blender', category: 'ongoing', lastSeenAt: '2026-09-15T00:00:00.000Z' }),
    record({ id: 'junk', text: 'Set the CPU tier to Mid-tier in a configurator', category: 'passing' }),
    record({ id: 'ticked', text: 'Pick up the motherboard from Umart', kind: 'event', category: 'plan', when: '2026-09-18', status: 'dormant' }),
  ];
  const sources = {
    character: { identity: '', style: '' },
    profile: { nickname: 'Tommy', occupation: '', about: '' },
    memories,
    sessions: [],
    query: 'did I get the RAM working in the end',
    semantic: new Map([['ram', 0.5], ['psu', 0.05], ['junk', 0.4]]),
    now: NOW,
  };
  const { text } = formatMemoryBlocks(defaultMemoryBlocks(), sources, { omit: ['persona'], compact: true });
  const section = (label: string) => text.match(new RegExp(`<${label}>[\\s\\S]*?</${label}>`))?.[0] ?? '';
  assert.match(section('human'), /Works at Happytel Rockingham on Sundays/, 'who he is, every turn');
  assert.match(section('human'), /Replaced a faulty RAM stick; new kit runs stable at 4800 MHz \(Sun, 13 Sept\)/, 'what he asked about, with its day');
  assert.doesNotMatch(section('human'), /1000W PSU/, 'not what he did not ask about');
  assert.match(section('preferences'), /Standing rule about corrections/);
  assert.equal(section('preferences').split('\n').filter(line => line.startsWith('- ')).length, 12, 'every rule, whatever the budget elsewhere');
  assert.match(section('relationship'), /Friendh/);
  assert.match(section('current_project'), /Psychologist appointment at 8:45 AM \(Fri, 18 Sept\)/);
  assert.match(section('current_project'), /3D character model/);
  assert.doesNotMatch(text, /Mid-tier/, 'passing is never shown');
  assert.doesNotMatch(section('current_project'), /Umart/, 'a plan ticked off is not still ahead');
});

test('the vault page shows what a record was sorted as, and leaves out what is passing', () => {
  const note = memoriesNote([
    record({ id: 'a', text: 'Works at Happytel on Sundays', category: 'identity', subject: 'Work' }),
    record({ id: 'b', text: 'Opened Discord', category: 'passing' }),
  ]);
  assert.match(note.text, /- Works at Happytel on Sundays \*\(identity, 2026-09-10\)\*/);
  assert.doesNotMatch(note.text, /Discord/);
  assert.match(note.text, /count: 1/);
});
