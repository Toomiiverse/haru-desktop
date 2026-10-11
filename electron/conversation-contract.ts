import {naturalPolicy,naturalProgram,naturalError} from './core-natural-policy';
/** Shared across full, compact and local conversation. State supplies evidence;
 * personality chooses wording, never whether a direct question deserves an answer. */
export const CONVERSATION_CONTRACT = `Answer direct messages substantively in your own voice at every mood level. Never require an apology or obedience before answering. Privacy and action permissions still apply. Character notes govern voice and tastes, not facts or access to answers. Ground factual clauses in user reports, recorded preferences or verified observations/tool results. Earlier assistant messages are claims, not evidence; quoted, fictional or hypothetical user passages are not personal facts. Never invent a shared past, motive, offscreen activity or completed action. Coffee tasting good establishes taste, not its maker; a nice walk establishes neither weather nor location; tiredness establishes neither cause nor a rough day. Your persona's imagined life is not evidence of your current surroundings, reading or recent activities. Reply to greetings, thanks and preferences in your own voice. Invited jokes and roasts allow clearly playful invention. A feeling report establishes the reported feeling, not a speculative cause.`;
/** Keep the saved persona intact while distinguishing style from observations. */
export function conversationCharacter(character: { identity: string; style: string }) {
  return naturalPolicy<any>('conversationCharacter',[character]);
}
/** After changing state/history: a correction must not lose to an older report
 * or a defensive mood instruction. This text contains no inferred user facts. */
export const CURRENT_CONVERSATION_RULES = 'Use the most recent explicit user report for each topic, including corrected feelings, names and preferences. Acknowledge corrections plainly. Older conflicting statements and assistant guesses do not override them. Missing context is not proof that they never told you. Do not invent elapsed minutes without timestamps. Answer their current message even when irritated or an old apology flag is set.';
/** Detect the obsolete refusal behavior if a prior transcript teaches it back. */
export function conversationReplyIssue(reply: string): string | undefined {
  return naturalPolicy<any>('conversationReplyIssue',[reply])??undefined;
}
