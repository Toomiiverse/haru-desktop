import {corePolicySync} from './core-policy-sync';
export type CallInputMode = 'open' | 'addressed';

/** Receipt of this admitted phrase is sufficient evidence for an acknowledgement.
 * Never claim speaker identity, acoustic quality, or a healthy microphone.
 * Mixed requests, quotations and context-dependent follow-ups keep the brain path.
 */
export function callMicCheckReply(text: string): string | null {
  return corePolicySync<any>('speech-boundary.callMicCheckReply',[text]);
}

/** An explicit addressing gate, not speaker identification. No open tail window. */
export function addressedText(text: string): string | null {
  return corePolicySync<any>('speech-boundary.addressedText',[text]);
}

export function callInputCommand(text: string): CallInputMode | null {
  return corePolicySync<any>('speech-boundary.callInputCommand',[text]);
}
