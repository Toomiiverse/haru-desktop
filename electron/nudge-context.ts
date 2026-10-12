import type { Aside, NudgeTone } from './asides';
import { nudgeFingerprint, nudgeKeywords, type NudgeMessage } from './nudge-learning';
import { taskTopic, type NudgeCandidate, type NudgeSubject } from './nudges';

const HOUR = 3_600_000;
export const TASK_NUDGE_FRESH_MS = 8 * HOUR;
export const RELATIONSHIP_NUDGE_GAP_MS = 3 * 24 * HOUR;
const fresh = (at: string | undefined, now: number, within: number) => Boolean(at && now - Date.parse(at) >= 0 && now - Date.parse(at) < within);

/** A stated activity gets one working day's relevance, not a permanent clock. */
export function taskNudgeCandidates(items: readonly { id: string; kind: string; title: string; done?: boolean; underway?: string; completedAt?: string }[], now: number, completionWindow: number): NudgeCandidate[] {
  return items.filter(item => item.kind === 'task' && (item.done ? fresh(item.completedAt, now, completionWindow) : fresh(item.underway, now, TASK_NUDGE_FRESH_MS)))
    .sort((a, b) => Date.parse(b.done ? b.completedAt! : b.underway!) - Date.parse(a.done ? a.completedAt! : a.underway!))
    .map(item => ({ weight: 1, priority: 1, subject: {
      key: taskTopic(item), kind: 'task' as const, keywords: nudgeKeywords(item.title),
      revision: nudgeFingerprint(`${item.title}:${item.done ? item.completedAt : item.underway}`),
      occurredAt: item.done ? item.completedAt : item.underway,
      expiresAt: new Date(Date.parse(item.done ? item.completedAt! : item.underway!) + (item.done ? completionWindow : TASK_NUDGE_FRESH_MS)).toISOString(),
      material: item.done ? `At ${item.completedAt} they completed ${JSON.stringify(item.title)}.`
        : `At ${item.underway} they said they were starting ${JSON.stringify(item.title)}. It has not been marked done; their current activity and progress are unknown.`,
      instruction: item.done ? 'Acknowledge the completed work with a specific observation, grudging praise or one genuine question. Do not invent how it went.'
        : 'Ask once about this recent activity, without assuming they are still doing it, behind schedule, or avoiding it.',
    } }));
}

function recentHuman(messages: readonly NudgeMessage[], now: number) {
  return messages.filter(m => m.role === 'user' && m.content?.trim() && fresh(m.at, now, 36 * HOUR))
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!)).slice(-12);
}

/** His own dated words supply a callback; questions/corrections are not topic fodder. */
export function conversationNudgeCandidates(messages: readonly NudgeMessage[], now: number): NudgeCandidate[] {
  const seen = new Set<string>();
  return recentHuman(messages, now).reverse().flatMap(message => {
    const text = message.content!.trim();
    if (text.length < 30 || text.endsWith('?') || /\b(?:already told you|stop (?:asking|messaging|nudging)|(?:don't|do not) (?:ask|message|nudge)|your (?:nudges|notifications|prompt)|haru)\b/i.test(text)) return [];
    const keywords = nudgeKeywords(text);
    if (keywords.length < 3) return [];
    const key = `thread:${nudgeFingerprint([...keywords].sort().slice(0, 8).join(' '))}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ weight: 1.4 + (1 - (now - Date.parse(message.at!)) / (36 * HOUR)), subject: {
      key, kind: 'callback' as const, keywords, revision: nudgeFingerprint(text),
      occurredAt: message.at, expiresAt: new Date(Date.parse(message.at!) + 12 * HOUR).toISOString(),
      material: `Their own words at ${message.at}: ${JSON.stringify(text.slice(0, 900))}`,
      instruction: 'Pick up one concrete thread from what they told you. Offer a specific observation, playful challenge or an informed question. Their words describe that moment; do not assume progress, continued activity, or a promise since. If it was already settled in the conversation, PASS.',
    } }];
  }).slice(0, 4);
}

/** Link an available subject to an actual recent conversation when terms match. */
export function connectNudgeCandidates(candidates: readonly NudgeCandidate[], messages: readonly NudgeMessage[], now: number): NudgeCandidate[] {
  const recent = recentHuman(messages, now).reverse();
  return candidates.map(candidate => {
    if (candidate.subject.kind === 'callback') return candidate;
    const terms = candidate.subject.keywords ?? nudgeKeywords(candidate.subject.material);
    const linked = recent.find(m => nudgeKeywords(m.content!).filter(word => terms.includes(word)).length >= 2);
    return linked ? { ...candidate, weight: candidate.weight * 1.5, subject: { ...candidate.subject,
      material: `${candidate.subject.material}\nRelated words from him at ${linked.at}: ${JSON.stringify(linked.content!.slice(0, 450))}`,
    } } : candidate;
  });
}

const TONES: Record<NudgeTone, string> = {
  amused: 'Use dry amusement: notice the funny or absurd part of the actual subject. Keep the teasing specific.',
  curious: 'Let genuine curiosity lead. Sound interested and incisive, without turning the question into an accusation.',
  opinionated: 'Give a definite opinion in your voice. Specific approval is as valid as criticism; preserve your recorded stance.',
  approving: 'For this message, recognise that they got it done. Give one grudging compliment with dry wit and let the success stand. Do not turn it into an interrogation, undermine it with an invented flaw, or demand another update.',
  challenging: 'Offer a small playful challenge to an idea or choice in the material. Challenge the idea without inventing laziness or incompetence.',
};
export function chooseNudgeDelivery(subject: NudgeSubject, asides: readonly Aside[], now: number, random = Math.random): { tone: NudgeTone; instruction: string } {
  const success = subject.material.split(/[.!?\n]/).some(clause => /\b(?:completed|finished|fixed|passed|succeeded|got .{0,45} working)\b/i.test(clause)
    && !/\b(?:not|never|haven['’]t|hasn['’]t|didn['’]t|failed)\b/i.test(clause));
  const choices: NudgeTone[] = subject.kind === 'own' ? ['amused', 'opinionated'] : ['amused', 'curious', 'opinionated', 'challenging'];
  if (success && subject.kind !== 'own') choices.push('approving');
  const recent = asides.filter(a => fresh(a.at, now, 24 * HOUR) && a.nudgeTone).slice(-2).map(a => a.nudgeTone);
  const pool = choices.filter(tone => !recent.includes(tone));
  const available = pool.length ? pool : choices;
  const tone = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  return { tone, instruction: TONES[tone] };
}

/** Rare follow-up only to an actual offer to tell/show her something, never silence alone. */
export function relationshipNudgeCandidate(messages: readonly NudgeMessage[], now: number, lastAttemptAt?: string): NudgeCandidate | null {
  if (fresh(lastAttemptAt, now, RELATIONSHIP_NUDGE_GAP_MS)) return null;
  const theirs = recentHuman(messages, now);
  const last = theirs.at(-1);
  if (!last || now - Date.parse(last.at!) < 12 * HOUR) return null;
  if (!/\bi(?:'ll| will) (?:tell you|let you know|show you|send you)\b/i.test(last.content!)) return null;
  // A dated promise may still be in the future. Leave it to the task/reminder system.
  if (/\b(?:tomorrow|tonight|next|week|weekend|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at \d|in \d)\b/i.test(last.content!)) return null;
  return { weight: 1, subject: {
    key: `followup:${nudgeFingerprint(last.content!)}`, kind: 'checkin', keywords: nudgeKeywords(last.content!),
    revision: nudgeFingerprint(last.content!), occurredAt: last.at,
    expiresAt: new Date(Date.parse(last.at!) + 36 * HOUR).toISOString(),
    material: `They said at ${last.at}: ${JSON.stringify(last.content!.slice(0, 600))}. No later message from them is recorded.`,
    instruction: 'Ask once whether there is an update on this specific thing they offered to share. Be curious with a little bite, without blame, a deadline, an unanswered-message count or a demand. They may have changed their mind. PASS if there is no clear subject.',
  } };
}
