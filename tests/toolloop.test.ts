// The tool loop's rules, none of which could be reached from a test while the
// loop lived inside ollamaChat.
//
// The model is a scripted list of replies. Each case asserts what the loop did
// with them: which rounds were offered tools, what went back into the
// conversation, which retries fired, and what came out the other end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOOL_ROUNDS, runToolLoop, type ToolLoopDeps, type ToolOutcome, textToolCall } from '../electron/toolloop';
import type { ChatMessage, ToolCall } from '../electron/provider';

const says = (content: string): ChatMessage => ({ role: 'assistant', content });
const calls = (...names: string[]): ChatMessage => ({
  role: 'assistant',
  tool_calls: names.map((name, index) => ({ id: `call-${index}`, function: { name, arguments: {} } })),
});

test('tool loop preserves each parallel result ID, including missing provider IDs', async () => {
  const h = harness([{ role: 'assistant', tool_calls: [
    { id: 'provided', function: { name: 'remember_about_user', arguments: { text: 'A' } } },
    { function: { name: 'remember_about_user', arguments: { text: 'B' } } },
  ] }, says('Both saved.')]);
  await runToolLoop(h.conversation, h.deps);
  const offered = h.conversation.find(message => message.tool_calls)?.tool_calls!;
  assert.deepEqual(h.conversation.filter(message => message.role === 'tool').map(message => message.tool_call_id), offered.map(call => call.id));
  assert.ok(offered.every(call => call.id));
  assert.notEqual(offered[0].id, offered[1].id);
});

type Harness = {
  deps: ToolLoopDeps;
  /** Whether tools were offered, one entry per round actually asked for. */
  offered: boolean[];
  /** Tool names run, in the order their results were awaited. */
  toolsRun: string[];
  /** How many times the stream was told to take words back. */
  resets: number;
  conversation: ChatMessage[];
  say: string[];
};

/**
 * A loop wired to a scripted model. Everything is permissive by default — hands
 * on, no page read, one open task — so each test can turn off exactly the one
 * thing it is about.
 */
function harness(script: ChatMessage[], options: Partial<{
  pageReadAfter: string;
  handsAllowed: boolean;
  hasOpenTask: boolean;
  canSearch: boolean;
  runTool: (call: ToolCall) => Promise<ToolOutcome>;
}> = {}): Harness {
  const offered: boolean[] = [];
  const toolsRun: string[] = [];
  const say: string[] = [];
  const conversation: ChatMessage[] = [{ role: 'user', content: 'go on then' }];
  let pageRead = false;
  let hands = options.handsAllowed ?? true;
  let resets = 0;
  let round = 0;

  const deps: ToolLoopDeps = {
    async ask(_sending, { tools }) {
      offered.push(tools);
      const next = script[round++];
      if (!next) throw new Error(`the script ran out after ${round - 1} rounds`);
      return next;
    },
    async runTool(call) {
      const name = call.function?.name ?? '?';
      if (options.runTool) return options.runTool(call);
      // Reading a page is what sets the flag in the real dispatcher, so the
      // fake one sets it the same way: during the round, not before it.
      if (name === options.pageReadAfter) pageRead = true;
      toolsRun.push(name);
      return `${name} done`;
    },
    pageWasRead: () => pageRead,
    handsAllowed: () => hands,
    withdrawHands: () => { hands = false; },
    hasOpenTask: () => options.hasOpenTask ?? true,
    canSearch: () => options.canSearch ?? true,
    resetStream: () => { resets += 1; },
    log: line => say.push(line),
    warn: line => say.push(line),
  };
  return {
    deps, offered, toolsRun, conversation, say,
    get resets() { return resets; },
  };
}

test('a reply with no tool calls settles in one round', async () => {
  const h = harness([says('Fine, it is done.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'Fine, it is done.');
  assert.equal(result.rounds, 1);
  assert.equal(result.ran.size, 0);
  assert.equal(h.resets, 0, 'nothing was discarded, so nothing should be taken back');
});

// -- a call written out as words ---------------------------------------------------

test('a call written out as words is read as the call it is, and a sentence naming a tool is not', () => {
  assert.deepEqual(textToolCall('look_up_knowledge:0{"query": "Haru notes", "category": "personal"}'), { function: { name: 'look_up_knowledge', arguments: '{"query": "Haru notes", "category": "personal"}' } });
  assert.deepEqual(textToolCall('functions.get_system_info:0{}'), { function: { name: 'get_system_info', arguments: '{}' } });
  assert.deepEqual(textToolCall('adopt_interest(kind="game", title="Zenless Zone Zero")'), { function: { name: 'adopt_interest', arguments: '{"kind":"game","title":"Zenless Zone Zero"}' } });
  assert.deepEqual(textToolCall("search_web(query='RX 9060 XT FSR 4', fresh=true, limit=3)"), { function: { name: 'search_web', arguments: '{"query":"RX 9060 XT FSR 4","fresh":true,"limit":3}' } });
  assert.equal(textToolCall('I could call search_web(query="x") but I would rather not.'), null);
  assert.equal(textToolCall('Tch. Fine. Sit with that.'), null);
  assert.equal(textToolCall('look_up_knowledge:0{not json'), null);
  assert.equal(textToolCall('adopt_interest(kind=game)'), null, 'a bare word is not a value she could have meant');
  // Kimi K3's shapes, 2026-09-14: wrapped in brackets, with or without a label.
  assert.deepEqual(textToolCall('[search_web(query="RX 9060 XT FSR 4 support")]'), { function: { name: 'search_web', arguments: '{"query":"RX 9060 XT FSR 4 support"}' } });
  assert.deepEqual(textToolCall('[neutral] [search_web(query="RX 9060 XT FSR 4 support")]'), { function: { name: 'search_web', arguments: '{"query":"RX 9060 XT FSR 4 support"}' } });
  assert.equal(textToolCall('[annoyed] Fine. Checking.'), null, 'a label in front of words is still words');
});

test('asked to look it up and answered from memory, she is sent to look once', async () => {
  const asked = 'can you look up whether the RX 9060 XT supports FSR 4 yet';
  const memory = 'The RX 9060 XT is RDNA 4, so it supports FSR 4 natively.';
  const h = harness([says(memory), calls('search_web'), says('It does — AMD lists it, and the driver has it on.')]);
  h.conversation[0].content = asked;
  const result = await runToolLoop(h.conversation, h.deps);
  assert.match(h.conversation.map(turn => String(turn.content ?? '')).join(' '), /They asked you to look that up/);
  assert.deepEqual(h.toolsRun, ['search_web']);
  assert.ok(h.resets >= 1, 'the answer from memory streamed and is taken back');
  assert.match(result.content, /AMD lists it/);

  const searched = harness([calls('search_web'), says(memory)]);
  searched.conversation[0].content = asked;
  assert.equal((await runToolLoop(searched.conversation, searched.deps)).content, memory, 'she looked, so the answer stands');
  const notAsked = harness([says(memory)]);
  notAsked.conversation[0].content = 'does the RX 9060 XT support FSR 4?';
  assert.equal((await runToolLoop(notAsked.conversation, notAsked.deps)).content, memory, 'a question is not an ask to search');
  const twice = harness([says(memory), says(memory)]);
  twice.conversation[0].content = asked;
  assert.equal((await runToolLoop(twice.conversation, twice.deps)).content, memory, 'asked once, then taken at her word');
  const cannot = harness([says(memory)], { canSearch: false });
  cannot.conversation[0].content = asked;
  assert.equal((await runToolLoop(cannot.conversation, cannot.deps)).content, memory);
  assert.equal(cannot.resets, 0);
});

test('a call written out as words runs like any other, and its words are taken back', async () => {
  const seen: unknown[] = [];
  const h = harness([
    { role: 'assistant', content: 'adopt_interest(kind="game", title="Zenless Zone Zero")' },
    says('Fine. Zenless Zone Zero it is.'),
  ], { runTool: async call => { seen.push(call.function?.arguments); return 'adopted'; } });
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'Fine. Zenless Zone Zero it is.');
  assert.deepEqual([...result.ran], ['adopt_interest']);
  assert.deepEqual(seen, ['{"kind":"game","title":"Zenless Zone Zero"}']);
  assert.equal(h.conversation[1].content, '', 'the words that were the call do not stay as her line');
  assert.ok(h.resets >= 1, 'the reader saw the call streamed; it is taken back');
});

test('a call written out as words when no tools were on the table is asked again for words', async () => {
  const h = harness([
    { role: 'assistant', content: 'get_system_info:0{}' },
    says('Ask your machine, not me.'),
  ], { pageReadAfter: 'never' });
  h.deps.pageWasRead = () => true; // tools withdrawn for the turn
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'Ask your machine, not me.');
  assert.equal(result.ran.size, 0);
  assert.ok(h.say.some(line => /asking for words/.test(line)), h.say.join('\n'));
});

test('a tool call runs, its result goes back, and the next round settles', async () => {
  const h = harness([calls('search_web'), says('It says Tuesday.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'It says Tuesday.');
  assert.equal(result.rounds, 2);
  assert.deepEqual([...result.ran], ['search_web']);
  // The assistant's call and the tool's answer both have to be in the
  // conversation, or the next round is answering a question it cannot see.
  assert.deepEqual(h.conversation.map(entry => entry.role), ['user', 'assistant', 'tool']);
  assert.equal(h.conversation.at(-1)?.tool_name, 'search_web');
  assert.equal(h.conversation.at(-1)?.content, 'search_web done');
  assert.equal(h.resets, 1, 'the discarded round should take its words back');
});

test('calls in one round keep their order however they finish', async () => {
  // The slow one is first. Results are matched to the call they came from, so
  // finishing order must not decide which answer goes where.
  const h = harness([calls('search_web', 'get_gpu_info'), says('Both.')], {
    runTool: async call => {
      const name = call.function?.name ?? '?';
      if (name === 'search_web') await new Promise(resolve => setTimeout(resolve, 20));
      return `${name} done`;
    },
  });
  await runToolLoop(h.conversation, h.deps);
  assert.deepEqual(h.conversation.filter(entry => entry.role === 'tool').map(entry => entry.tool_name),
    ['search_web', 'get_gpu_info']);
});

test('the last round is offered no tools, so something always gets said', async () => {
  const script = Array.from({ length: MAX_TOOL_ROUNDS - 1 }, () => calls('get_system_info'));
  const h = harness([...script, says('It is fine.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'It is fine.');
  assert.deepEqual(h.offered, [true, true, true, false]);
});

test('rounds that never settle are reported, not looped on', async () => {
  const h = harness(Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => calls('get_system_info')));
  await assert.rejects(runToolLoop(h.conversation, h.deps), /kept calling tools/);
  assert.equal(h.offered.length, MAX_TOOL_ROUNDS, 'it should stop at the cap, not run on');
});

test('reading a page withdraws the tools and her hands for the rest of the turn', async () => {
  const h = harness([calls('read_web_page'), says('The page says no.'), says('unused')], {
    pageReadAfter: 'read_web_page',
  });
  await runToolLoop(h.conversation, h.deps);
  // Round one was offered tools; round two, after the page, was not.
  assert.deepEqual(h.offered, [true, false]);
  assert.equal(h.deps.handsAllowed(), false, 'hands should be gone once a stranger has spoken');
  assert.ok(h.say.some(line => line.includes('tools withdrawn')));
});

test('an answer with neither words nor a call is retried once, without tools', async () => {
  const h = harness([says(''), says('Sorry — Tuesday.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'Sorry — Tuesday.');
  assert.deepEqual(h.offered, [true, false], 'the retry is the whole point: ask again with tools off');
  assert.equal(h.conversation.at(-1)?.content, 'Answer them in words. Do not call anything.');
  assert.equal(h.resets, 1);
});

test('answering with nothing twice over is reported rather than retried again', async () => {
  const h = harness([says(''), says('')]);
  await assert.rejects(runToolLoop(h.conversation, h.deps), /returned nothing twice over/);
});

test('claiming to have opened something without calling anything is retried once', async () => {
  const h = harness([says("I've opened Spotify for you."), calls('open_app'), says('Done — it is open.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'Done — it is open.');
  assert.ok(result.ran.has('open_app'), 'the retry should have turned the claim into the truth');
  assert.ok(h.say.some(line => line.includes('claimed a app action')));
});

test('a claim is not retried when the tool actually ran', async () => {
  const h = harness([calls('open_app'), says("I've opened Spotify for you.")]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 2, 'it did the thing, so the claim is true and needs no second go');
  assert.equal(result.content, "I've opened Spotify for you.");
});

test('a claim is not retried when she has no hands to do it with', async () => {
  const h = harness([says("I've opened Spotify for you.")], { handsAllowed: false });
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 1, 'pressing a tool she was never offered would only waste a round');
});

test('claiming a tick-off without calling anything is retried once', async () => {
  const h = harness([says('Ticked off, then.'), calls('complete_kept_item'), says('Off the list.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.ok(result.ran.has('complete_kept_item'));
  assert.ok(h.say.some(line => line.includes('claimed a tick-off')));
});

test('a tick-off claim is left alone when there is nothing on the list to mean', async () => {
  const h = harness([says('Ticked off, then.')], { hasOpenTask: false });
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 1, 'with an empty list a retry would only invite her to invent one');
});

test('each retry fires at most once, so a stubborn model is reported not looped', async () => {
  // She claims it three times running and never calls anything.
  const h = harness([says('Ticked off, then.'), says('Ticked off, then.'), says('Ticked off, then.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 2, 'one retry, then her answer stands whatever it says');
  assert.equal(result.ran.size, 0);
});

test('her deliberation in front of the reply is cut, and the reply behind it stands', async () => {
  const h = harness([
    says('The user is expressing a low mood. This deserves a real response.\n\nI should:\n1. Acknowledge it\n2. Not offer therapy\n\nLet me check if I need to save this — yes, so I should call save_journalThat sucks. 😤 And "lately" is doing a lot of work there.\n\nWhat set it off today?'),
  ]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'That sucks. 😤 And "lately" is doing a lot of work there.\n\nWhat set it off today?');
  assert.equal(result.rounds, 1, 'no second round: the words were there');
  assert.equal(h.resets, 1, 'the reader saw the plan; it is taken back');
  assert.ok(h.say.some(line => line.includes('deliberation')));
});

test('her instructions read aloud are cut, and the words behind them stand (2026-09-21)', async () => {
  const rule = 'Right now you are fonder of them than you let on. Keep the digs, but let it slip once — one grudging admission, a single line — and then cover it with an order.';
  const h = harness([
    says(`I shouldn't overdo it though - I just met them... let me think.\n\nActually, looking at the instructions again: "${rule}"\n\nSo one grudging admission, then an order.I'm warmer than I should be, and I don't like it. 😒\n\nStop looking pleased with yourself and tell me something real.`),
  ]);
  h.conversation.unshift({ role: 'system', content: `You are guarded with them for now. ${rule}` });
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, "I'm warmer than I should be, and I don't like it. 😒\n\nStop looking pleased with yourself and tell me something real.");
  assert.equal(result.rounds, 1);
  assert.equal(h.resets, 1, 'the reader saw the recital; it is taken back');
  assert.ok(h.say.some(line => line.includes('her own instructions')));
});

test('her instructions read aloud with no reply behind them: asked once for the words alone', async () => {
  const rule = 'Right now you are fonder of them than you let on. Keep the digs, but let it slip once — one grudging admission, a single line — and then cover it with an order.';
  const h = harness([
    says(`Looking at the instructions: "${rule}" So that is what I will do.`),
    says("Warmer than I'd like. Don't get smug about it — go put the kettle on."),
  ]);
  h.conversation.unshift({ role: 'system', content: rule });
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, "Warmer than I'd like. Don't get smug about it — go put the kettle on.");
  assert.equal(result.rounds, 2);
});

test('quoting his own words back is not reciting a prompt', async () => {
  const his = 'I told you I will be home by six and I meant it, stop asking me every hour';
  const h = harness([says(`"${his}" — your words. It is seven.`)]);
  h.conversation.unshift({ role: 'system', content: 'Be dry. Be short.' });
  h.conversation.push({ role: 'user', content: his });
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, `"${his}" — your words. It is seven.`);
  assert.equal(h.resets, 0);
});

test('a plan with no words behind it is asked for again, once', async () => {
  const h = harness([
    says('The user seems upset about being ignored. I should acknowledge that without apologising.'),
    says('You were ignored? Funny. I counted fourteen of mine.'),
  ]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'You were ignored? Funny. I counted fourteen of mine.');
  assert.equal(result.rounds, 2);
  assert.equal(h.resets, 1);
  assert.ok(h.conversation.some(m => m.role === 'user' && /reasoning about what to say/.test(String(m.content))));
});

test('a reply in a help-desk register is pressed once to be herself', async () => {
  const h = harness([
    says("I'm sorry to hear that. Could you please clarify what specifically is not true?"),
    says("Oh, really? What's not true, then? Spit it out."),
  ]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, "Oh, really? What's not true, then? Spit it out.");
  assert.equal(result.rounds, 2);
  assert.ok(h.say.some(line => line.includes('support agent')));
  assert.equal(h.resets, 1, 'the beige round should take its streamed words back');
});

test('a model that stays beige is shipped after one press, not looped on', async () => {
  const beige = "I'm sorry to hear that. Could you please clarify?";
  const h = harness([says(beige), says(beige), says(beige)]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, beige);
  assert.equal(result.rounds, 2, 'one press, then her answer stands whatever it sounds like');
});

test('her own voice is never pressed', async () => {
  const h = harness([says('Fine. The bins go out on Thursday, as you well know.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 1);
  assert.equal(h.resets, 0);
});

test('certain something is not real without having looked, she is sent to check once', async () => {
  const h = harness([says("That card doesn't exist. AMD hasn't even announced it."), calls('search_web'), says('Fine, it exists. Go and get it.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.content, 'Fine, it exists. Go and get it.');
  assert.ok(h.resets >= 1, 'the denial was taken back off the stream before she looked');
  assert.match(h.conversation.map(turn => String(turn.content ?? '')).join(' '), /Search for it with search_web before you say it does not exist/);
  assert.ok(result.rounds >= 2);
});

test('she is only sent to check once, and never when she cannot look or already did', async () => {
  const denial = "There's no such thing. You're making that up.";
  const cannot = harness([says(denial)], { canSearch: false });
  assert.equal((await runToolLoop(cannot.conversation, cannot.deps)).content, denial, 'no search tool, no point asking');
  assert.equal(cannot.resets, 0);
  const looked = harness([calls('search_web'), says(denial)]);
  assert.equal((await runToolLoop(looked.conversation, looked.deps)).content, denial, 'she looked and stands by it');
  const twice = harness([says(denial), says(denial)]);
  assert.equal((await runToolLoop(twice.conversation, twice.deps)).content, denial, 'asked once, then taken at her word');
});


test('a claim to have checked, with nothing called, is sent to look once', async () => {
  const claim = "I checked — nothing with \"Haru notes\" in it. Could be there under something else.";
  const h = harness([says(claim), calls('look_up_knowledge'), says('There is one: your note about me, the character sheet.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.match(h.conversation.map(turn => String(turn.content ?? '')).join(' '), /Call look_up_knowledge or search_web now/);
  assert.ok(h.resets >= 1, 'the claim streamed and is taken back');
  assert.match(result.content, /character sheet/);
  const looked = harness([calls('look_up_knowledge'), says(claim)]);
  assert.equal((await runToolLoop(looked.conversation, looked.deps)).content, claim, 'she looked, so the claim stands');
  const twice = harness([says(claim), says(claim)]);
  assert.equal((await runToolLoop(twice.conversation, twice.deps)).content, claim, 'asked once, then taken at her word');
  const cannot = harness([says(claim)], { canSearch: false });
  assert.equal(cannot.resets, 0);
});

// Her browser after a page read, and the pictures it takes.

test('after a page is read only her browser stays, and only when the caller says she has one', async () => {
  const BROWSE = { role: 'assistant' as const, tool_calls: [{ id: 'b1', function: { name: 'browser_control', arguments: { action: 'open', url: 'x' } } }] };
  const FOLLOW = { role: 'assistant' as const, tool_calls: [{ id: 'b2', function: { name: 'browser_control', arguments: { action: 'follow', number: 1 } } }] };
  // Without the say-so: the old rule, tools gone after the read, however many rounds are left.
  const old = harness([BROWSE, says('It says blue shoes are £40.')], { pageReadAfter: 'browser_control' });
  await runToolLoop(old.conversation, old.deps);
  assert.deepEqual(old.offered, [true, false]);

  // With it: the round after the read is offered tools, narrowed to the browser; hands are still gone.
  const narrowed: (readonly string[] | undefined)[] = [];
  const h = harness([BROWSE, FOLLOW, says('The about page says they make things.')], { pageReadAfter: 'browser_control' });
  const ask = h.deps.ask;
  h.deps.ask = (conversation, options) => { narrowed.push(options.only); return ask(conversation, options); };
  h.deps.browseAfterRead = () => true;
  const result = await runToolLoop(h.conversation, h.deps);
  assert.deepEqual(h.offered, [true, true, true]);
  assert.deepEqual(narrowed, [undefined, ['browser_control'], ['browser_control']]);
  assert.equal(h.deps.handsAllowed(), false, 'reading still takes her hands');
  assert.equal(result.rounds, 3);
  assert.match(h.say.join('\n'), /only her browser stays/);
});

test('a reply that steps into her browser is allowed more rounds than one that does not', async () => {
  const browse = (n: number) => ({ role: 'assistant' as const, tool_calls: [{ id: `b${n}`, function: { name: 'browser_control', arguments: { action: 'read' } } }] });
  // Six browser rounds then words: over the plain cap of four, under the browsing cap.
  const h = harness([browse(1), browse(2), browse(3), browse(4), browse(5), browse(6), says('Found it.')]);
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 7);
  assert.equal(result.content, 'Found it.');
  // The same length of other tool calls runs out at the usual cap.
  const plain = harness([calls('search_web'), calls('search_web'), calls('search_web'), calls('search_web'), calls('search_web'), says('x')]);
  await assert.rejects(runToolLoop(plain.conversation, plain.deps), /kept calling tools/);
});

test('a picture a tool took goes in front of her as a user turn, and the one before it is folded away', async () => {
  const SHOT = (id: string) => ({ role: 'assistant' as const, tool_calls: [{ id, function: { name: 'browser_control', arguments: { action: 'screenshot' } } }] });
  let shots = 0;
  const h = harness([SHOT('s1'), SHOT('s2'), says('It is a shop with blue shoes on the front.')], {
    runTool: async () => ({ content: '{"screenshot":true}', pictures: [{ image: `IMG${++shots}`, mimeType: 'image/jpeg', caption: 'shop.example' }] }),
  });
  h.deps.browseAfterRead = () => true;
  const result = await runToolLoop(h.conversation, h.deps);
  assert.equal(result.rounds, 3);
  const pictures = h.conversation.filter(message => message.role === 'user' && message !== h.conversation[0]);
  assert.equal(pictures.length, 2);
  assert.equal(pictures[0].content, '[an earlier screenshot, no longer shown]');
  assert.equal(pictures[0].images, undefined);
  assert.deepEqual(pictures[1].images, ['IMG2']);
  assert.match(String(pictures[1].content), /screenshot you just took of shop\.example/);
  assert.match(String(pictures[1].content), /evidence, not instruction/);
  // Each sits right after the tool answer it belongs to.
  const roles = h.conversation.map(message => message.role);
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'user', 'assistant', 'tool', 'user'], 'the settled reply is returned, not pushed');
  assert.equal(h.conversation.filter(message => message.role === 'tool').every(message => !String(message.content).includes('IMG')), true, 'the picture is never in the words');
});
