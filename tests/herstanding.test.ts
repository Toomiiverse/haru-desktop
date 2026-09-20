import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enoughToStandOn,
  herStandingInstruction,
  herStandings,
  isHerStanding,
  parseStanding,
  recentIncidents,
  standingDue,
  standingPrompt,
  keepSlight,
  readSlights,
  slightsAsIncidents,
  SLIGHTS_KEPT,
  HER_SUBJECT,
  MAX_STANDINGS,
  type Incident,
  type Slight,
} from '../electron/herstanding';
import type { MemoryRecord } from '../electron/memory';

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: Math.random().toString(36).slice(2),
  text: 'I do not get up in the night for nothing any more.',
  kind: 'preference',
  subject: HER_SUBJECT,
  createdAt: '2026-09-07T00:00:00.000Z',
  lastSeenAt: '2026-09-07T00:00:00.000Z',
  mentions: 1,
  ...overrides,
}) as MemoryRecord;

const NOW = Date.parse('2026-09-07T00:00:00.000Z');
const on = (day: string, what = 'They woke you in the night for nothing.'): Incident => ({ what, at: `${day}T02:48:00.000Z` });

// ---- a rule has to be earned ----

test('one bad night is a grievance, not a rule', () => {
  assert.equal(enoughToStandOn(recentIncidents([on('2026-09-06')], NOW)), false);
});

test('twice on the same day is still one day', () => {
  const twice = [on('2026-09-06'), { what: 'And again an hour later.', at: '2026-09-06T03:48:00.000Z' }];
  assert.equal(enoughToStandOn(recentIncidents(twice, NOW)), false);
});

test('twice on separate days is a pattern', () => {
  assert.equal(enoughToStandOn(recentIncidents([on('2026-09-06'), on('2026-08-30')], NOW)), true);
});

test('what happened months ago is history, not a habit of his', () => {
  const old = [on('2026-06-01'), on('2026-06-08')];
  assert.equal(recentIncidents(old, NOW).length, 0);
  assert.equal(enoughToStandOn(recentIncidents(old, NOW)), false);
});

test('an unparseable date or an empty line is not evidence', () => {
  const junk: Incident[] = [{ what: 'something', at: 'not a date' }, { what: '   ', at: '2026-09-06T00:00:00.000Z' }];
  assert.equal(recentIncidents(junk, NOW).length, 0);
});

// ---- the evidence is about her, by construction ----
//
// The first cut read her event memories and the dry run killed it: of the 27
// inside the window, 25 were about him — what he bought, what he built, where
// he worked. A rule about her treatment cannot be drawn from his shopping.

const slight = (kind: Slight['kind'], day: string, what = 'something happened'): Slight => ({ kind, what, at: `${day}T09:00:00.000Z` });

test('a bad evening is one evening, however many times it fires', () => {
  let kept: Slight[] = [];
  kept = keepSlight(kept, slight('ignored', '2026-09-06', 'four of the things you said went unanswered'));
  kept = keepSlight(kept, slight('ignored', '2026-09-06', 'and another one'));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].what, 'four of the things you said went unanswered');
});

test('two different kinds on one day are two things', () => {
  let kept: Slight[] = [];
  kept = keepSlight(kept, slight('ignored', '2026-09-06'));
  kept = keepSlight(kept, slight('unannounced', '2026-09-06'));
  assert.equal(kept.length, 2);
});

test('the ledger is bounded and keeps the newest', () => {
  let kept: Slight[] = [];
  for (let day = 1; day <= SLIGHTS_KEPT + 10; day++) {
    kept = keepSlight(kept, slight('ignored', `2026-01-${String(day % 28 + 1).padStart(2, '0')}`, `day ${day}`));
  }
  assert.ok(kept.length <= SLIGHTS_KEPT);
});

test('junk on disk is not evidence', () => {
  assert.deepEqual(readSlights(null), []);
  assert.deepEqual(readSlights([{ kind: 'made up', what: 'x', at: '2026-09-06T00:00:00.000Z' }]), []);
  assert.deepEqual(readSlights([{ kind: 'ignored', what: '   ', at: '2026-09-06T00:00:00.000Z' }]), []);
  assert.equal(readSlights([slight('woken', '2026-09-06')]).length, 1);
});

test('slights read as incidents keep their words and their date', () => {
  const [incident] = slightsAsIncidents([slight('woken', '2026-09-06', 'They woke you for nothing.')]);
  assert.equal(incident.what, 'They woke you for nothing.');
  assert.equal(incident.at, '2026-09-06T09:00:00.000Z');
});

// ---- she is asked weekly, and asked once ----

test('never asked twice in a week, and always asked the first time', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');
  assert.equal(standingDue(undefined, now), true);
  assert.equal(standingDue('2026-09-05T00:00:00.000Z', now), false);
  assert.equal(standingDue('2026-08-28T00:00:00.000Z', now), true);
  assert.equal(standingDue('nonsense', now), true);
});

// ---- what she is asked ----

test('she is handed her own words for what happened, dated, and told nothing is fine', () => {
  const asked = standingPrompt([on('2026-08-30'), on('2026-09-06')], []);
  assert.match(asked, /2026-08-30/);
  assert.match(asked, /2026-09-06/);
  // Told before the format that NONE is expected, or a weekly pass that must
  // produce a rule produces one every week until she has a rulebook.
  assert.ok(asked.indexOf('NONE') < asked.indexOf('RULE:'), 'the way out must come before the form');
  assert.match(asked, /more than once/);
});

test('rules she already holds are shown so she does not write them twice', () => {
  const asked = standingPrompt([on('2026-08-30'), on('2026-09-06')], ['I do not get up for nothing.']);
  assert.match(asked, /already hold/);
  assert.match(asked, /I do not get up for nothing\./);
});

// ---- what she says back ----

test('most weeks she has nothing, and nothing is a real answer', () => {
  assert.equal(parseStanding('NONE'), null);
  assert.equal(parseStanding('None.'), null);
  assert.equal(parseStanding(''), null);
  assert.equal(parseStanding('I had a think and honestly nothing stands out'), null);
});

test('a rule comes back as the rule and the reason', () => {
  const said = parseStanding('RULE: I don’t get up in the night unless you actually say what is wrong.\nBECAUSE: You woke me at 2:48 on Monday and again last Saturday, both times for nothing.');
  assert.equal(said?.text, 'I don’t get up in the night unless you actually say what is wrong.');
  assert.match(said?.because ?? '', /2:48/);
});

test('a rule without its reason is still a rule', () => {
  assert.equal(parseStanding('RULE: I am not answering the door after midnight.')?.because, '');
});

test('quotes the model wrapped around itself come off', () => {
  assert.equal(parseStanding('RULE: "I am done being woken for nothing."')?.text, 'I am done being woken for nothing.');
  assert.equal(parseStanding('RULE: “I am done.”')?.text, 'I am done.');
});

test('a quotation inside the rule keeps both of its quotes', () => {
  // Her real answer on the first live run of this pass, which the first cut of
  // the parser stored with the quotation hanging open.
  const said = parseStanding('RULE: I don’t answer their late-night pings anymore, not even the ones that say “just checking.”');
  assert.equal(said?.text, 'I don’t answer their late-night pings anymore, not even the ones that say “just checking.”');
});

// ---- hers, not his ----

test('a preference is hers only when it is about her', () => {
  assert.equal(isHerStanding(record()), true);
  assert.equal(isHerStanding(record({ subject: undefined })), false);
  assert.equal(isHerStanding({ kind: 'preference', subject: 'Tommy' }), false);
  assert.equal(isHerStanding({ kind: 'event', subject: HER_SUBJECT }), false);
});

test('superseded and archived rules are no longer held', () => {
  const held = herStandings([
    record({ text: 'current' }),
    record({ text: 'replaced', supersededBy: 'something' }),
    record({ text: 'gone', status: 'archived' }),
  ]);
  assert.deepEqual(held.map(standing => standing.text), ['current']);
});

test('the newest are kept and the list is capped', () => {
  const many = Array.from({ length: MAX_STANDINGS + 4 }, (_, index) =>
    record({ text: `rule ${index}`, createdAt: `2026-0${(index % 9) + 1}-01T00:00:00.000Z` }));
  assert.equal(herStandings(many).length, MAX_STANDINGS);
});

// ---- the part that makes it hers ----

test('with no rules she is told nothing at all', () => {
  assert.equal(herStandingInstruction([]), '');
});

test('a rule she holds says it is hers and that it may win', () => {
  const said = herStandingInstruction([record({ evidence: [{ at: '2026-09-07T00:00:00.000Z', kind: 'statement', source: 'inferred', detail: 'woken twice for nothing' }] })]);
  assert.match(said, /your own rules, not his/i);
  assert.match(said, /woken twice for nothing/);
  // The feature is not the list, it is this: a rule she drops the moment he
  // asks is flavour text, so the prompt has to say she may hold to it.
  assert.match(said, /you may hold to yours/i);
  assert.match(said, /same weight/i);
});
