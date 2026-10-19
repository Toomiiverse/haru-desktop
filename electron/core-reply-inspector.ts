// Existing deterministic reply checks, isolated for the Core orchestrator.
// No model call, authority grant or personality prompt is introduced here.
import type {ChatMessage} from './provider';
import type {ToolReceipt} from './tool-receipt';
import {isReadTool} from './tool-receipt';
import {evidenceProblem} from './evidence-check';
import {claimsDesktopAction,claimsTickOff,readsLikeAssistant,deniesItExists,thinksAloud,dropThinkingAloud,recitedSpan,dropRecitedPrompt,claimsChecked,asksToLookUp} from './reply';
import {hasCheckingEvidence,ToolLoopFailure,type ToolLoopDeps} from './toolloop';
import {priorLookups} from './lookup-notes';
export type ReplyInspection=({kind:'accept';content:string}|{kind:'retry';flag:string;code?:string;reason?:string;includeMessage:boolean;note:string;content:string}|{kind:'fail';code:string;reason:string})&{resetCount:number};
export function inspectCoreReply(input:{conversation:ChatMessage[];message:ChatMessage&{content:string};receipts:ToolReceipt[];ran:string[];flags:string[];tools:boolean;theirWords:string;nativeClaimsChecked?:boolean},deps:Pick<ToolLoopDeps,'pageWasRead'|'handsAllowed'|'hasOpenTask'|'canSearch'|'warn'|'log'>):ReplyInspection {
 const {message,receipts,tools}=input;const ran=new Set(input.ran),spent=new Set(input.flags),pushed:ChatMessage[]=[];
 const conversation=[...input.conversation];conversation.push=(...rows:ChatMessage[])=>{pushed.push(...rows);return Array.prototype.push.apply(conversation,rows);};
 const theirWords=input.theirWords;
 const invitedJoke=/^(?:(?:(?:can|could|would) you )?(?:please )?tell me (?:a|another|one more) (?:(?:short|silly|dark) )?joke|(?:please )?(?:make me laugh|roast me|say something funny))(?: please)?[.!? ]*$/i.test(theirWords.trim());
 const explicitlyFictional=invitedJoke||/^\s*(?:write|tell|compose|invent|create)\b[\s\S]{0,160}\b(?:fiction|fictional|imaginary)\b/i.test(theirWords);
 let invalidCallRetried=spent.has('invalidCallRetried'),claimRetried=spent.has('claimRetried'),tickRetried=spent.has('tickRetried'),checkRetried=spent.has('checkRetried'),evidenceRetried=spent.has('evidenceRetried'),lookUpRetried=spent.has('lookUpRetried'),existenceRetried=spent.has('existenceRetried'),voiceRetried=spent.has('voiceRetried');
 let diagnostic:{code:string;message:string}|undefined;
 const checkFailed=(code:string,message:string)=>{diagnostic={code,message};};
 let resetCount=0;const resetStream=()=>{resetCount++;},warn=deps.warn??deps.log??(()=>{});
 const fail=(code:string,reason:string):never=>{throw new ToolLoopFailure(code,reason);};
 const retry=():ReplyInspection=>{
  const flags={invalidCallRetried,claimRetried,tickRetried,checkRetried,evidenceRetried,lookUpRetried,existenceRetried,voiceRetried};
  const changed=Object.entries(flags).filter(([flag,value])=>value&&!spent.has(flag));
  const note=pushed.at(-1);
  if(changed.length!==1||note?.role!=='user'||!note.content)throw Error('reply_inspection_contract');
  return {kind:'retry',flag:changed[0][0],...(diagnostic?{code:diagnostic.code,reason:diagnostic.message}:{}),includeMessage:pushed.some(row=>row===message),note:note.content,content:message.content,resetCount};
 };
 try {
    if (!input.nativeClaimsChecked) {
    if (/^(?:get|run|read|set|create|search|book|vault)_[a-z_]+$/.test(message.content.trim())) {
      if (invalidCallRetried) fail('invalid_tool_call', 'The model returned only a tool name instead of an answer.');
      invalidCallRetried = true;
      checkFailed('invalid_tool_call', 'The model returned only a tool name.');
      resetStream();
      conversation.push({ role: 'user', content: 'A tool name is not an executed operation or an answer. Use an offered tool properly, or plainly say that you cannot perform the check. No operation ran.' });
      return retry();
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
        return retry();
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
      return retry();
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
      return retry();
    }

    }

    // A successful mutation is not evidence that she searched or inspected
    // anything. Repair unsupported checking claims even when search is disabled.
    const readEvidence = new Set(receipts.filter(r => r.outcome === 'succeeded' && (r.access === 'read'
      || r.tool === 'run_command' && typeof r.scope.command === 'string'
        && !/[;&|`$<>\n]/.test(r.scope.command)
        && /^(?:nvidia-smi|journalctl|cat|head|tail|rg|df|du|ps|uptime|free)\b|^systemctl\s+(?:--user\s+)?(?:is-active|status|show)\b/.test(r.scope.command.trim())))
      .map(r => r.tool));
    for (const tool of priorLookups(input.conversation)) readEvidence.add(tool);   // 4530: "I looked it up" about her last few replies
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
      return retry();
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
      return retry();
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
      return retry();
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
      return retry();
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
        return retry();
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
        return retry();
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
      return retry();
    }

    return {kind:'accept',content:message.content!,resetCount};
 }catch(error){if(error instanceof ToolLoopFailure)return {kind:'fail',code:error.code,reason:error.message,resetCount};throw error;}
}
