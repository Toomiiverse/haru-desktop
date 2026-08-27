// The tool loop's rules, none of which could be reached from a test while the
// loop lived inside ollamaChat.
//
// The model is a scripted list of replies. Each case asserts what the loop did
// with them: which rounds were offered tools, what went back into the
// conversation, which retries fired, and what came out the other end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOOL_ROUNDS, runToolLoop, type ToolLoopDeps } from '../electron/toolloop';
import type { ChatMessage, ToolCall } from '../electron/provider';

const says = (content: string): ChatMessage => ({ role: 'assistant', content });
const calls = (...names: string[]): ChatMessage => ({
  role: 'assistant',
  tool_calls: names.map((name, index) => ({ id: `call-${index}`, function: { name, arguments: {} } })),
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
  runTool: (call: ToolCall) => Promise<string>;
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
