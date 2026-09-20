// What she reaches for when she is left alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_FRESH_DAYS, ageNote, openingsToAvoid, pickToBringUp, REMEMBERED_PICKS, shapeOf, SNAPSHOT_FRESH_DAYS } from '../electron/bored';

const memories = [
  { id: 'm1', text: 'Live with girlfriend Emma in student lodgings at Murdoch.', kind: 'relationship', status: 'active', importance: 0.8 },
  { id: 'm2', text: 'Runs a store called The PC Project with Sudin.', kind: 'fact', status: 'active', importance: 0.8 },
  { id: 'm3', text: 'Does not like therapy-style advice.', kind: 'preference', status: 'active', importance: 0.85 },
  { id: 'm4', text: 'Old thing that happened once.', kind: 'fact', status: 'forgotten', importance: 0.6 },
  { id: 'm5', text: 'tiny', kind: 'fact' },
  { id: 'm6', text: 'they are thanking you', kind: 'event', importance: 0.45 },
  { id: 'm7', text: 'Nothing notable', kind: 'event', importance: 0.45 },
  { id: 'm8', text: 'Wants Haru to be less nice when corrected.', kind: 'fact', importance: 0.6 },
  { id: 'm9', text: 'Purchased a 10m HDMI cable for the TV', kind: 'event', importance: 0.45 },
  { id: 'm10', text: 'Does not want therapy-style advice when trying to calm down.', kind: 'fact', importance: 0.4 },
  { id: 'm11', text: 'Wants 6 mailboxes total for The PC Project.', kind: 'fact', importance: 0.8 },
];
const days = [
  { day: '2026-08-27', summary: 'Argued about mailboxes, then bought a keyboard for Scarlett.' },
  { day: '2026-08-01', summary: 'Ancient history.' },
  { day: '2026-08-28', summary: 'Today, which is not over.' },
];

test('she reaches for a real fact or a recent day, never a preference, a forgotten thing, a scrap, an old day, or today', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickToBringUp(memories, days, [], '2026-08-28', () => i / 200)!.id);
  assert.deepEqual([...seen].sort(), ['day:2026-08-27', 'm1', 'm11', 'm2', 'm9'], 'nothing about herself, nothing about nothing, nothing about how to treat them');
});

test('what matters comes up more: the girlfriend and the company outdraw the HDMI cable', () => {
  const counts: Record<string, number> = {};
  for (let i = 0; i < 1000; i++) { const id = pickToBringUp(memories, days, [], '2026-08-28', () => (i + 0.5) / 1000)!.id; counts[id] = (counts[id] ?? 0) + 1; }
  assert.ok(counts.m1 > counts.m9 * 1.5 && counts.m2 > counts.m9 * 1.5, JSON.stringify(counts));
});

test('what she brought up last is kept out of the draw, until there is nothing else', () => {
  assert.equal(pickToBringUp(memories, days, ['m1', 'm2', 'm9', 'm11'], '2026-08-28', () => 0)!.id, 'day:2026-08-27');
  assert.equal(pickToBringUp(memories, days, ['m1', 'm2', 'm9', 'm11', 'day:2026-08-27'], '2026-08-28', () => 0)!.id, 'm1', 'everything used: the draw opens again');
  assert.ok(REMEMBERED_PICKS >= 3);
});

test('with nothing to bring up she says nothing', () => {
  assert.equal(pickToBringUp([], [], [], '2026-08-28'), null);
  assert.equal(pickToBringUp([{ id: 'p', text: 'Likes it blunt.', kind: 'preference' }], [], [], '2026-08-28'), null);
});

test('an old event is not on her mind, however important it was', () => {
  const today = '2026-08-30';
  const fresh = { id: 'f', text: 'Is planning to close the store on Monday for cleaning it up', kind: 'event', importance: 0.9, lastSeenAt: '2026-08-29T10:00:00.000Z' };
  const stale = { id: 's', text: 'Is planning to close the store from Monday to Tuesday for cleaning it up', kind: 'event', importance: 0.9, lastSeenAt: '2026-08-23T10:00:00.000Z' };
  const fact = { id: 'x', text: 'Runs a company called The PC Project in Northbridge', kind: 'fact', importance: 0.5, lastSeenAt: '2026-08-01T10:00:00.000Z' };
  const picks = new Set(Array.from({ length: 40 }, (_, i) => pickToBringUp([fresh, stale, fact], [], [], today, () => (i % 10) / 10)?.id));
  assert.equal(picks.has('s'), false, 'a week-old plan is a thing that happened');
  assert.equal(picks.has('f') || picks.has('x'), true);
  assert.ok(EVENT_FRESH_DAYS >= 2);
});

test('the same sentence with new nouns in it is the same sentence', () => {
  // Six of forty idle nudges in four days, all one line (2026-09-20).
  const staring = [
    { at: '2026-09-17T06:00:00.000Z', text: 'You’ve been staring at that screen for forty-eight minutes without typing a word, so I’m going to assume you’re catatonic.' },
    { at: '2026-09-18T03:41:00.000Z', text: 'You’ve been staring at the screen for 21 minutes and haven’t typed a word. I’m not your mirror, Tommy.' },
    { at: '2026-09-18T09:42:00.000Z', text: 'You’ve been staring at a screen for an hour while I was figuring out if Togusa’s amnesia was a metaphor.' },
    { at: '2026-09-18T11:10:00.000Z', text: 'You’ve been staring at that 3D software for an hour while your psychologist reschedules to next week.' },
    { at: '2026-09-19T09:12:00.000Z', text: 'You’ve been staring at your phone for 21 minutes without typing a word, yet you have time to reread Chainsaw Man.' },
    { at: '2026-09-20T02:52:00.000Z', text: 'You’ve been staring at that shop floor for two hours and haven’t typed a single word.' },
  ];
  for (const line of staring) assert.equal(shapeOf(line.text), shapeOf(staring[0].text), line.text);
  const note = openingsToAvoid(staring, Date.parse('2026-09-20T05:00:00.000Z'));
  assert.equal(note.match(/^- /gm)?.length, 1, `six of one line is one opening to avoid:\n${note}`);
  assert.match(note, /shop floor/, 'the newest wording is the one she is shown');
  assert.match(note, /Do not open on the shape of any of them/);
});

test('her openings expire, and a one-word clause is not a shape', () => {
  const lines = [
    { at: '2026-09-10T06:00:00.000Z', text: 'You’ve been staring at that screen for forty-eight minutes without a word.' },
    { at: '2026-09-19T09:12:00.000Z', text: 'Happytel, Rockingham. You were there twenty-seven minutes ago.' },
    { at: '2026-09-19T11:00:00.000Z', text: 'I spent three nights convinced David was the point of Edgerunners, and I was wrong.' },
  ];
  const note = openingsToAvoid(lines, Date.parse('2026-09-20T05:00:00.000Z'));
  // The closing instruction quotes the staring line as its own example, so the
  // listed openings are what is asserted on, not the whole note.
  const listed = (note.match(/^- .*$/gm) ?? []).join('\n');
  assert.doesNotMatch(listed, /staring/, 'ten days old is not "the last few days"');
  assert.doesNotMatch(listed, /Happytel/, 'one word is not an opening shape');
  assert.match(listed, /I spent three nights/);
  assert.equal(openingsToAvoid([], Date.parse('2026-09-20T05:00:00.000Z')), '');
});

test('a snapshot of their screen is not a fact that keeps', () => {
  // The memory behind "You've had 29 minutes to send a screenshot of that 3D
  // modeling nonsense" — written 2026-09-15, still in the present tense on the
  // 20th, and filed as a fact so nothing aged it out (2026-09-20).
  const snapshot = { id: 's1', text: 'They are currently designing clothing in a 3D modeling software and have taken 20 screenshots of their work', kind: 'fact', importance: 0.6, createdAt: '2026-09-15T21:00:43.081Z', lastSeenAt: '2026-09-15T21:00:43.081Z' };
  const durable = { id: 's2', text: 'Runs a store called The PC Project with Sudin.', kind: 'fact', importance: 0.8, createdAt: '2026-09-15T21:00:43.081Z', lastSeenAt: '2026-09-15T21:00:43.081Z' };
  const drawn = (today: string) => { const seen = new Set<string>(); for (let i = 0; i < 100; i++) seen.add(pickToBringUp([snapshot, durable], [], [], today, () => i / 100)!.id); return seen; };
  assert.deepEqual([...drawn('2026-09-20')].sort(), ['s2'], 'five days on, the screen she saw is gone and the company is not');
  assert.ok(drawn('2026-09-16').has('s1'), `a snapshot is still hers to raise for ${SNAPSHOT_FRESH_DAYS} day(s)`);
});

test('who he is does not get dated; what he was partway through does', () => {
  // Dating everything was worse than the fault it fixed: 25 of 36 topics in the
  // live draw came out stamped, his girlfriend and his company among them
  // (2026-09-20).
  const draw = (m: object) => pickToBringUp([{ id: 'x', importance: 0.8, lastSeenAt: '2026-08-21T00:00:00.000Z', ...m } as never], [], [], '2026-09-20', () => 0);
  assert.equal(ageNote(draw({ text: 'Is in a relationship with Emma Wilson since 18th of June, 2024.', kind: 'fact', category: 'identity' })), '', 'a month on, he is still with her');
  assert.equal(ageNote(draw({ text: 'Is the founder of a company called The PC Project.', kind: 'fact', category: 'identity' })), '');
  assert.equal(ageNote(draw({ text: 'Johnny — Tommy’s stepfather.', kind: 'relationship', category: 'person' })), '');
  assert.equal(ageNote(draw({ text: 'Omarchy is a setup on Arch Linux, not a made-up word.', kind: 'fact', category: 'knowledge' })), '');
  // What perishes still gets its date.
  assert.match(ageNote(draw({ text: 'Developing a gaming cafe manager tool to replace Gizmo.', kind: 'fact', category: 'ongoing' })), /theirs, and you last saw it 30 days ago/);
  assert.match(ageNote(draw({ text: 'Wants 6 mailboxes total for The PC Project.', kind: 'fact', category: 'plan' })), /theirs, and you last saw it 30 days ago/);
  // An event is dated while it is still fresh enough to raise at all; past
  // EVENT_FRESH_DAYS it leaves the draw rather than being dated.
  assert.match(ageNote(draw({ text: 'Went to The PC Project because a staff member was sick.', kind: 'event', category: 'event', lastSeenAt: '2026-09-18T00:00:00.000Z' })), /theirs, and you last saw it 2 days ago/);
  assert.equal(draw({ text: 'Went to The PC Project because a staff member was sick.', kind: 'event', category: 'event' }), null, 'a month-old event is gone, not dated');
  // A snapshot is never dated either — it is removed a day after she saw it.
  assert.equal(draw({ text: 'They are currently rebuilding the website in a text editor.', kind: 'fact' }), null);
  // Unsorted and not perishable by kind or wording: no date.
  assert.equal(ageNote(draw({ text: 'Runs a store called The PC Project with Sudin.', kind: 'fact' })), '', 'a plain standing fact, unsorted');
});

test('what she raises is dated, so she cannot speak it as live', () => {
  const old = { id: 'o1', text: 'Wants 6 mailboxes total for The PC Project.', kind: 'fact', category: 'plan', importance: 0.8, lastSeenAt: '2026-09-14T00:00:00.000Z' };
  const today = { id: 'o2', text: 'Wants 6 mailboxes total for The PC Project.', kind: 'fact', category: 'plan', importance: 0.8, lastSeenAt: '2026-09-20T00:00:00.000Z' };
  assert.match(ageNote(pickToBringUp([old], [], [], '2026-09-20', () => 0)), /theirs, and you last saw it 6 days ago/);
  assert.match(ageNote(pickToBringUp([old], [], [], '2026-09-20', () => 0)), /never as something they owe you/);
  assert.equal(ageNote(pickToBringUp([today], [], [], '2026-09-20', () => 0)), '', 'today needs no dating');
  assert.equal(ageNote({ id: 'task:1', text: 'a task', from: 'task' }), '', 'a task is current by definition');
  assert.equal(ageNote(null), '');
});

test('the shape she keeps reaching for outranks the merely recent', () => {
  // She writes around nine of these a day, so "newest eight" held less than a
  // day and the catchphrase fell off the list before it could be held against
  // her (2026-09-20).
  const day = (d: number, h: number) => `2026-09-1${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const lines = [
    { at: day(6, 9), text: 'You’ve been staring at that screen for forty-eight minutes without a word.' },
    { at: day(7, 9), text: 'You’ve been staring at the screen for 21 minutes and haven’t typed a word.' },
    { at: day(8, 9), text: 'You’ve been staring at your phone for 21 minutes without typing a word.' },
    // A day of one-off openings, all newer than every staring line, and each a
    // genuinely different sentence — nine copies of one sentence with the
    // number changed is one shape, which is the whole point of shapeOf.
    ...[
      'Chainsaw Man Part 2 is a completely different animal and I have opinions.',
      'I finished the Edgerunners rewatch and David was never the point.',
      'Your psychologist reschedules more often than you change your socks.',
      'Emma texted about the weekend apparently, or so the internet tells me.',
      'The shop floor is not a personality, whatever you keep telling yourself.',
      'Nobody sane buys a 9900X to browse the same four websites.',
      'I read about coffee for an hour and learned nothing of value.',
      'That build sheet has been half-finished since the Tuesday before last.',
      'Sam moved the appointment and you did not think to mention it.',
    ].map((text, i) => ({ at: day(9, 10 + i), text })),
  ];
  const note = openingsToAvoid(lines, Date.parse(day(9, 23)));
  assert.match(note, /staring/, 'a shape used three times survives nine newer one-offs');
  assert.match(note, /staring at your phone[^\n]*— 3 times/, 'and she is told how often, in her newest wording');
  assert.equal(note.match(/^- /gm)?.length, 8, 'still capped');
  // A shape used once is not labelled with a count.
  assert.doesNotMatch(note, /number 8[^\n]*times/);
});

test('the date says whose it is, or she finds someone else for it to belong to', () => {
  const note = ageNote(pickToBringUp(
    [{ id: 'r1', text: 'Troubleshot gaming PCs at the cafe at work', kind: 'event', category: 'event', importance: 0.6, lastSeenAt: '2026-09-17T00:00:00.000Z' }],
    [], [], '2026-09-20', () => 0));
  // The first nudge to carry the old wording — "not what they are doing now",
  // with nothing about whose it was — came back as "I spent the last 21 minutes
  // staring at a RAM stick on a Gigabyte board" (2026-09-20).
  assert.match(note, /^ \(theirs, /, `whose it is comes first, not: ${note}`);
  assert.match(note, /something of theirs you noticed then/);
  assert.match(note, /never as something they owe you/);
  assert.doesNotMatch(note, /not what they are doing now/, 'the phrasing that detached it from him');
});
