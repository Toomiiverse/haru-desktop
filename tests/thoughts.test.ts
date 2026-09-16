// What is on her mind between messages.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeGap, emptyThoughtState, isRumination, keepThoughts, lastSpoken, mayAsk, mayInitiate, mindNote, normalizeThoughtState,
  noteAsked, pendingTrigger, readThoughts, scoreThought, spend, spokenOn, thinkingInput, thoughtPrompt, THOUGHT_LIMITS, withoutClock,
  type Thought, type TriggerInput,
} from '../electron/thoughts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 8, 17, 2, 0); // 10:00 AM in Perth

function input(extra: Partial<TriggerInput> = {}): TriggerInput {
  return { now: T0, ownLife: [], agenda: [], seen: [], ...extra };
}

function thought(extra: Partial<Thought> = {}): Thought {
  return { id: 't1', at: T0 - HOUR, trigger: 'silence', why: 'quiet', thought: 'Wondering whether he ever fixed that RAM kit', say: 'did the RAM ever post', relevance: 4, urgency: 3, novelty: 4, score: 3.65, decision: 'kept', ...extra };
}

test('nothing sets her thinking on a bare tick', () => {
  assert.equal(pendingTrigger(input()), null);
  assert.equal(pendingTrigger(input({ lastMessageAt: T0 - 10 * MIN })), null, 'ten quiet minutes is not a silence');
});

test('a silence counts once, at the longest milestone crossed, and a missed one is let go', () => {
  const at = T0 - 3 * HOUR - 10 * MIN;
  const three = pendingTrigger(input({ lastMessageAt: at }));
  assert.equal(three?.kind, 'silence');
  assert.equal(three?.key, `silence:${at}:${3 * HOUR}`);
  assert.match(three!.detail, /3 hours/);
  const seen = spend([], three!);
  assert.deepEqual(seen.sort(), [`silence:${at}:${30 * MIN}`, `silence:${at}:${3 * HOUR}`].sort(), 'the half-hour went by with it');
  assert.equal(pendingTrigger(input({ lastMessageAt: at, seen })), null);
  assert.equal(pendingTrigger(input({ lastMessageAt: T0 - 6 * HOUR })), null, 'three hours crossed long ago and eight not yet: nothing');
  assert.equal(pendingTrigger(input({ lastMessageAt: T0 - 8 * HOUR - 5 * MIN }))?.key, `silence:${T0 - 8 * HOUR - 5 * MIN}:${8 * HOUR}`);
});

test('something about to happen comes first, then waking, then her own pass, then a silence', () => {
  const all = input({
    lastMessageAt: T0 - 40 * MIN,
    ownLife: [{ key: 'day:2026-09-17', at: T0 - 20 * MIN, detail: 'you just finished reading about Cowboy Bebop' }],
    agenda: [{ id: 'k1', title: 'Psychologist', at: T0 + 45 * MIN }, { id: 'k2', title: 'Later thing', at: T0 + 5 * HOUR }],
    wokeAt: T0 - 30 * MIN,
  });
  const first = pendingTrigger(all)!;
  assert.equal(first.kind, 'agenda');
  assert.match(first.detail, /"Psychologist" is coming up in about 45 minutes/);
  const second = pendingTrigger({ ...all, seen: spend([], first) })!;
  assert.equal(second.kind, 'wake');
  const third = pendingTrigger({ ...all, seen: spend(spend([], first), second) })!;
  assert.equal(third.kind, 'ownlife');
  const fourth = pendingTrigger({ ...all, seen: spend(spend(spend([], first), second), third) })!;
  assert.equal(fourth.kind, 'silence');
  assert.equal(pendingTrigger({ ...all, wokeAt: T0 - 3 * HOUR, agenda: [], ownLife: [], lastMessageAt: undefined }), null, 'waking three hours ago is not news');
});

test('the brain is asked at most every 25 minutes and 16 times a day', () => {
  let state = emptyThoughtState();
  assert.equal(mayAsk(state, T0, '2026-09-17'), true);
  state = noteAsked(state, T0, '2026-09-17');
  assert.equal(mayAsk(state, T0 + 10 * MIN, '2026-09-17'), false);
  assert.equal(mayAsk(state, T0 + 30 * MIN, '2026-09-17'), true);
  state = { ...state, asked: { day: '2026-09-17', count: THOUGHT_LIMITS.asksPerDay } };
  assert.equal(mayAsk(state, T0 + 5 * HOUR, '2026-09-17'), false);
  assert.equal(mayAsk(state, T0 + 5 * HOUR, '2026-09-18'), true, 'a new day');
});

test('what she is handed is in words, with empty sections left out', () => {
  const text = thinkingInput({
    now: '10:00 AM Thursday', trigger: { kind: 'silence', key: 'k', detail: 'he has not written for 3 hours' },
    lastExchange: 'The last thing he said, 3 hours ago: "heading to work".', unanswered: [], agenda: ['3:00 PM today — Psychologist'],
    ownLife: [], preferences: ['Check up on Tommy in the mornings'], mood: 'Low on energy.', recentThoughts: [], recentLines: ['did you eat'],
  });
  assert.match(text, /^It is 10:00 AM Thursday\. What set you thinking: he has not written for 3 hours\./);
  assert.match(text, /On his list:\n- 3:00 PM today — Psychologist/);
  assert.match(text, /What you already said to him off your own back \(your words, not his\):\n- did you eat$/);
  assert.equal(withoutClock('10:19 PM, I’m turning in at 23:30.'), 'I’m turning in at 23:30.');
  assert.equal(withoutClock('8:37 PM — Nearest Coles'), 'Nearest Coles');
  assert.equal(withoutClock('Twenty past nine, fine.'), 'Twenty past nine, fine.');
  assert.equal(text.includes('Already on your mind'), false);
  assert.equal(text.includes('not answered'), false);
});

test('what comes back is read leniently, at most two, scores clamped', () => {
  assert.deepEqual(readThoughts('{"thoughts": []}'), []);
  assert.deepEqual(readThoughts('nothing on my mind'), []);
  const drafts = readThoughts('```json\n{"thoughts":[{"thought":"He went quiet right after the RAM talk","say":"so?? did it boot","relevance":"5","urgency":9,"novelty":0},{"thought":"short"},{"thought":"Second real one here","say":""},{"thought":"Third one is dropped","say":"x"}]}\n```');
  assert.equal(drafts.length, 2);
  assert.deepEqual([drafts[0].relevance, drafts[0].urgency, drafts[0].novelty], [5, 5, 1]);
  assert.equal(drafts[1].thought, 'Second real one here');
  assert.equal(scoreThought({ relevance: 5, urgency: 5, novelty: 5 }), 5);
  assert.equal(scoreThought({ relevance: 4, urgency: 3, novelty: 4 }), 3.65);
});

test('the same thought again is rumination — by embedding, or by words without one', () => {
  assert.equal(isRumination({ text: 'x', vector: [1, 0, 0] }, [{ text: 'y', vector: [0.95, 0.1, 0] }]), true);
  assert.equal(isRumination({ text: 'x', vector: [1, 0, 0] }, [{ text: 'y', vector: [0.2, 0.9, 0] }]), false);
  assert.equal(isRumination({ text: 'Wondering whether he fixed that RAM kit' }, [{ text: 'still wondering if he fixed the RAM kit' }]), true);
  assert.equal(isRumination({ text: 'Cowboy Bebop ending still bugs me' }, [{ text: 'Wondering whether he fixed that RAM kit' }]), false);
});

test('speaking: only a pressing line, never past a blocker, two a day, three hours apart, and backing off after silence', () => {
  const good = { say: 'did it boot?', score: 4.2 };
  assert.deepEqual(mayInitiate({ thought: good, now: T0, spokenToday: 0, blockers: [] }), { ok: true });
  assert.match((mayInitiate({ thought: { say: '', score: 5 }, now: T0, spokenToday: 0, blockers: [] }) as { why: string }).why, /nothing she would send/);
  assert.match((mayInitiate({ thought: { say: 'x', score: 3 }, now: T0, spokenToday: 0, blockers: [] }) as { why: string }).why, /not pressing enough/);
  assert.equal((mayInitiate({ thought: good, now: T0, spokenToday: 0, blockers: ['quiet hours'] }) as { why: string }).why, 'quiet hours');
  assert.match((mayInitiate({ thought: good, now: T0, spokenToday: 2, blockers: [] }) as { why: string }).why, /enough/);
  assert.match((mayInitiate({ thought: good, now: T0, spokenToday: 1, lastSpokenAt: T0 - HOUR, lastAnswered: true, blockers: [] }) as { why: string }).why, /60 minutes ago/);
  assert.match((mayInitiate({ thought: good, now: T0, spokenToday: 1, lastSpokenAt: T0 - 4 * HOUR, lastAnswered: false, blockers: [] }) as { why: string }).why, /unanswered/);
  assert.deepEqual(mayInitiate({ thought: good, now: T0, spokenToday: 1, lastSpokenAt: T0 - 4 * HOUR, lastAnswered: true, blockers: [] }), { ok: true });
});

test('the reservoir keeps two days, counts shadow sends as spoken, and puts the freshest unsaid thoughts in front of her', () => {
  let state = emptyThoughtState();
  state = keepThoughts(state, [
    thought({ id: 'old', at: T0 - 50 * HOUR }),
    thought({ id: 'would', at: T0 - 2 * HOUR, decision: 'would-say', score: 4.1, thought: 'He never said how the psych appointment went' }),
    thought({ id: 'kept', at: T0 - 30 * MIN, score: 3.2, thought: 'Bebop ending still bugs me' }),
    thought({ id: 'rum', at: T0 - 10 * MIN, decision: 'rumination', score: 5 }),
    thought({ id: 'low', at: T0 - 5 * MIN, score: 1.5, thought: 'meh' }),
  ], T0);
  assert.deepEqual(state.thoughts.map(t => t.id), ['would', 'kept', 'rum', 'low']);
  assert.equal(spokenOn(state, T0 - 10 * HOUR, T0 + HOUR).length, 1);
  assert.equal(lastSpoken(state)?.id, 'would');
  const note = mindNote(state, T0);
  assert.match(note, /^On your mind lately — your own private thoughts/);
  assert.match(note, /- \(2 hours ago\) He never said how the psych appointment went\n- \(30 minutes ago\) Bebop ending still bugs me$/);
  assert.equal(mindNote(emptyThoughtState(), T0), '');
  assert.equal(describeGap(90 * MIN), '2 hours');
});

test('the note that turns a thought into a message, and the file read defensively', () => {
  assert.match(thoughtPrompt({ thought: 'He went quiet after the RAM talk', say: 'so did it boot', why: 'he has not written for 3 hours' }), /single dash/);
  const state = normalizeThoughtState({ thoughts: [thought(), { id: 'bad', at: 'x' }, { ...thought({ id: 'odd' }), trigger: 'dream' }], seen: ['a', 3], asked: { day: 7 }, lastAskedAt: 'no' });
  assert.deepEqual(state.thoughts.map(t => t.id), ['t1']);
  assert.deepEqual(state.seen, ['a']);
  assert.deepEqual(state.asked, { day: '', count: 0 });
  assert.equal(state.lastAskedAt, 0);
  assert.deepEqual(normalizeThoughtState(null), emptyThoughtState());
});
