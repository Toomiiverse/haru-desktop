// The tool loop's rules, none of which could be reached from a test while the
// loop lived inside ollamaChat.
//
// The model is a scripted list of replies. Each case asserts what the loop did
// with them: which rounds were offered tools, what went back into the
// conversation, which retries fired, and what came out the other end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOOL_ROUNDS, runToolLoop, type ToolLoopDeps, textToolCall } from '../electron/toolloop';
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
  canSearch: boolean;
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

test('answering with nothing twice over is reported rather than retried again', async () => {
  const h = harness([says(''), says('')]);
  await assert.rejects(runToolLoop(h.conversation, h.deps), /returned nothing twice over/);
});
