// Her old chats, searched on purpose — and the recall that guesses at them unasked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatIndex, chatHitsNote, chatTerms, embedFormat, embedText, keywordScores, mentionsAny, rareTerms, searchChats, SEARCH_FLOOR } from '../electron/chatsearch';
import { exchangesFrom, pickRecalled, recallNote } from '../electron/recall';
import { withRelativeDates } from '../electron/dates';
import { chatTools, pastRelevant, runChatTool, type ToolAvailability, type ToolDeps } from '../electron/tools';

const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' });
const turns = (...lines: string[]) => lines.map((content, at) => ({ role: at % 2 ? 'assistant' : 'user', content }));
const archive = {
  '2026-09-08': turns(
    'The customer board has a button instead of a battery',
    'Use the Clear CMOS button, not the Flash BIOS one.',
    'Replacement kit was slower at 4800, I will test tomorrow',
    'Fine. Test it properly.',
  ),
  '2026-09-10': turns(
    'Motherboard issues again with a customer named Logan, MSI X870E Tomahawk with 3 drives, will not get past BIOS',
    'Probably booting from the wrong disk.',
    'Fixed it, turns out I had the wrong drive lol',
    'Of course it was. What are you ordering?',
    'Probably some Thai food from the place down the road',
    'Get the green curry.',
  ),
  '2026-09-11': turns(
    'I stayed up last night because Ocarina of Time is getting a remake',
    'That was announced in April.',
    'Alright goodnight Haru, sweet dreams',
    'Goodnight. Sleep.',
  ),
};
const all = exchangesFrom(archive, [], '2026-09-17', 365);
const index = buildChatIndex(all);
const id = (fragment: string) => all.find(exchange => exchange.text.includes(fragment))!.id;

test('terms: stop words and filler out, endings off, so drives meets drive and batteries meets battery', () => {
  assert.deepEqual(chatTerms("I'm booting from the drives, haha okay"), ['boot', 'drive']);
  assert.deepEqual(chatTerms('batteries'), ['battery']);
  assert.deepEqual(chatTerms('goodnight Haru, sweet dreams lol'), [], 'pleasantries name nothing');
  assert.deepEqual(chatTerms('it is 5600 on 2 of them'), ['5600', '2'], 'numbers are kept, short or not');
});

test('a specific word is one few exchanges use; small talk has none', () => {
  assert.ok(rareTerms(index, 'what was wrong with Logans PC').has('logan'));
  assert.equal(rareTerms(index, 'how are you going').size, 0);
  assert.equal(rareTerms(index, 'never said before: zeppelin').size, 0, 'a word nobody used cannot be shared');
  assert.ok(mentionsAny(index, id('Logan'), new Set(['logan'])));
  assert.ok(!mentionsAny(index, id('Ocarina'), new Set(['logan'])));
});

test('words find the exchange with no vectors at all, dated, with the exchange either side of it', () => {
  const hits = searchChats(index, { query: 'Logan', vectors: new Map() });
  assert.equal(hits.length, 1, 'only what shares a word comes back');
  assert.equal(hits[0].exchange.id, id('Logan'));
  assert.equal(hits[0].before, undefined, 'nothing before the first exchange of a day');
  assert.equal(hits[0].after?.id, id('wrong drive'), 'the next exchange rides along');
  assert.ok(keywordScores(index, 'Logan tomahawk')[all.indexOf(hits[0].exchange)] > keywordScores(index, 'Logan')[all.indexOf(hits[0].exchange)]);
  const note = chatHitsNote(hits, weekday);
  assert.match(note, /^\[Thursday 2026-09-10\]\nThem: Motherboard issues again/);
  assert.match(note, /wrong drive/);
});

test('a neighbour is never shown twice as a find of its own, and nothing crosses into another day', () => {
  const hits = searchChats(index, { query: 'drive Logan', vectors: new Map() });
  assert.equal(hits.length, 1, 'the wrong-drive exchange is already beside the Logan one');
  const late = searchChats(index, { query: 'Thai curry', vectors: new Map() });
  assert.equal(late[0].after, undefined, 'the last exchange of a day has nothing after it');
});

test('a date range narrows it, a day of slack each way for a model that counts a day out', () => {
  assert.equal(searchChats(index, { query: 'BIOS', vectors: new Map(), from: '2026-09-10' }).length, 1);
  assert.equal(searchChats(index, { query: 'BIOS', vectors: new Map(), to: '2026-09-07' }).length, 1, 'the 8th is a day past the 7th, so it is still in');
  assert.equal(searchChats(index, { query: 'BIOS', vectors: new Map(), to: '2026-09-06' }).length, 0);
  assert.equal(searchChats(index, { query: 'BIOS', vectors: new Map(), from: 'last week' }).length, 2, 'a range that is not a date is not a range');
});

test('meaning finds what shares no word, but only when it is really close', () => {
  const vectors = new Map(all.map(exchange => [exchange.id, exchange.text.includes('Ocarina') ? [1, 0, 0] : [0, 1, 0]]));
  const close = searchChats(index, { query: 'zelda', queryVector: [0.95, 0.3, 0], vectors });
  assert.equal(close[0]?.exchange.id, id('Ocarina'));
  const far = searchChats(index, { query: 'zelda', queryVector: [SEARCH_FLOOR - 0.3, SEARCH_FLOOR - 0.3, 1], vectors });
  assert.equal(far.length, 0, 'nothing close and no word shared: nothing, rather than the least bad');
});

test('the prefixes are for nomic only, and the format says whether they were used', () => {
  assert.equal(embedText('nomic-embed-text', 'query', 'logan'), 'search_query: logan');
  assert.equal(embedText('nomic-embed-text:latest', 'document', 'x'), 'search_document: x');
  assert.equal(embedText('mxbai-embed-large', 'query', 'logan'), 'logan');
  assert.notEqual(embedFormat('nomic-embed-text'), embedFormat('mxbai-embed-large'));
  assert.notEqual(embedFormat('nomic-embed-text'), '', 'an old unprefixed cache (no format) never matches');
});

test('relative dates are written out from the day they were said', () => {
  assert.equal(withRelativeDates('I stayed up last night', '2026-09-11'), 'I stayed up last night (Thu 10 Sep)');
  assert.equal(withRelativeDates('Yesterday and tomorrow', '2026-09-01'), 'Yesterday (Mon 31 Aug) and tomorrow (Wed 2 Sep)');
  assert.equal(withRelativeDates('the day before yesterday', '2026-09-03'), 'the day before yesterday (Tue 1 Sep)');
  assert.equal(withRelativeDates('that was 3 days ago, or two weeks ago', '2026-09-10'), 'that was 3 days ago (Mon 7 Sep), or two weeks ago (week of Mon 24 Aug)');
  assert.equal(withRelativeDates('see you next week', '2026-09-10'), 'see you next week (week of Mon 14 Sep)');
  assert.equal(withRelativeDates('last month', '2026-01-15'), 'last month (December 2025)');
  assert.equal(withRelativeDates('last friday and next friday', '2026-09-11'), 'last friday (Fri 4 Sep) and next friday (Fri 18 Sep)', 'said on a Friday: a week either way');
  assert.equal(withRelativeDates('today, tonight, on friday', '2026-09-11'), 'today, tonight, on friday', 'what does not fix a day is left alone');
  assert.equal(withRelativeDates('yesterday', 'not a day'), 'yesterday');
});

test('recall unasked: only exchanges sharing a specific word, and the note writes the dates out', () => {
  const older = exchangesFrom(archive, ['2026-09-11'], '2026-09-12', 365);
  const vectors = new Map(older.map(exchange => [exchange.id, [1, 0]]));
  const named = rareTerms(index, 'the Logan build is back');
  const picked = pickRecalled(older, vectors, [1, 0], 2, 0.64, exchange => mentionsAny(index, exchange.id, named));
  assert.deepEqual(picked.map(entry => entry.exchange.id), [id('Logan')], 'as close as everything else, but the only one about Logan');
  assert.equal(pickRecalled(older, vectors, [1, 0], 2, 0.64).length, 2, 'without the word check the limit is all that stops it');
  const everything = new Map(all.map(exchange => [exchange.id, [1, 0]]));
  const note = recallNote(pickRecalled(exchangesFrom(archive, [], '2026-09-12', 365), everything, [1, 0], 2, 0.64, exchange => exchange.text.includes('Ocarina')), weekday);
  assert.match(note, /last night \(Thu 10 Sep\)/);
});

// Asserted rather than declared: `minecraft` is not in every tree this runs in.
const NOTHING = {
  choices: false, journal: false, anilist: false, web: false,
  search: { enabled: false, readPages: false, transcripts: false },
  knowledge: false, browser: false, claude: false, system: { enabled: false, level: 0 },
  hands: false, desktop: { launch: false, power: false }, knockedAwake: false, minecraft: false,
} as ToolAvailability;
const offers = (latest: string, chats = true) => chatTools({ ...NOTHING, chats }, latest).some(tool => tool.function.name === 'search_chats');

test('search_chats is on the table when he might be referring back, and only when it is switched on', () => {
  for (const said of ["what was wrong with Logan's pc again?", 'do you remember the verge collection', 'when did I say I was going',
    'the thing I told you about last week', 'how much was that motherboard', 'where did we go for fathers day']) {
    assert.ok(pastRelevant(said), said);
    assert.ok(offers(said), said);
  }
  for (const said of ['goodnight haru', 'I am making dinner', 'lol', 'can you set a reminder for 3pm']) {
    assert.ok(!offers(said), said);
  }
  assert.ok(!offers('do you remember', false), 'switched off means not offered');
  assert.ok(offers(''), 'no message (tests, no user turn yet) offers it, the safe default');
});

test('the handler searches, and says to admit it when nothing is found', async () => {
  const asked: unknown[] = [];
  const deps = {
    onWeb: () => false,
    chats: { search: async (input: unknown) => { asked.push(input); return (input as { query: string }).query === 'Logan' ? { found: 1, text: '[Thursday 2026-09-10]\nThem: Logan…' } : { found: 0, text: '' }; } },
  } as unknown as ToolDeps;
  const call = (args: Record<string, unknown>) => ({ id: 'c1', function: { name: 'search_chats', arguments: args } });
  const found = JSON.parse(await runChatTool(call({ query: ' Logan ', from: '2026-09-01', to: 'yesterday' }), 'what was wrong with logans pc', deps));
  assert.equal(found.found, 1);
  assert.match(found.chats, /2026-09-10/);
  assert.deepEqual(asked[0], { query: 'Logan', from: '2026-09-01', to: undefined }, 'trimmed, and a date that is not one is dropped');
  const none = JSON.parse(await runChatTool(call({ query: 'zeppelin' }), 'remember the zeppelin?', deps));
  assert.equal(none.found, 0);
  assert.match(none.note, /cannot find it/);
  assert.match(JSON.parse(await runChatTool(call({}), '', deps)).error, /query is required/);
  assert.match(JSON.parse(await runChatTool(call({ query: 'x' }), '', { onWeb: () => false, chats: null } as unknown as ToolDeps)).error, /cannot be searched/);
});
