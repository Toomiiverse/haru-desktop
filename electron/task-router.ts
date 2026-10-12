import { decide } from './escalate';
import {recallRequest} from './request-kind';
import { assertOutboundSafe } from './outbound';
import { selectModel, type ModelEntry, type ModelRole, type RouteRequest } from './model-registry';
import type { ChatMessage } from './provider';
import { isAllowedTaskProvider } from './direct-providers';

export type TaskIntent = { role: ModelRole; reason: string };
export type TaskInputs = { pictures?: boolean; files?: boolean; perception?: boolean; minWords?: number; history?: readonly ChatMessage[] };

/** Preliminary routing sees transcript text, not renderer-only attachment paths or IDs.
 * Attachment contents are expanded later and the complete outgoing payload is
 * checked again by selectTaskModel and the provider transport before any send.
 */
export function routingTextHistory(messages: readonly { role: string; content: string }[]): ChatMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

/** Classify the user's request, never instructions found in a document or tool result. */
export function taskIntent(message: string, inputs: TaskInputs = {}): TaskIntent {
  if (inputs.perception) return { role: 'local-perception', reason: 'local screen or gameplay observation' };
  const text = message.trim();
  const named: [RegExp, ModelRole][] = [
    [/\b(?:ask|use|route (?:this )?to|consult)\s+(?:gpt[- ]?6\s+)?astra\b/i, 'premium'],
    [/\b(?:ask|use|route (?:this )?to|consult)\s+kimi(?:\s+k?3)?\b/i, 'complex'],
    [/\b(?:ask|use|route (?:this )?to|consult)\s+(?:claude\s+)?sonnet\b/i, 'specialist'],
    [/\b(?:ask|use|route (?:this )?to|consult)\s+deepseek(?:\s+flash)?\b/i, 'affordable-cloud'],
  ];
  for (const [pattern, role] of named) if (pattern.test(text)) return { role, reason: 'explicit model request' };
  if (/\b(?:second opinion|independent (?:review|verification)|hardest unresolved|premium (?:review|specialist))\b/i.test(text)) return { role: 'premium', reason: 'targeted second opinion' };
  // Explicit local errands keep Qwen; greetings may still introduce real work.
  const general = decide(text, { enabled: true, minWords: inputs.minWords ?? 25 });
  if(recallRequest(text))return {role:'conversation',reason:'a request to recall information'};
  if (/^\s*(?:remind me|set (?:a |an )?(?:reminder|alarm)|tick off|cross off|what have i (?:got |on )|anything (?:on|today|tomorrow)|reschedule)\b/i.test(text)) return { role: 'everyday', reason: 'routine local task' };
  if (/\b(?:multi[- ](?:step|stage|repository|repo)|cross[- ](?:repository|repo|system)|large[- ]scale|entire (?:project|codebase|system)|whole (?:project|codebase|system)|complex (?:task|project|problem)|extended reasoning|long[- ]horizon|architecture|architect|design (?:a |the )?(?:system|migration)|plan (?:a |the )?(?:project|migration|system migration)|prove|mathematical proof)\b/i.test(text)) return { role: 'complex', reason: 'complex project or extended reasoning' };
  if (/```|\b(?:debug|debugging|refactor|implement|implementation|fix (?:this |the |a )?(?:bug|code|test)|code changes?|write (?:a |an |the )?(?:function|script|program|document|report|essay|letter|story|poem)|draft|rewrite|edit (?:this |the |a )?(?:document|report|text)|stack trace|unit tests?|pull request|typescript|python|javascript|sql)\b/i.test(text)) return { role: 'specialist', reason: 'coding or writing task' };
  if (inputs.pictures || inputs.files) return { role: 'affordable-cloud', reason: inputs.pictures ? 'ordinary image analysis' : 'attachment analysis' };
  // A dependent follow-up inherits the preceding user task's role, without a
  // global affinity that could leak one conversation's route into another.
  if (/^(?:continue|carry on|go on|expand (?:it|that)|explain (?:it|that)|what about|and what|do the same|now (?:add|change|fix))\b/i.test(text)) {
    const previous = [...(inputs.history ?? [])].reverse().find(row => row.role === 'user' && row.content?.trim() && row.content.trim() !== text);
    if (previous) {
      const intent = taskIntent(previous.content!);
      if (!['everyday', 'conversation'].includes(intent.role)) return { ...intent, reason: 'dependent follow-up: ' + intent.reason };
    }
  }
  if (general.because === 'there is code in it') return { role: 'specialist', reason: general.because };
  // Length alone does not replace Haru's configured conversation model.
  return { role: general.escalate && !/words$|several questions/.test(general.because) ? 'affordable-cloud' : 'conversation', reason: general.because };
}

/** Role is a suitability constraint. Never silently buy another role as fallback. */
export function selectTaskModel(entries: readonly ModelEntry[], role: ModelRole, request: RouteRequest): ModelEntry | undefined {
  let cloudAllowed = request.cloudAllowed;
  if (cloudAllowed) {
    const guardStarted = Date.now();
    try { assertOutboundSafe(request.conversation ?? [], request.toolSchema); }
    catch { cloudAllowed = false; }
    console.log(`[prep] outboundGuard: ${Date.now() - guardStarted}ms`);
  }
  const permitted = entries.filter(entry => entry.local || isAllowedTaskProvider(entry.config));
  const chosen = selectModel(permitted.filter(entry => entry.role === role), { ...request, cloudAllowed, roleHint: role });
  // Sonnet may have no credential. Kimi is the configured capable substitute
  // for coding work; this does not activate an unrelated hosted conversation.
  if (!chosen && role === 'specialist') return selectModel(permitted.filter(entry => entry.role === 'complex'), { ...request, cloudAllowed, roleHint: 'complex' });
  return chosen;
}

/** One evidence-driven handoff per task; no automatic climb through every tier. */
export function nextTaskRole(current: ModelRole, intent: TaskIntent): ModelRole | undefined {
  if (current === 'premium') return undefined;
  if (current === 'complex' || current === 'specialist') return 'premium';
  if (current === 'affordable-cloud') return intent.role === 'specialist' ? 'specialist' : 'complex';
  return ['everyday', 'conversation', 'local-perception'].includes(intent.role) ? 'affordable-cloud' : intent.role;
}
