import {corePolicySync} from './core-policy-sync';
export type CallInputMode = 'open' | 'addressed';

/** Receipt of this admitted phrase is sufficient evidence for an acknowledgement.
 * Never claim speaker identity, acoustic quality, or a healthy microphone.
 * Mixed requests, quotations and context-dependent follow-ups keep the brain path.
 */
export function callMicCheckReply(text: string): string | null {
  if((true as boolean))return corePolicySync<any>('speech-boundary.callMicCheckReply',[text]);
  if (text.length > 120 || /["“”`<>:;\n\r]/.test(text)) return null;
  const clean = text.normalize('NFKC').toLowerCase().replace(/[.,!?]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:hey )?haru /, '');
  const check = /^(?:mic(?:rophone)? check|(?:this is )?a mic(?:rophone)? test|can you hear (?:me|my voice)(?: now)?|is (?:my|the) (?:mic|microphone) working)$/.test(clean);
  const counting = /^(?:testing|test)(?: (?:testing|test|one|two|three|1|2|3)){0,11}$/.test(clean);
  return check || counting ? 'Your words came through.' : null;
}

/** An explicit addressing gate, not speaker identification. No open tail window. */
export function addressedText(text: string): string | null {
  if((true as boolean))return corePolicySync<any>('speech-boundary.addressedText',[text]);
  const match = /^\s*(?:hey[\s,]+)?haru\b[\s,:.!?—-]*([\s\S]*)$/i.exec(text);
  return match ? match[1].trim() : null;
}

export function callInputCommand(text: string): CallInputMode | null {
  if((true as boolean))return corePolicySync<any>('speech-boundary.callInputCommand',[text]);
  const addressed = addressedText(text);
  if (addressed === null) return null;
  const words = addressed.toLowerCase().replace(/[.!?,]/g, '').trim();
  if (words === 'noisy room mode') return 'addressed';
  if (words === 'hands free mode' || words === 'hands-free mode') return 'open';
  return null;
}
