// What Haru is told, and the order she is told it in.
//
// The order is asserted as a chain of positions rather than an exact string,
// because the fragments themselves are tested where they live. What could not
// be tested anywhere until prompt.ts existed is this file's actual job: which
// lines are included, and which of them outranks which.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSystemPrompt, chatDynamicContext, feedbackSummary, freshStartInstruction, knowledgeInstruction, screenContext, searchInstruction, systemInstruction, NO_GUESSING, FIRST_PERSON_NOTE, type PromptState, LENGTH_RULE_LOCAL, LENGTH_RULE_HOSTED } from '../electron/prompt';
import { readSearchConfig } from '../electron/search';

const NOW = new Date('2026-08-20T19:30:00.000Z');

// Sentinels, so the pieces the caller renders can be found in the joined
// prompt without depending on anything they happen to say.
const IDENTITY = 'SENTINEL-IDENTITY';
const STYLE = 'SENTINEL-STYLE';
const PROFILE = 'SENTINEL-PROFILE';
const ANILIST = 'SENTINEL-ANILIST';
const MACHINE = 'SENTINEL-MACHINE';

function state(overrides: Partial<PromptState> = {}): PromptState {
  return {
    now: NOW,
    timezone: 'Europe/London',
    character: { identity: IDENTITY, style: STYLE },
    profile: PROFILE,
    aniList: ANILIST,
    journalConfig: { enabled: false, askHour: 20, askUnprompted: false },
    journal: [],
    checkInsToday: [],
    screen: {},
    asides: [],
    rated: [],
    kept: [],
    search: readSearchConfig({ enabled: false }),
    knowledgeEnabled: false,
    systemEnabled: false,
    machineNote: '',
    following: {},
    irritation: 0,
    ego: 0,
    goodnight: 'none',
    shout: 'none',
    latestMessage: 'what time is it',
    fresh: null,
    herRecentReplies: [],
    movedJustNow: null,
    pushback: undefined,
    ...overrides,
  };
}

/** Position of a fragment in the prompt; -1 if it never made it in. */
const at = (prompt: string, needle: string) => prompt.indexOf(needle);

test('the documented order holds, from the tools down to the last word', () => {
  const prompt = chatSystemPrompt(state({
    search: readSearchConfig({ enabled: true, readPages: true }),
    irritation: 5,
    fresh: { at: NOW.toISOString(), hadMessages: true, reason: 'manual' },
    pushback: { count: 1, at: NOW.toISOString() },
    goodnight: 'said',
    shout: 'shouted',
    machineNote: MACHINE,
  }));

  // Each of these is a rule the comments in prompt.ts call load-bearing.
  const chain = [
    ['the clock', "in the user's timezone"],
    ['the profile', PROFILE],
    ['the search tool', 'You can look things up online'],
    ['the machine facts', MACHINE],
    ['her persona', IDENTITY],
    ['her style', STYLE],
    ['the mood line', 'thoroughly fed up'],
    ['the fresh-start correction', 'deliberately cleared'],
    ['being told to drop it', 'leave the subject of work alone'],
    ['goodnight', 'They are saying goodnight'],
    ['the row about being shouted at', 'not being spoken to like that'],
  ] as const;

  let previous = -1;
  let previousName = 'the start';
  for (const [name, needle] of chain) {
    const position = at(prompt, needle);
    assert.notEqual(position, -1, `${name} never made it into the prompt`);
    assert.ok(position > previous, `${name} should come after ${previousName}`);
    previous = position;
    previousName = name;
  }
});

test('the persona is last, because a small model forgets the opening lines', () => {
  const prompt = chatSystemPrompt(state({ search: readSearchConfig({ enabled: true }) }));
  // Everything factual — what she knows, what her tools are — sits above it.
  assert.ok(at(prompt, IDENTITY) > at(prompt, PROFILE));
  assert.ok(at(prompt, IDENTITY) > at(prompt, 'You can look things up online'));
  assert.ok(at(prompt, IDENTITY) > at(prompt, 'call create_kept_item'));
});

test('corrections are read after the mood that causes them, not before', () => {
  // Being told she is fed up is what produces the thing the correction fixes,
  // so a correction read first is simply overridden.
  const prompt = chatSystemPrompt(state({
    irritation: 5,
    latestMessage: "it's been a rough day and I'm exhausted",
    fresh: { at: NOW.toISOString(), hadMessages: false, reason: 'daily' },
  }));
  const mood = at(prompt, 'thoroughly fed up');
  assert.ok(mood !== -1);
  assert.ok(at(prompt, 'Something is wrong for them right now') > mood, 'reading the room outranks her mood');
  assert.ok(at(prompt, 'cleared each morning') > mood, 'the empty history is not something to be annoyed about');
});

test('she is never told she can search when searching is switched off', () => {
  // The failure this prevents: offered the words and not the tool, she reports
  // having checked something she made up.
  const off = chatSystemPrompt(state({ search: readSearchConfig({ enabled: false }), latestMessage: 'what is the weather in leeds' }));
  assert.ok(!off.includes('search_web'), 'no mention of a tool she has not got');
  assert.ok(!off.includes('read_web_page'));

  const on = chatSystemPrompt(state({ search: readSearchConfig({ enabled: true, readPages: true }) }));
  assert.ok(on.includes('search_web'));
  assert.ok(on.includes('read_web_page'));
});

test('reading pages is a separate bargain from searching at all', () => {
  const searchOnly = searchInstruction(readSearchConfig({ enabled: true, readPages: false }));
  assert.ok(searchOnly.includes('search_web'));
  assert.ok(!searchOnly.includes('read_web_page'), 'a page fetch is not granted by permission to search');
});

test('the knowledge and system tools are only described when they exist', () => {
  assert.equal(knowledgeInstruction(false), '');
  assert.equal(systemInstruction(false), '');
  assert.ok(knowledgeInstruction(true).includes('look_up_knowledge'));
  assert.ok(systemInstruction(true).includes('get_gpu_info'));

  const bare = chatSystemPrompt(state());
  assert.ok(!bare.includes('look_up_knowledge'));
  assert.ok(!bare.includes('get_gpu_info'));
});

test('having already moved something replaces being asked to move it', () => {
  const moved = chatSystemPrompt(state({
    latestMessage: 'push the dentist to friday',
    movedJustNow: { title: 'Dentist', to: 'Friday' },
  }));
  assert.ok(moved.includes('You have already moved "Dentist" to Friday'));
  assert.ok(moved.includes('Do not call any tool to move it again'), 'or she moves it twice');
});

test('nothing empty is joined in', () => {
  const prompt = chatSystemPrompt(state());
  assert.ok(!/\s{2,}/.test(prompt), 'an empty fragment would leave a double space behind it');
});

test('screen context refuses to guess when there is no window to name', () => {
  assert.equal(screenContext({}, NOW.getTime()), NO_GUESSING);
  const seen = screenContext({ label: 'Wikipedia — Sheffield' }, NOW.getTime());
  assert.ok(seen.includes('"Wikipedia — Sheffield"'));
  // Still refuses to guess beyond it: naming one window is not permission to
  // invent the rest of the screen.
  assert.ok(seen.includes(NO_GUESSING));
});

test('a long window title is cut rather than pasted in whole', () => {
  const seen = screenContext({ label: 'x'.repeat(400) }, NOW.getTime());
  assert.ok(seen.includes('x'.repeat(160)));
  assert.ok(!seen.includes('x'.repeat(161)));
});

test('feedback quotes enough to identify a reply and no more', () => {
  const long = 'w'.repeat(200);
  const summary = feedbackSummary([
    { role: 'assistant', content: long, reaction: 'down' },
    { role: 'assistant', content: 'this one landed', reaction: 'up' },
    { role: 'user', content: 'ignored', reaction: 'up' },
  ]);
  assert.ok(!summary.includes('w'.repeat(80)), 'handing back the whole reply had her reciting it verbatim');
  assert.ok(summary.includes('…'));
  assert.ok(summary.includes('this one landed'));
  assert.ok(summary.includes('Never repeat their wording back'));
});

test('feedback keeps only the last few of each, and says nothing without any', () => {
  assert.equal(feedbackSummary([]), '');
  assert.equal(feedbackSummary([{ role: 'assistant', content: 'unrated' }]), '');
  const many = Array.from({ length: 9 }, (_, index) => ({ role: 'assistant', content: `down-${index}`, reaction: 'down' }));
  const summary = feedbackSummary(many);
  assert.ok(summary.includes('down-8') && summary.includes('down-5'));
  assert.ok(!summary.includes('down-4'), 'only the last four dislikes are worth carrying');
});

test('a cleared conversation is explained as housekeeping, not as a telling-off', () => {
  assert.equal(freshStartInstruction(null), '');
  const manual = freshStartInstruction({ at: NOW.toISOString(), hadMessages: true, reason: 'manual' });
  assert.ok(manual.includes('their own choice'));
  assert.ok(manual.includes('You may ask once'), 'there was something to clear, so the reason is worth asking about');

  const daily = freshStartInstruction({ at: NOW.toISOString(), hadMessages: false, reason: 'daily' });
  assert.ok(daily.includes('cleared each morning'));
  assert.ok(!/\bthe app\b|shutting you down|running on/.test(daily), 'nothing in it tells her she is software');
  assert.ok(!daily.includes('You may ask once'), 'no decision of theirs to be curious about');
});

test('a day the list disagrees with becomes the subject, and outranks the put-off reading', () => {
  const prompt = chatSystemPrompt(state({
    // The item sits days away from NOW in any timezone, so "tomorrow" disagrees
    // with it whether this runs in Perth or on a UTC runner.
    latestMessage: "I'll sort the party out, its tomorrow",
    kept: [{ title: 'Scarlett Birthday Party', date: '2026-08-25', kind: 'event', done: false }],
  }));
  assert.ok(prompt.includes('ask which is right'), 'the disagreement instruction never made it in');
  assert.ok(!prompt.includes('will not get to something'), 'the put-off reading should stand down');
});

test('a short follow-up is read as continuing the thread, and never echoed back as an opener', () => {
  const prompt = chatSystemPrompt(state());
  const continuity = prompt.indexOf('Read the last few turns before answering');
  assert.notEqual(continuity, -1, 'the continuity rule never made it into the prompt');
  assert.ok(prompt.includes('an echo cannot'));
  assert.ok(continuity > prompt.indexOf(IDENTITY), 'it must come after the persona, or a small model forgets it');
  assert.ok(continuity < prompt.indexOf('Answer what they said and stop'), 'it qualifies the length rule, so it is read first');
});

test('her emoji are named, as hers, beside the persona', () => {
  const prompt = chatSystemPrompt(state({ irritation: 5 }));
  const expressive = prompt.indexOf('Emoji are part of how you talk');
  assert.notEqual(expressive, -1, 'the emoji rule never made it into the prompt');
  assert.ok(expressive > prompt.indexOf(STYLE), 'it is part of her voice, so it follows her style');
  assert.ok(expressive > prompt.indexOf('thoroughly fed up'), 'and after the mood and ego, which read as "no cheer" — before them the emoji were dropped as cheer');
  assert.ok(expressive > prompt.indexOf('not being spoken to like that'), 'last of all: recency is the lever against a history with none');
  assert.ok(prompt.includes('not a signature'), 'the opener-variety rule rides with continuity');
});

test('where their phone says they are sits beside the clock, as words, and only when there is a word', () => {
  const bare = chatSystemPrompt(state());
  assert.doesNotMatch(bare, /Their phone/);
  const placed = chatSystemPrompt(state({ whereabouts: 'Their phone says they are at the store, on mobile data, as of 7 minutes ago. Background: use it when it is relevant, and it is fair game for needling, but she has no coordinates and never quotes any.' }));
  assert.match(placed, /Their phone says they are at the store/);
  assert.ok(placed.indexOf('Their phone says') > placed.indexOf("in the user's timezone"), 'after the clock');
});

test('the way somewhere sits beside the machine facts, when they asked for it', () => {
  assert.doesNotMatch(chatSystemPrompt(state()), /They asked the way/);
  const asked = chatSystemPrompt(state({ directionsNote: 'They asked the way to "Coles". Found: Coles, Wembley. It is about 6.1 km from where they are. The app is attaching a button under your words.' }));
  assert.match(asked, /Found: Coles, Wembley/);
});

test('her replies are always her first person — the note sits with the persona', () => {
  const prompt = chatSystemPrompt(state());
  const note = at(prompt, FIRST_PERSON_NOTE.slice(0, 30));
  assert.notEqual(note, -1, 'the first-person note never made it into the prompt');
  assert.ok(note > at(prompt, STYLE), 'read after her identity and style, so it binds with who she is');
});

test('she is allowed to hedge and to catch herself being wrong', () => {
  const prompt = chatSystemPrompt(state());
  assert.match(prompt, /genuinely unsure/);
  assert.match(prompt, /wait, no, that was Tuesday/);
  assert.match(prompt, /never defend a wrong memory with a new invention/);
});

test('the weather where they are sits with their whereabouts, when she has a reading', () => {
  assert.doesNotMatch(chatSystemPrompt(state()), /actual weather/);
  const read = chatSystemPrompt(state({ weather: "Where they are it is 17°C and clear; today's range 10°C to 19°C. That is the actual weather, from a forecast service, as of a few minutes ago — use it rather than guessing, and do not say you cannot check." }));
  assert.match(read, /17°C and clear/);
});

test('chatSystemPrompt carries her vitals as a tone line before the irritation line, and only when they have drifted', () => {
  const calm = chatSystemPrompt(state({ vitals: { energy: 0.6, happiness: 0.6, curiosity: 0.5, affection: 0.4, sleepiness: 0.2, stress: 0.2, focus: 0.5 } }));
  assert.doesNotMatch(calm, /on edge|drowsy|fonder of them/);
  const tense = chatSystemPrompt(state({ irritation: 5, vitals: { energy: 0.6, happiness: 0.6, curiosity: 0.5, affection: 0.4, sleepiness: 0.2, stress: 0.9, focus: 0.5 } }));
  assert.ok(tense.indexOf('on edge') < tense.indexOf('thoroughly fed up'));
});

test('the local length rule is in the brief verbatim, so a hosted brain can swap it for its own', () => {
  assert.match(LENGTH_RULE_LOCAL, /One thought/);
  assert.match(LENGTH_RULE_HOSTED, /As long as it needs and no longer/);
  assert.doesNotMatch(LENGTH_RULE_HOSTED, /short paragraph/);
});

test('the way she writes is read after the persona and after the emoji rule', () => {
  const prompt = chatSystemPrompt(state({ irritation: 5 }));
  const natural = prompt.indexOf('Write the way a person texts');
  assert.notEqual(natural, -1, 'it never made it into the prompt');
  assert.ok(natural > prompt.indexOf(STYLE), 'after her style, which tells her to be bitchy in every reply');
  assert.ok(natural > prompt.indexOf('Emoji are part of how you talk'), 'and after the emoji rule');
});

test('asked about her own things, her list is not in front of her', () => {
  const withList = chatSystemPrompt(state({ irritation: 1 }));
  const kept = withList.indexOf('Answer questions about what is coming up');
  assert.notEqual(kept, -1, 'the list is normally there');
  const hers = chatSystemPrompt({ ...state({ irritation: 1 }), aboutHer: true });
  assert.equal(hers.indexOf('Answer questions about what is coming up'), -1, 'and gone when the subject is her');
  assert.match(hers, /Emoji are part of how you talk/, 'the rest of the brief is untouched');
});


// ---- cachedHead: the hosted-brain split, where the cacheable head comes first ----

const CLOCK = "in the user's timezone";

test('cachedHead keeps only the invariant blocks, persona and rules', () => {
  const prompt = chatSystemPrompt(state({ irritation: 5, latestMessage: 'what is the weather in leeds' }), true);
  assert.ok(at(prompt, IDENTITY) !== -1);
  assert.ok(at(prompt, STYLE) !== -1);
  assert.ok(at(prompt, LENGTH_RULE_LOCAL) !== -1);
  // The changing context has left the system message entirely.
  assert.equal(at(prompt, CLOCK), -1, 'the clock must not be in the cached head');
  assert.equal(at(prompt, PROFILE), -1, 'the query-selected memory must not be in the cached head');
  assert.equal(at(prompt, 'thoroughly fed up'), -1, 'her mood must not be in the cached head');
});

test('the cachedHead head is byte-identical however the turn changes', () => {
  const a = chatSystemPrompt(state({ now: new Date('2026-08-20T09:00:00.000Z'), latestMessage: 'hello', irritation: 0, machineNote: '' }), true);
  const b = chatSystemPrompt(state({ now: new Date('2026-08-20T23:59:00.000Z'), latestMessage: 'why are you ignoring me', irritation: 7, machineNote: MACHINE, goodnight: 'said' }), true);
  assert.ok(a.length > 500, 'the stable head should still be the bulk of her rules');
  assert.equal(a, b);
});

test('the changing context lives in chatDynamicContext, in the original order', () => {
  const extra = chatDynamicContext(state({ irritation: 5, latestMessage: 'what is the weather in leeds' }));
  assert.ok(extra.includes(CLOCK));
  assert.ok(extra.includes(PROFILE));
  assert.ok(extra.includes('thoroughly fed up'));
  // The clock opens it, the memory profile follows, her mood is read last —
  // the order she was always told them in.
  assert.ok(at(extra, CLOCK) < at(extra, PROFILE));
  assert.ok(at(extra, PROFILE) < at(extra, 'thoroughly fed up'));
});

test('chatSystemPrompt default still opens with the clock and holds the mood', () => {
  const prompt = chatSystemPrompt(state({ irritation: 5 }));
  assert.ok(at(prompt, CLOCK) < at(prompt, IDENTITY), 'the local-brain order is unchanged');
  assert.ok(prompt.includes('thoroughly fed up'));
});

test('the default order still opens with the clock', () => {
  const prompt = chatSystemPrompt(state());
  assert.ok(at(prompt, CLOCK) < at(prompt, IDENTITY), 'the local-brain order is unchanged');
});

// ---- away: the phone trims its own system prompt ----

test('away drops the machine-tools description but keeps the lookup tools', () => {
  const desk = chatSystemPrompt(state({ search: readSearchConfig({ enabled: true }), knowledgeEnabled: true, systemEnabled: true }), true, false);
  assert.ok(desk.includes('get_gpu_info'), 'the desk is told about the machine tools');
  const phone = chatSystemPrompt(state({ search: readSearchConfig({ enabled: true }), knowledgeEnabled: true, systemEnabled: true }), true, true);
  assert.ok(!phone.includes('get_gpu_info'), 'a phone is never offered the machine tools');
  assert.ok(phone.includes('search_web'), 'a phone still gets the lookup tools');
  assert.ok(phone.includes('look_up_knowledge'));
  assert.ok(phone.includes(IDENTITY), 'her persona stays on the phone');
});
