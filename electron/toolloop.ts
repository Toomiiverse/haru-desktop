// The tool loop: the rounds Haru is allowed to spend calling tools before she
// has to settle on words.
//
// Lifted out of ollamaChat, which was doing three jobs in one function — build
// the turn, run the rounds, clean up the reply — and could not be tested at any
// of them. This module is only the middle job. Everything it needs from the
// machine arrives through ToolLoopDeps, so the rules below can be exercised
// without a provider, a store, or an Electron window.
//
// The rules, all of them learned the hard way and none of them obvious:
//
//  - Tools are withdrawn once a stranger's page is in the conversation, and
//    stay withdrawn for the rest of the turn.
//  - The last round is offered no tools either, so a turn that spends every
//    round calling them still ends in something said rather than nothing.
//  - An answer with neither words nor a tool call is retried once, without
//    tools, because the usual cause is a malformed call the model can write its
//    way around when it stops trying.
//  - A claim to have done something to the machine, or to have ticked something
//    off, is retried once with the tool pressed on her. Saying it does not make
//    it so, and the tick-off version is not found out for twelve hours.
//
// Each retry fires at most once per turn, so a model that will not comply is
// reported rather than looped on.

import type { ChatMessage, ToolCall } from './provider';
import { claimsDesktopAction, claimsTickOff, readsLikeAssistant, deniesItExists, thinksAloud, dropThinkingAloud, claimsChecked, asksToLookUp } from './reply';
import { stripDelivery } from './delivery';

/** How many rounds a single reply may spend before it has to settle. */
export const MAX_TOOL_ROUNDS = 4;

/**
 * A tool call written out as words.
 *
 * Kimi K2.5 through Venice sometimes puts its call in the text instead of the
 * tool_calls field — its own call tokens stripped on the way, leaving
 * `look_up_knowledge:0{"query": "Haru notes"}` or
 * `adopt_interest(kind="game", title="Zenless Zone Zero")` as the whole reply.
 * Five of those reached the reader as her line on 2026-09-06. Only a reply
 * that is nothing but the call is read this way; a sentence that names a tool
 * is a sentence.
 */
export function textToolCall(content: string): ToolCall | null {
  // Kimi K3 wraps it: `[search_web(query="RX 9060 XT FSR 4 support")]`, and
  // may put a delivery label in front (2026-09-14). One pair of brackets
  // around the whole reply comes off, and any labels with it.
  const text = stripDelivery(content ?? '').trim().replace(/^\[\s*([\s\S]*?)\s*\]$/, '$1').trim();
  // Kimi's own shape: name:0{json}, with or without a `functions.` prefix.
  const kimi = /^(?:functions\.)?([a-z][a-z0-9_]*):\d+\s*(\{[\s\S]*\})$/i.exec(text);
  if (kimi) {
    try { JSON.parse(kimi[2]); } catch { return null; }
    return { function: { name: kimi[1], arguments: kimi[2] } };
  }
  // The pythonic shape: name(key="value", other=3).
  const python = /^(?:functions\.)?([a-z][a-z0-9_]*)\(([\s\S]*)\)$/i.exec(text);
  if (!python) return null;
  const args: Record<string, unknown> = {};
  const inner = python[2].trim();
  const pair = /([a-z_][a-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false|null))\s*(?:,\s*|$)/giy;
  for (let at = 0; at < inner.length;) {
    pair.lastIndex = at;
    const found = pair.exec(inner);
    if (!found) return null;
    const [, key, doubled, single, number, word] = found;
    args[key] = doubled !== undefined ? doubled.replace(/\\(.)/g, '$1')
      : single !== undefined ? single.replace(/\\(.)/g, '$1')
      : number !== undefined ? Number(number)
      : word === 'true' ? true : word === 'false' ? false : null;
    at = pair.lastIndex;
  }
  return { function: { name: python[1], arguments: JSON.stringify(args) } };
}

export type ToolLoopDeps = {
  /**
   * Ask the model. `tools` is the loop's decision; everything else about the
   * request — which provider, the token cap, where the stream goes, what
   * happens when a rented GPU is switched off — belongs to the caller and is
   * closed over here.
   */
  ask(conversation: ChatMessage[], options: { tools: boolean }): Promise<ChatMessage>;
  /** Run one tool call and return what the model should be told about it. */
  runTool(call: ToolCall): Promise<string>;
  /**
   * Whether a stranger's page has entered the conversation. Asked again after
   * every tool round, because reading one is what sets it.
   */
  pageWasRead(): boolean;
  /** Whether she still has hands, which decides if a desktop claim is worth retrying. */
  handsAllowed(): boolean;
  /** Take them away for the rest of the turn. */
  withdrawHands(): void;
  /**
   * Whether there is an open task a tick-off claim could plausibly have meant.
   * With nothing on the list the claim is empty talk, and retrying would only
   * invite her to invent something to tick.
   */
  hasOpenTask(): boolean;
  /** Whether she can actually look something up — a retry that tells her to search is wasted otherwise. */
  canSearch(): boolean;
  /**
   * Take back whatever has been streamed this round. Called before every
   * discarded round: words already shown to the reader become a lie the moment
   * the round they came from is thrown away.
   */
  resetStream?(): void;
  log?(line: string): void;
  /** Retries and refusals, which are worth finding in a log on their own. */
  warn?(line: string): void;
  /** Tags the per-round timing line, so one slow turn can be followed through. */
  traceId?: string;
  /** Only used in tests, to keep a case from having to run four real rounds. */
  maxRounds?: number;
};

export type ToolLoopResult = {
  /** The reply that settled: words, no tool calls, no retry outstanding. */
  message: ChatMessage;
  /** Its words. Separate because the loop only ever returns when there are
   *  some, which spares every caller a narrowing check for an impossible case. */
  content: string;
  /** Which tools actually fired. A claim to have done something can be checked
   *  against this rather than guessed at from the wording of the reply. */
  ran: Set<string>;
  /** Rounds used, counting from one. */
  rounds: number;
};

/**
 * Run rounds against `conversation` until the model settles on something to
 * say. The conversation is appended to in place, exactly as the model needs to
 * see it on the next round.
 *
 * Throws if the rounds run out, or if the model answers with nothing twice
 * over — both are conditions the caller should report rather than paper over.
 */
export async function runToolLoop(conversation: ChatMessage[], deps: ToolLoopDeps): Promise<ToolLoopResult> {
  const maxRounds = deps.maxRounds ?? MAX_TOOL_ROUNDS;
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? log;
  const trace = deps.traceId ? ` trace=${deps.traceId}` : '';
  const resetStream = () => deps.resetStream?.();
  // Which tools actually ran, so a claim to have done something can be checked
  // against whether anything was done.
  const ran = new Set<string>();
  // One retry each per reply, so a model that answers nothing — or claims
  // something it did not do — twice over is reported rather than looped on.
  let emptyRetried = false;
  let claimRetried = false;
  let tickRetried = false;
  let existenceRetried = false;
  let checkRetried = false;
  let lookUpRetried = false;
  let voiceRetried = false;
  // What they asked, read once before any corrective turn is pushed after it.
  const theirWords = String([...conversation].reverse().find(turn => turn.role === 'user')?.content ?? '');

  for (let round = 0; round < maxRounds; round++) {
    // Reading anything ends her reach for the rest of the turn. pageWasRead
    // already withdraws every tool, and this makes the narrower promise explicit
    // so that loosening one does not silently loosen the other.
    if (deps.pageWasRead()) deps.withdrawHands();
    // The last round has its tools withdrawn too: without this, a turn that
    // spends every round calling tools — retrying a save that keeps failing,
    // say — hits the cap still mid tool-call, with the result thrown away and
    // nothing said, even on a round whose tool call actually succeeded. Forcing
    // words here means whatever just happened gets reported instead of lost.
    const tools = !deps.pageWasRead() && !emptyRetried && round < maxRounds - 1;
    const roundStarted = Date.now();
    const message = await deps.ask(conversation, { tools });

    // A call written out as words is the call it is — run, when tools were on
    // the table; asked again for words when they were not.
    if (!message.tool_calls?.length && message.content) {
      const written = textToolCall(message.content);
      if (written && tools) {
        warn(`[ai] a tool call written out as words — running ${written.function?.name}`);
        message.tool_calls = [written];
        message.content = '';
      } else if (written && !emptyRetried) {
        emptyRetried = true;
        resetStream();
        warn(`[ai] a tool call written out as words with no tools on the table (${written.function?.name}) — asking for words`);
        conversation.push(message);
        conversation.push({ role: 'user', content: 'Answer them in words. Do not call anything.' });
        continue;
      }
    }

    if (message.tool_calls?.length) {
      // Logged by name: when a tool does not fire, the useful question is whether
      // the model reached for the wrong one or for none at all.
      //
      // Timed as well, because each of these is a whole extra round trip before
      // the user sees a word, and away from the desk that is the difference
      // between a reply and a wait. Which tools are worth offering to a phone is
      // a question this log is here to answer with numbers.
      log(`[ai] round ${round + 1} took ${Date.now() - roundStarted}ms — tool calls: ${message.tool_calls.map(call => call.function?.name ?? '?').join(', ')}${trace}`);
      for (const call of message.tool_calls) if (call.function?.name) ran.add(call.function.name);
      resetStream();
      conversation.push(message);
      // The calls in one round run together rather than one after another — a
      // search and a page read have nothing to wait for. Order is kept: each
      // result answers the call it was born from, whichever finished first.
      const results = await Promise.all(message.tool_calls.map(async call => ({ call, content: await deps.runTool(call) })));
      for (const { call, content } of results) conversation.push({ role: 'tool', tool_name: call.function?.name, content });
      if (deps.pageWasRead()) log('[search] page read — tools withdrawn for the rest of this reply');
      continue;
    }

    // Empty, with no tool call either. Seen for real, and it reached the user as
    // a red "Couldn't reach ollama" bubble in the middle of a conversation that
    // was working seconds before.
    //
    // The commonest cause is the tool schema: the model means to call something,
    // emits a malformed call, and Ollama hands back a message with neither
    // content nor tool_calls. Asking again with the tools withdrawn nearly always
    // produces the reply it was trying to write, so that is tried once before
    // giving up — and it costs a round trip only in the case that was broken
    // anyway.
    if (!message.content) {
      if (!emptyRetried) {
        emptyRetried = true;
        resetStream();
        warn('[ai] empty response with no tool call — retrying once without tools');
        conversation.push({ role: 'user', content: 'Answer them in words. Do not call anything.' });
        continue;
      }
      throw new Error('The model returned nothing twice over. It may be overloaded — try again in a moment.');
    }

    // She said she did something to the machine. Did she?
    //
    // Wording alone does not fix this — a plainly described tool still missed
    // one time in five on a long conversation — and the failure is the worst
    // kind, because "I'm powering down your computer now" is indistinguishable
    // from success until the user notices the machine is still on. So the claim
    // is caught here and the turn is given one more go with the tool pressed on
    // her. If she takes it, the claim becomes true; if not, she is told to say
    // plainly that she did not do it.
    const claim = claimsDesktopAction(message.content);
    const wanted = claim === 'power' ? 'power' : 'open_app';
    if (claim && !claimRetried && !deps.pageWasRead() && deps.handsAllowed() && !ran.has(wanted) && !ran.has('close_app')) {
      claimRetried = true;
      resetStream();
      warn(`[ai] claimed a ${claim} action without calling anything — retrying once`);
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: 'You just said you had done that, but you did not actually do it — you have to call the tool for it to happen. Do it now if they asked for it. If you are not going to, say plainly that you have not done it rather than implying you have.',
      });
      continue;
    }

    // The same check for the list, and the quieter of the two by far.
    //
    // "I'm powering down your computer" is found out the moment anybody looks at
    // the machine. "Ticked off, then" is found out twelve hours later, when she
    // chases the same task again and nobody can connect the two — which is
    // exactly how a breakfast reported at ten in the morning got shouted about
    // at half past nine at night.
    //
    // Only when there is something it could plausibly have meant: with no open
    // task the claim is empty talk and a retry would only invite her to invent
    // one to tick.
    if (claimsTickOff(message.content) && !tickRetried && !ran.has('complete_kept_item') && deps.hasOpenTask()) {
      tickRetried = true;
      resetStream();
      warn('[agenda] claimed a tick-off without calling anything — retrying once');
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: 'You just said that is ticked off, but it is still on their list — saying so does not change it, calling complete_kept_item does. Call it now for the task you meant. If you did not mean any of the ones actually on the list, say plainly that it is not ticked off rather than implying it is.',
      });
      continue;
    }

    // Says she looked, without having looked. "I checked — nothing with 'Haru
    // notes' in it" went out on a turn where no tool ran (2026-09-06); the
    // note was there. Once, and only when nothing at all was called: a claim
    // after a real lookup is a report.
    if (claimsChecked(message.content) && !checkRetried && !ran.size && deps.canSearch()) {
      checkRetried = true;
      resetStream();
      warn('[ai] she said she checked without calling anything — asking her to look');
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: 'You just said you checked, but you did not call anything — nothing was looked up. Call look_up_knowledge or search_web now for what they asked, and answer from what comes back. If you are not going to look, say plainly that you have not checked rather than implying you did.',
      });
      continue;
    }

    // Asked to look it up, and answered from memory. Kimi K3 did that on two
    // of six "can you look up whether the RX 9060 XT supports FSR 4" turns,
    // and on a third said "Let me check" and cited a spec sheet it never
    // opened (2026-09-14). No claim to catch, so the ask is the tell: once,
    // and only when nothing at all was called and a search was possible.
    if (asksToLookUp(theirWords) && !lookUpRetried && !checkRetried && !ran.size && deps.canSearch()) {
      lookUpRetried = true;
      resetStream();
      warn('[ai] they asked her to look it up and she answered from memory — asking her to look');
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: 'They asked you to look that up, and you answered from memory — nothing was searched. Call search_web (or look_up_knowledge, if it is about their own notes) now and answer from what comes back. If you are not going to look, say so plainly rather than answering as though you had.',
      });
      continue;
    }

    // Certain that something is not real, without having looked. Her training
    // stopped at some point and everything released since looks invented; she
    // told him an RX 9060 XT did not exist while he was standing in the shop.
    // Only once, and only when she could have checked and did not.
    if (deniesItExists(message.content) && !existenceRetried && !ran.has('search_web') && deps.canSearch()) {
      existenceRetried = true;
      resetStream();
      warn('[ai] she said something does not exist without looking — asking her to check');
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: 'You just said that is not real. You do not know that: your training stopped a while ago and anything released since looks invented to you. Search for it with search_web before you say it does not exist. If the search shows it is real, say so plainly and answer the actual question; if it genuinely is not, then say so and you will have earned it.',
      });
      continue;
    }

    // She answered with her deliberation — "The user is expressing… I should:
    // 1. Acknowledge…" — a model's notes to itself said out loud (Kimi K2.5,
    // 2026-09-06). When the words she meant are there behind the notes they
    // are kept and the notes go; when there is nothing but notes, she is asked
    // once for the words alone. Either way the streamed text is taken back:
    // the reader has seen the plan.
    if (thinksAloud(message.content)) {
      const { text, dropped } = dropThinkingAloud(message.content);
      if (text.length >= 40 && !thinksAloud(text)) {
        resetStream();
        warn(`[ai] dropped ${dropped} chars of her own deliberation from in front of the reply`);
        message.content = text;
      } else if (!voiceRetried) {
        voiceRetried = true;
        resetStream();
        warn('[ai] replied with her deliberation instead of the words — asking once for the words alone');
        conversation.push(message);
        conversation.push({
          role: 'user',
          content: 'That reply was your reasoning about what to say, not the thing said. Reply again with only what you would say to them — no analysis of them, no plan, no notes to yourself, and no mention of this note.',
        });
        continue;
      }
    }

    // She answered in the register of a help desk. Four different doors let a
    // model without her voice into the conversation in one evening, and one
    // flat reply teaches the next turn to match it — so the register is
    // corrected at the door they all share, once, whichever way it came in.
    if (readsLikeAssistant(message.content) && !voiceRetried) {
      voiceRetried = true;
      resetStream();
      warn('[ai] replied like a support agent — retrying once in her own voice');
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: 'That reply reads like a customer-support agent, and you are not one. Say the same thing again as yourself — the prompt says who you are — without apologising, without offering further assistance, and without mentioning this note.',
      });
      continue;
    }

    return { message, content: message.content, ran, rounds: round + 1 };
  }
  throw new Error('Haru kept calling tools without settling on a reply.');
}
