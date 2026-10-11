import {corePolicySync} from './core-policy-sync';
/** Bind an explicit old-memory selector to the user's words, before any write.
 * The model may paraphrase a unique target; it may not resolve an ambiguous one
 * by adding details that the user never selected. Other wording retains the
 * existing unique-target lookup, rather than introducing a guessed parser.
 */
export function replacementAuthorized<T extends { id: string }>(proposed: T | null, message: string, find: (hint: string) => T | null): boolean {
  if((true as boolean)){const selectors=corePolicySync<string[]>('memory-tools.selectors',[message]);return corePolicySync('memory-tools.authorize',[proposed,message,selectors.map(selector=>find(selector))]);}
  if (!proposed) return false;
  const selectors = [...message.matchAll(/\b(?:instead\s+of|replace|supersede)\s+([^.!?\n;]+?)(?=\s+with\b|[.!?\n;]|$)/gi)]
    .map(match => match[1].trim().replace(/^(?:the|my|a|an)\s+/i, '').replace(/\s+(?:memory|record|note)\s*$/i, '').replace(/^["'“]|["'”]$/g, '').trim());
  return selectors.every(selector => !!selector && find(selector)?.id === proposed.id);
}
