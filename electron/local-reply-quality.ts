import {localReplyOwned,localReplyDecision,localReplyChecked,coreComposeLocalReply} from './core-local-reply';
import type { ChatMessage } from './provider';
import { conversationCharacter, CURRENT_CONVERSATION_RULES } from './conversation-contract';

export type ReplyCharacter = { identity: string; style: string };

/** Preserve every character note while keeping evidence and permissions in
 * charge of factual claims. Only final local composition uses this wrapper. */
export function withReplyCharacter(turns: ChatMessage[], character: ReplyCharacter): ChatMessage[] {
  if(localReplyOwned())return localReplyChecked('local-reply-quality.withReplyCharacter',[turns,character]);
  if (turns[0]?.role !== 'system') throw new Error('Grounded reply instructions are missing.');
  return [{ ...turns[0], content: [conversationCharacter(character), turns[0].content,
    CURRENT_CONVERSATION_RULES,
    'Apply a leading privacy instruction silently, then answer the request that follows. A privacy acknowledgement alone does not answer a feeling report or question. Respond substantively when asked for gentler wording; a bare "Fine" does not provide it. Keep the configured style, including its restrictions on support-staff sign-offs.',
  ].join('\n\n') }, ...turns.slice(1)];
}

/** Narrow observed failure patterns, not a general semantic quality score.
 * Fiction and requested quotations must not be mistaken for factual claims. */
export function localReplyIssue(kind: unknown, reply: string, latest: string): string | undefined {
  if(localReplyOwned())return localReplyDecision<string|null>('local-reply-quality.localReplyIssue',[kind,reply,latest])??undefined;
  if (kind === 'fiction') return;
  const plain = reply.replace(/\[[a-z]+\]/gi, '').trim();
  if (kind === 'unknown' && plain.split(/(?<=[.!?])\s+/).some(sentence =>
    /\byou (?:haven['’]t|have not|never|didn['’]t|did not) (?:ever )?(?:told|tell|mentioned|mention|shared|share)\b/i.test(sentence)
    && !/\b(?:in this (?:chat|conversation|excerpt)|in the (?:provided|supplied) (?:notes|history|context)|here)\b/i.test(sentence))) {
    return 'Missing retrieved evidence does not prove the user never told you. State only what you cannot recall or verify from the available context.';
  }
  if (/\b(?:gentl|softer|soften|harsh)/i.test(latest)
    && /^(?:fine|okay|ok|sure|got it|understood)[.!]?$/i.test(plain)) {
    return 'Answer the request for gentler wording with a substantive, gentle acknowledgement or rephrasing; do not return a bare compliance word.';
  }
  if (/(?:^|[.!?]\s*)let me know (?:if (?:you|there)\b[^.!?]*|what you need|how i can help|when you need[^.!?]*)[.!]?$/i.test(plain)
    && !/\blet me know\b/i.test(latest)) {
    return 'The configured style disallows support-staff sign-offs. Give the actual answer in Haru’s voice and stop without a closing offer.';
  }
  const afterPrivacy=latest.replace(/^\s*keep this local[.!:]\s*/i,'').trim();
  if (afterPrivacy && afterPrivacy !== latest.trim()
    && /^(?:(?:okay|ok|got it|understood)[.,!]?\s*)?(?:i['’]ll|i will|we['’]ll|we will|let['’]s) keep (?:this|it|everything) (?:local|between us)[.!]?$/i.test(plain)) {
    return 'Respect privacy silently and answer the actual request after the privacy directive.';
  }
}
