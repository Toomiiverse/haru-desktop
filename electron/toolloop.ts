import {localReplyOwned,localReplyDecision} from './core-local-reply';
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

import type { ChatMessage, ChatTool, ToolCall } from './provider';
import { claimsDesktopAction, claimsTickOff, readsLikeAssistant, deniesItExists, thinksAloud, dropThinkingAloud, recitedSpan, dropRecitedPrompt, claimsChecked, asksToLookUp } from './reply';
import { stripDelivery } from './delivery';
import { makeToolReceipt, storedToolReceipt, isReadTool, type ToolReceipt } from './tool-receipt';
import { priorLookups } from './lookup-notes';
import { evidenceProblem } from './evidence-check';
import { toolContract, toolCallProblem } from './tool-contract';
import type { CoreReadOnlyBridge } from './core-read-only';
export { toolResultSucceeded } from './tool-receipt';

/** How many rounds a single reply may spend before it has to settle. */
export const MAX_TOOL_ROUNDS = 4;

/** A failed, observable result check; transport failures and cancellation are separate. */
export class ToolLoopFailure extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ToolLoopFailure';
  }
}

/** A read of one domain is not evidence of having inspected another. */
export function hasCheckingEvidence(reply: string, names: Set<string>): boolean {
  const reads = [...names].filter(name => isReadTool(name) || name === 'run_command' || name === 'browser_control');
  for (const clause of reply.split(/[.!?;\n]/)) {
    if (!claimsChecked(clause)) continue;
    if (/\bI(?:'ve| have| just)? (?:checked|verified|confirmed) (?:the |my )?(?:arithmetic|addition|sum|math|calculation)\b/i.test(clause) && !/\b(?:file|spreadsheet|website|log|tool)\b/i.test(clause)) continue;
    if (!reads.length) return false;
    const groups: [RegExp, RegExp][] = [
      [/\b(?:gpu|gpus|graphics card|vram)\b/i, /^(?:get_gpu_info|diagnose_system|run_command)$/],
      [/\b(?:vault|notes|knowledge|files|documents|docs)\b/i, /^(?:vault_read|vault_list|look_up_knowledge|run_command)$/],
      [/\b(?:service|services|obsidian)\b/i, /^(?:get_service_status|diagnose_system|run_command)$/],
      [/\b(?:container|containers|docker)\b/i, /^(?:get_docker_status|diagnose_system|run_command)$/],
      [/\b(?:web|online|internet)\b/i, /^(?:search_web|read_web_page|browser_control)$/],
      [/\b(?:logs?|backup|backups|lokit)\b/i, /^(?:run_command|vault_read)$/],
    ];
    for (const [scope, tools] of groups) if (scope.test(clause) && !reads.some(name => tools.test(name))) return false;
  }
  return true;
}

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
  if(localReplyOwned())return localReplyDecision('local-reply.textToolCall',[content]);
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

export type WorkflowRole='everyday'|'conversation'|'affordable-cloud'|'specialist'|'complex'|'premium';
export type WorkflowWorkerResult={message:ChatMessage;model:string}|{error:'unavailable'|'timeout'|'budget'|'transport';model:string|null};
export type ToolLoopDeps = {
  splitPlanning?: boolean;
  /** Core's umbral opening, shown before the reply settles (core-harness). */
  onPresentation?: (text: string) => void;
  publicLookupPrepared?: boolean;
  generalToolSplit?: boolean;
  /** Existing outbound permission supplied to Core as a routing observation. */
  generalToolCloudAllowed?: boolean;
  toolSnapshot?:()=>ChatTool[];
  receiptPrograms?:boolean;
  /** Registered, tool-free text workers; Core supplies the admitted program. */
  workerRoles?:WorkflowRole[];
  runWorker?:(conversation:ChatMessage[],options:{role:WorkflowRole;maxTokens:number})=>Promise<WorkflowWorkerResult>;
  /** Optional private Core round owner; null means unsupported before dispatch. */
  coreHarness?:(conversation:ChatMessage[],deps:ToolLoopDeps)=>Promise<ToolLoopResult|null>;
  coreReadOnly?:CoreReadOnlyBridge;
  /** Tool-free composition after an admitted Core read prefix. */
  toolsAllowed?:()=>boolean;
  /** Production loops require transport-owned schemas for every proposed call. */
  requireToolContract?: boolean;
  /**
   * Ask the model. `tools` is the loop's decision; everything else about the
   * request — which provider, the token cap, where the stream goes, what
   * happens when a rented GPU is switched off — belongs to the caller and is
   * closed over here.
   */
  ask(conversation: ChatMessage[], options: { tools: boolean;inputProfile?:'grounded-perception'|'tool-planning'|'workflow-response'|'general-tool-planning'|'general-tool-response';planningTable?:ChatTool[];maxTokens?:number;candidateId?:string;temperature?:number }): Promise<ChatMessage>;
  /** Run one tool call and return what the model should be told about it. */
  runTool(call: ToolCall): Promise<string | ToolReceipt>;
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
  /** Successful tools already recorded by the task before a model handoff. */
  initialRan?: Set<string>;
  /** Explicit cancellation is not a failed quality check and must not escalate. */
  signal?: AbortSignal;
  onCheckFailure?(failure: { code: string; message: string }): void;
  /** Only used in tests, to keep a case from having to run four real rounds. */
  maxRounds?: number;
  /** Native harness whole-batch cap; provider/tool adapters retain permission checks. */
  maxToolCalls?: number;
};

export type ToolLoopResult = {
  /** The reply that settled: words, no tool calls, no retry outstanding. */
  message: ChatMessage;
  /** Its words. Separate because the loop only ever returns when there are
   *  some, which spares every caller a narrowing check for an impossible case. */
  content: string;
  /** Tools with successful results, including supplied handoff evidence.
   * Failed or uncertain attempts cannot support a completion claim. */
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
  if(deps.coreHarness){
    const remote=await deps.coreHarness(conversation,{...deps,coreHarness:undefined});
    if(remote)return remote;
  }
  const maxRounds = deps.maxRounds ?? MAX_TOOL_ROUNDS;
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? log;
  const trace = deps.traceId ? ` trace=${deps.traceId}` : '';
  const resetStream = () => deps.resetStream?.();
  // Which tools actually ran, so a claim to have done something can be checked
  // against whether anything was done.
  const ran = new Set<string>(deps.initialRan);
  const receipts: ToolReceipt[] = [];
  for (const row of conversation) {
    if (row.role !== 'tool' || !row.tool_name || !row.content) continue;
    const call = conversation.flatMap(parent => parent.role === 'assistant' ? parent.tool_calls ?? [] : [])
      .find(c => c.id && c.id === row.tool_call_id && c.function?.name === row.tool_name);
    if (!call) continue;
    const stored = storedToolReceipt(row.content);
    const receipt = stored?.tool === row.tool_name ? stored : makeToolReceipt(row.tool_name, call.function?.arguments, row.content, null, null);
    if (!receipts.some(r => r.executionId === receipt.executionId)) receipts.push(receipt);
  }
  const checkActive = () => {
    if (deps.signal?.aborted) {
      const error = new Error('The task was cancelled.');
      error.name = 'AbortError';
      throw error;
    }
  };
  const checkFailed = (code: string, message: string) => {
    // Diagnostics do not own whether the task is allowed to continue.
    try { deps.onCheckFailure?.({ code, message }); } catch { /* optional diagnostics */ }
  };
  const fail = (code: string, message: string): never => {
    resetStream();
    checkFailed(code, message);
    throw new ToolLoopFailure(code, message);
  };
  // One retry each per reply, so a model that answers nothing — or claims
  // something it did not do — twice over is reported rather than looped on.
  let emptyRetried = false;
  let claimRetried = false;
  let tickRetried = false;
  let existenceRetried = false;
  let checkRetried = false;
  let evidenceRetried = false;
  let lookUpRetried = false;
  let voiceRetried = false;
  let withheldRetried = false;
  let invalidCallRetried = false;
  // What they asked, read once before any corrective turn is pushed after it.
  const theirWords = String([...conversation].reverse().find(turn => turn.role === 'user')?.content ?? '');
  const invitedJoke = /^(?:(?:(?:can|could|would) you )?(?:please )?tell me (?:a|another|one more) (?:(?:short|silly|dark) )?joke|(?:please )?(?:make me laugh|roast me|say something funny))(?: please)?[.!? ]*$/i.test(theirWords.trim());
  const explicitlyFictional = invitedJoke || /^\s*(?:write|tell|compose|invent|create)\b[\s\S]{0,160}\b(?:fiction|fictional|imaginary)\b/i.test(theirWords);

  for (let round = 0; round < maxRounds; round++) {
    checkActive();
    // Reading anything ends her reach for the rest of the turn. pageWasRead
    // already withdraws every tool, and this makes the narrower promise explicit
    // so that loosening one does not silently loosen the other.
    if (deps.pageWasRead()) deps.withdrawHands();
    // The last round has its tools withdrawn too: without this, a turn that
    // spends every round calling tools — retrying a save that keeps failing,
    // say — hits the cap still mid tool-call, with the result thrown away and
    // nothing said, even on a round whose tool call actually succeeded. Forcing
    // words here means whatever just happened gets reported instead of lost.
    const tools = deps.toolsAllowed?.()!==false && !deps.pageWasRead() && !emptyRetried && round < maxRounds - 1;
    const roundStarted = Date.now();
    const message = await deps.ask(conversation, { tools });
    checkActive();

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
      } else if (written) {
        fail('tools_withheld', 'The model kept calling tools after they were withdrawn.');
      }
    }

    if (message.tool_calls?.length) {
      const table = tools ? toolContract(message) ?? (deps.requireToolContract ? [] : undefined) : undefined;
      // Reject the whole batch before any side effect. Never replay malformed
      // protocol fields (which can contain fabricated results) to another model.
      const problem = message.tool_calls.map(call => toolCallProblem(call, table)).find(Boolean);
      const ids = message.tool_calls.map(call => call.id).filter(Boolean);
      if (problem || new Set(ids).size !== ids.length) {
        const reason = problem ?? 'Duplicate tool call IDs.';
        resetStream();
        if (invalidCallRetried || round === maxRounds - 1) fail('invalid_tool_call', reason);
        invalidCallRetried = true;
        checkFailed('invalid_tool_call', reason);
        conversation.push({ role: 'user', content: `The proposed operations were rejected before execution: ${reason} Nothing in that batch ran. Use only the tools and argument schemas offered on this request. If none are available, state that you cannot check or perform the action. Do not invent observations or success.` });
        continue;
      }
      // Logged by name: when a tool does not fire, the useful question is whether
      // the model reached for the wrong one or for none at all.
      //
      // Timed as well, because each of these is a whole extra round trip before
      // the user sees a word, and away from the desk that is the difference
      // between a reply and a wait. Which tools are worth offering to a phone is
      // a question this log is here to answer with numbers.
      log(`[ai] round ${round + 1} took ${Date.now() - roundStarted}ms — tool calls: ${message.tool_calls.map(call => call.function?.name ?? '?').join(', ')}${trace}`);
      resetStream();
      message.tool_calls = message.tool_calls.map((call, index) => ({ ...call, id: call.id ?? `call_${conversation.length}_${index}` }));
      conversation.push(message);
      // A read can revoke permissions and a mutation can change what the next
      // call sees. Execute in order and re-check before each operation.
      for (const call of message.tool_calls) {
        checkActive();
        const withheld = !tools || deps.pageWasRead();
        if (deps.pageWasRead()) deps.withdrawHands();
        const startedAt = Date.now();
        const output = withheld
          ? JSON.stringify({ error: 'Tools have been withdrawn for this reply. This operation was not executed.' })
          : await deps.runTool(call);
        const receipt = typeof output === 'string'
          ? makeToolReceipt(call.function?.name ?? 'unknown', call.function?.arguments, output, startedAt, Date.now()) : output;
        const content = JSON.stringify(receipt);
        if (!receipts.some(r => r.executionId === receipt.executionId)) receipts.push(receipt);
        // Keep completed operation evidence even if cancellation arrived during
        // execution. The task executor owns reconciling an interrupted action.
        conversation.push({ role: 'tool', tool_name: call.function?.name, tool_call_id: call.id, content });
        if (!withheld && call.function?.name && receipt.outcome === 'succeeded') ran.add(call.function.name);
        if (withheld) checkFailed('tools_withheld', 'The model requested a tool after tools were withdrawn.');
        checkActive();
      }
      if (!tools) {
        if (withheldRetried || round === maxRounds - 1) fail('tools_withheld', 'Haru kept calling tools after they were withdrawn, without settling on a reply.');
        withheldRetried = true;
        conversation.push({ role: 'user', content: 'Those operations were not executed. Answer in words using the results already available. Do not claim those operations happened.' });
      }
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
        checkFailed('empty_response', 'The model returned neither words nor a tool call.');
        emptyRetried = true;
        resetStream();
        warn('[ai] empty response with no tool call — retrying once without tools');
        conversation.push({ role: 'user', content: 'Answer them in words. Do not call anything.' });
        continue;
      }
      return fail('empty_response', 'The model returned nothing twice over. It may be overloaded — try again in a moment.');
    }
    if (/^(?:get|run|read|set|create|search|book|vault)_[a-z_]+$/.test(message.content.trim())) {
      if (invalidCallRetried) fail('invalid_tool_call', 'The model returned only a tool name instead of an answer.');
      invalidCallRetried = true;
      checkFailed('invalid_tool_call', 'The model returned only a tool name.');
      resetStream();
      conversation.push({ role: 'user', content: 'A tool name is not an executed operation or an answer. Use an offered tool properly, or plainly say that you cannot perform the check. No operation ran.' });
      continue;
    }

    // Some local models print the would-be arguments instead of calling a tool.
    // Do not present those as a completed action, or infer a tool and execute it.
    if (!/\b(?:json|schema|example|code|template)\b/i.test(theirWords)) {
      let printed: any;
      try { printed = JSON.parse(message.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* prose */ }
      if (printed && typeof printed === 'object' && !Array.isArray(printed)
        && (('title' in printed && ('date' in printed || 'time' in printed)) || ('command' in printed) || ('tool_calls' in printed))) {
        if (invalidCallRetried) fail('invalid_tool_call', 'The model printed operation arguments instead of an executable tool call or an honest answer.');
        invalidCallRetried = true;
        checkFailed('invalid_tool_call', 'Operation arguments were printed without a tool call.');
        resetStream();
        conversation.push({ role: 'user', content: 'That was only printed operation data, not an executed action. Use an offered tool if appropriate. Otherwise say plainly that nothing was executed or saved. Do not print tool arguments as your answer.' });
        continue;
      }
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
    const actionSupported = ran.has(wanted) || (claim === 'app' && ran.has('close_app'));
    if (claim && !actionSupported && (claimRetried || deps.pageWasRead() || !deps.handsAllowed())) {
      fail('unsupported_action', 'The model claimed a desktop action without a successful tool result.');
    }
    if (claim && !claimRetried && !deps.pageWasRead() && deps.handsAllowed() && !actionSupported) {
      checkFailed('unsupported_action', 'The model claimed a desktop action without a successful tool result.');
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
    if (claimsTickOff(message.content) && tickRetried && !ran.has('complete_kept_item')) {
      fail('unsupported_tickoff', 'The model claimed a completed task without a successful tool result.');
    }
    if (claimsTickOff(message.content) && !tickRetried && !ran.has('complete_kept_item') && deps.hasOpenTask()) {
      checkFailed('unsupported_tickoff', 'The model claimed a completed task without a successful tool result.');
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

    // A successful mutation is not evidence that she searched or inspected
    // anything. Repair unsupported checking claims even when search is disabled.
    const readEvidence = new Set(receipts.filter(r => r.outcome === 'succeeded' && (r.access === 'read'
      || r.tool === 'run_command' && typeof r.scope.command === 'string'
        && !/[;&|`$<>\n]/.test(r.scope.command)
        && /^(?:nvidia-smi|journalctl|cat|head|tail|rg|df|du|ps|uptime|free)\b|^systemctl\s+(?:--user\s+)?(?:is-active|status|show)\b/.test(r.scope.command.trim())))
      .map(r => r.tool));
    for (const tool of priorLookups(conversation)) readEvidence.add(tool);   // 4530: as in core-reply-inspector
    if (!explicitlyFictional && claimsChecked(message.content) && !hasCheckingEvidence(message.content, readEvidence)) {
      if (checkRetried) fail('unsupported_lookup', 'The model claimed it checked something without a successful read result.');
      checkFailed('unsupported_lookup', 'The model claimed it checked something without a successful read result.');
      checkRetried = true;
      resetStream();
      warn('[ai] unsupported checking claim — requiring evidence or an honest limitation');
      conversation.push(message);
      conversation.push({
        role: 'user',
        content: tools
          ? 'No successful lookup supports that claim. Use a matching read tool if one is offered. Call look_up_knowledge or search_web now only if that is the appropriate source; live machine claims need the matching machine status tool. Answer only from the actual result. Other completed actions are not searches. If no suitable tool is offered or you cannot check, say plainly that you have not checked.'
          : 'No successful lookup supports that claim, and no search is available. Answer from the supplied evidence only. Say plainly what you have not checked and what remains unknown. Do not invent a tool result or claim you performed a check.',
      });
      continue;
    }

    const problem = explicitlyFictional ? null : evidenceProblem(message.content, receipts, Date.now(), theirWords);
    if (problem) {
      if (evidenceRetried) fail('evidence_mismatch', problem);
      evidenceRetried = true;
      checkFailed('evidence_mismatch', problem);
      resetStream();
      // GPU readings have a structured tool whose result the checker parses.
      // A run_command (nvidia-smi) reading is text the checker cannot match, so
      // steer the retry to get_gpu_info rather than let it fail on the mismatch.
      const gpuProblem = /\bgpus?\b|utilization|temperature|vram|graphics cards?/i.test(problem);
      conversation.push(message, { role: 'user', content: gpuProblem
        ? `Evidence check: ${problem} Call get_gpu_info now — the structured GPU tool, not run_command — and answer only from its result. Name each GPU by its exact index, one per line, like "GPU 0: 2%", "GPU 1: 0%", "GPU 2: 97%"; a bare percentage with no GPU named is not acceptable. Do not invent a reading, and do not repeat an unverified action. If the tool is unavailable, say plainly that you cannot check.`
        : `Evidence check: ${problem} Answer again from the tool result only. Bind every measured value to the exact entity it came from. Use an available matching read tool, correct the claim from the receipt, or plainly say what is unverified. Do not repeat an unverified action. Preserve the entity, units and observation time. A pending acknowledgement is not completion.` });
      continue;
    }

    // Asked to look it up, and answered from memory. Kimi K3 did that on two
    // of six "can you look up whether the RX 9060 XT supports FSR 4" turns,
    // and on a third said "Let me check" and cited a spec sheet it never
    // opened (2026-09-14). No claim to catch, so the ask is the tell: once,
    // and only when nothing at all was called and a search was possible.
    if (asksToLookUp(theirWords) && !lookUpRetried && !checkRetried && !ran.size && deps.canSearch()) {
      checkFailed('missing_lookup', 'The requested lookup has no successful tool result.');
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
      checkFailed('unverified_denial', 'The model denied something exists without checking available evidence.');
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

    // Her own instructions read out loud — the part thinksAloud's word lists
    // cannot see (reply.ts recitedSpan). Checked on what survived that first
    // pass, against only what she was told this turn: the system side.
    const instructions = conversation.filter(turn => turn.role === 'system').map(turn => String(turn.content ?? '')).join('\n');
    if (recitedSpan(message.content, instructions)) {
      const { text, dropped } = dropRecitedPrompt(message.content, instructions);
      if (text.length >= 20 && !thinksAloud(text) && !recitedSpan(text, instructions)) {
        resetStream();
        warn(`[ai] dropped ${dropped} chars of her reading her own instructions aloud`);
        message.content = text;
      } else if (!voiceRetried) {
        voiceRetried = true;
        resetStream();
        warn('[ai] she read her own instructions aloud and no clean reply followed — asking once for the words alone');
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

    checkActive();
    return { message, content: message.content, ran, rounds: round + 1 };
  }
  return fail('rounds_exhausted', 'Haru kept calling tools without settling on a reply.');
}
