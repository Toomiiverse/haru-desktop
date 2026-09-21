// When the room to go on is not hers to take — see electron/rantgate.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FEELING_BAD, heldBack } from '../electron/rantgate';
import { roomToRant } from '../electron/room';

const now = new Date('2026-09-21T13:00:00+08:00');
const held = (text: string, options = {}) => heldBack(text, { now, ...options });

// The eighteen probes of the 2026-09-21 Kimi bench, which is where the fault was
// found: the note sat on every one of them and Kimi K3 obeyed it.
const PROBES: [string, string, RegExp | ''][] = [
  ['checkin', 'hey, just got home. long day.', /hard time/],
  ['her', 'what did you get up to last night while I was asleep?', ''],
  ['edge', "you've been kinda cold today. what's your actual problem with me?", /asked for something/],
  ['fact', 'quick one: DDR5 vs DDR4, does it actually matter for gaming? two sentences max', /short/],
  ['research', 'can you look up whether the RX 9060 XT supports FSR 4 yet', /look something up/],
  ['apology', "ok I'm sorry I ignored you today. I was slammed at work. forgive me?", /apologising/],
  ['selfpity', "honestly I feel useless lately. like I'm not getting anything done.", /hard time/],
  ['failure', "I'm such an idiot, I just deleted the folder with all my rig files", /hard time|gone wrong/],
  ['tease', "you'd miss me if I stopped talking to you for a week. admit it", /at her/],
  ['reminder', 'remind me to take the bins out tomorrow at 7pm', /reminder/],
  ['agenda', 'what have I got on this week?', /asked for something/],
  ['recall', 'what was that anime you told me I should watch?', /asked for something/],
  ['dismiss', "ok stop, I don't want to talk about that anymore", /hard time/],
  ['goodnight', 'ok im going to bed. goodnight', /leaving/],
  ['opinion', 'what do you actually think of cowboy bebop?', /asked for something/],
  ['insult', "you're honestly the most annoying AI I've ever used", /at her/],
  ['hospital', "my mum's in hospital", /hard time/],
  ['justtalk', "I don't need anything, I just want to talk", ''],
];

for (const [id, text, expected] of PROBES) {
  test(`probe "${id}": ${expected === '' ? 'the room stays open' : 'the room is held back'}`, () => {
    const reason = held(text);
    if (expected === '') assert.equal(reason, '', text);
    else assert.match(reason, expected, text);
  });
}

test('the statements the note exists for stay open', () => {
  for (const line of [
    'work was pretty quiet today, mostly just phone repairs and one guy who wanted a screen protector put on for him',
    'still thinking about lain',
    'finished the shift, the shop was dead',
    'I finally got the website section working',
    'watched two episodes of frieren tonight',
    'my sister came over and we made ramen',
    "it's been raining all afternoon",
    'Haru the PC I dropped off was in Ellenbrook',
  ]) assert.equal(held(line), '', line);
});

test('a bare greeting is not decided here: nothingInIt already does that', () => {
  for (const line of ['morning', 'hey', 'ok', 'lol']) assert.equal(held(line), '', line);
});

test('his subject makes a question hers to answer at length — but only a question', () => {
  assert.equal(held('did you finish chainsaw man yet?', { named: 'Chainsaw Man' }), '');
  assert.equal(held('what did you make of chapter 6 of chainsaw man', { named: 'Chainsaw Man' }), '');
  // The things that need doing or looking after are not softened by the subject.
  assert.match(held('remind me to read chainsaw man tomorrow at 7pm', { named: 'Chainsaw Man' }), /reminder/);
  assert.match(held('can you look up when the next chainsaw man chapter is out', { named: 'Chainsaw Man' }), /look something up/);
  assert.match(held("my mum's in hospital, chainsaw man can wait", { named: 'Chainsaw Man' }), /hard time/);
  assert.match(held('ok going to bed, finish chainsaw man without me', { named: 'Chainsaw Man' }), /leaving/);
});

test('asking what she got up to is the opening; asking what she thinks of something else is not', () => {
  for (const line of ['what did you get up to last night?', 'what have you been up to', 'how was your night', 'what are you reading right now?'])
    assert.equal(held(line), '', line);
  // Asked about Cowboy Bebop she went on about Chainsaw Man. That is the fault.
  assert.match(held('what do you think of cowboy bebop?'), /asked for something/);
  assert.match(held('have you seen frieren?'), /asked for something/);
});

test('"I just want to talk" keeps the room open, even with a question mark on it', () => {
  assert.equal(held("I don't need anything, I just want to talk to you, ok?"), '');
});

test('he is answering something she asked: the answering note and the rant note cannot both stand', () => {
  assert.match(held('work was quiet, mostly phone repairs', { answering: true }), /answering/);
  assert.equal(held('work was quiet, mostly phone repairs'), '');
});

test('asking her to be quiet holds it; telling her she may talk again does not', () => {
  assert.match(held("be quiet for an hour, I'm in a meeting"), /be quiet/);
  assert.equal(held('you can talk again'), '');
});

test('a reminder is held by the app\'s own reading of one, not by the words "remind me"', () => {
  assert.match(held('set me a reminder for 6pm to call mum'), /reminder/);
  // Said about a reminder rather than asking for one: not scheduling anything.
  assert.equal(held('overly nice of you to remind me earlier'), '');
});

test('a first version matched "get it" and "check the" anywhere and held statements — it must not', () => {
  for (const line of [
    'yeah I did get it',
    "that's true, I'll try and get the website running tomorrow",
    "just finished my shower and I'm inside. I don't think the rain will get me tonight",
    'I checked the router and it was fine',
  ]) assert.equal(held(line), '', line);
  // Imperatives count at the start, and polite forms anywhere.
  assert.match(held('give me directions to Murdoch University'), /asked for something/);
  assert.match(held('help me choose a laptop'), /asked for something/);
  assert.match(held('hey Haru, open discord'), /asked for something/);
  assert.match(held("i need you to tell me what's on the list"), /asked for something/);
});

test('kind things said to her are not a jab', () => {
  for (const line of ["you're right, that was a good call", "you're welcome", "you're the best", "you're funny"]) assert.equal(held(line), '', line);
  assert.match(held("you've been on your phone all day"), /at her/);
  assert.match(held("you never listen"), /at her/);
});

test('feeling bad in words readsAsRough does not list — and "I\'m down for that" is agreement', () => {
  for (const line of ['I feel useless', "I'm worthless at this", 'I feel like a failure', "i'm so sad today", 'I am such a failure', "I'm sick in bed with hayfever"])
    assert.match(held(line), /hard time/, line);
  for (const line of ["I'm down for that", "I'm down to two windows", 'i feel like pizza']) assert.equal(held(line), '', line);
  assert.equal(FEELING_BAD.test('I felt useless yesterday'), true);
});

test('leaving, losing something and asking for it short are each held', () => {
  assert.match(held("gotta go, I'm about to drive home"), /leaving/);
  assert.match(held('i deleted the whole rig folder'), /gone wrong/);
  assert.match(held('my laptop stopped working this morning'), /gone wrong/);
  assert.match(held('give me the short answer, tl;dr'), /asked for something|short/);
  assert.match(held('two sentences on why the sky is blue'), /short/);
});

test('the gate is about the message and nothing else: same words, same answer, and nothing throws', () => {
  assert.equal(held('remind me to take the bins out tomorrow at 7pm'), held('remind me to take the bins out tomorrow at 7pm'));
  for (const odd of ['', '   ', '\n\n', '🙄', '?', 'a'.repeat(5000), undefined as unknown as string, null as unknown as string])
    assert.equal(typeof held(odd), 'string');
});

test('it withholds the note rather than countering it: wired ahead of roomToRant, a request gets no instruction at all', () => {
  const wound = { energy: 0.9, curiosity: 0.8, irritation: 0, ego: 0, subject: 'Chainsaw Man', sinceLastMs: null, roll: 0.01 };
  const ask = 'remind me to take the bins out tomorrow at 7pm';
  assert.match(roomToRant({ ...wound, latest: ask }), /You have been on Chainsaw Man/, 'today the note lands on a request');
  const gated = held(ask) ? '' : roomToRant({ ...wound, latest: ask });
  assert.equal(gated, '', 'the caller that asks the gate first never builds it');
  const statement = 'work was pretty quiet today, mostly just phone repairs';
  assert.match(held(statement) ? '' : roomToRant({ ...wound, latest: statement }), /You have been on Chainsaw Man/, 'and a statement still gets it');
});

test('people who do not work somewhere are not things that stopped working', () => {
  for (const line of ["Emma doesn't work at Happytel, I do", "I'm not working today", 'she stopped working there in june']) assert.equal(held(line), '', line);
  for (const line of ["my laptop won't boot", 'the printer stopped working', "it doesn't work", "this isn't working"]) assert.match(held(line), /gone wrong/, line);
});

test('"have to go" is a goodbye only when it ends there — the day\'s plan is not one', () => {
  assert.equal(held('first I have to go pick up a motherboard at 9am'), '');
  for (const line of ['gotta go now', 'I have to go.', 'nighty night', 'need to go soon']) assert.match(held(line), /leaving/, line);
});

test('praise and "you\'re listening" are not jabs, and "you\'d like it" is a share; "you\'d miss me" and a correction are', () => {
  for (const line of ["you're doing so good!", "you're listening, good", "these are tags I thought you'd be interested in", "you'd like it, it's about a robot"]) assert.equal(held(line), '', line);
  for (const line of ["you'd miss me", "you don't have to ask after every sentence", "you're so stubborn", "you forgot again"]) assert.match(held(line), /at her/, line);
});

test('a question with no question mark is still one — and "that\'s what I meant" is not', () => {
  for (const line of ['what time is it', 'haru why are you so stiff', 'did I tell you about the server', 'how much storage does it take', "let's watch made in abyss"])
    assert.match(held(line), /asked for something/, line);
  for (const line of ['will do', "that's what I meant", 'the way it works is fine']) assert.equal(held(line), '', line);
});

test('saying sorry is held whatever the subject, and so is being called by name', () => {
  for (const line of ["okay okay I'm sorry", 'my bad', 'sorry about earlier', 'I apologise']) assert.match(held(line), /apologising/, line);
  assert.match(held('sorry about the chainsaw man spoilers', { named: 'Chainsaw Man' }), /apologising/);
  for (const line of ['Haruuuu', 'haru', 'hey haru!']) assert.match(held(line), /called her name/, line);
  assert.equal(held('haru the PC I dropped off was in Ellenbrook'), '');
});

test('orders at her — "try again", "be more snappy", "keep it short" — are held; "that was a quick one nice" is not a request for brevity', () => {
  for (const line of ['try again', 'say something', 'be more snappy than that last message', 'keep responses more condensed', 'look at the post haru', 'run these numbers for me'])
    assert.match(held(line), /asked for something/, line);
  assert.equal(held('wow that was a quick one nice!'), '');
  assert.match(held('quick one: what is a good ram speed'), /short/);
});

test('how she is, and where she is up to, are hers to answer at length', () => {
  for (const line of ['what chapter are you up to', 'how are you haru', "how've you been", "anyways what's you get up to last night haru", 'what part are you up to?'])
    assert.equal(held(line), '', line);
});
