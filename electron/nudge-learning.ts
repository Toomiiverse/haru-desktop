// Topic preferences are separate from her mood. Feedback never earns a retort.
import { createHash } from 'node:crypto';
import type { Aside, NudgeKind, NudgePreference } from './asides';
import type { NudgeSubject } from './nudges';

const DAY = 86_400_000;
const STOP = new Set('the and that this with from have your you they their them were been what when where which about just like really still there would could should want said told today yesterday think know going doing does more some into then than read reading recorded activity take chapter program thing things something anything actually already'.split(' '));
export function nudgeKeywords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP.has(w)))].slice(0, 18);
}
export const nudgeFingerprint = (text: string) => createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
export const isNudgeAside = (aside: Aside) => Boolean(aside.nudgeTopic) || ['idle', 'thought', 'hanging'].includes(aside.source);
export const validNudgePreference = (choice: unknown): choice is NudgePreference | null => choice === null || ['more', 'less', 'discussed'].includes(choice as string);

export type NudgeSignal = {
  asideId: string; topic: string; terms: string[]; kind?: NudgeKind; at: string;
  choice?: NudgePreference; engagement?: number;
};

export function readNudgeLearning(saved: unknown, now: number): NudgeSignal[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((v): v is NudgeSignal => Boolean(v) && typeof v === 'object'
    && typeof v.asideId === 'string' && typeof v.topic === 'string' && typeof v.at === 'string'
    && now - Date.parse(v.at) >= 0 && now - Date.parse(v.at) < 90 * DAY)
    .map(v => ({ asideId: v.asideId.slice(0, 80), topic: v.topic.slice(0, 300), at: v.at,
      terms: Array.isArray(v.terms) ? v.terms.filter((t): t is string => typeof t === 'string').slice(0, 18) : [],
      ...(v.kind ? { kind: v.kind } : {}),
      ...(v.choice && validNudgePreference(v.choice) ? { choice: v.choice } : {}),
      ...(typeof v.engagement === 'number' ? { engagement: Math.max(0, Math.min(2, v.engagement)) } : {}),
    })).slice(-300);
}

const signalFor = (aside: Aside, now: number): NudgeSignal => ({
  asideId: aside.id, topic: aside.nudgeTopic ?? `legacy:${nudgeFingerprint(aside.text)}`,
  terms: aside.nudgeKeywords ?? nudgeKeywords(aside.text), kind: aside.nudgeKind, at: new Date(now).toISOString(),
});

/** Latest choice wins; repeating or clearing a vote cannot accumulate boosts. */
export function rateNudge(asides: Aside[], learning: NudgeSignal[], id: string, choice: NudgePreference | null, now: number) {
  const target = asides.find(a => a.id === id && isNudgeAside(a));
  if (!target || !validNudgePreference(choice)) return null;
  const aside = { ...target, nudgeFeedback: choice ?? undefined };
  const previous = learning.find(s => s.asideId === id);
  const signal = { ...signalFor(target, now), ...(previous?.engagement ? { engagement: previous.engagement } : {}), ...(choice ? { choice } : {}) };
  return {
    aside, asides: asides.map(a => a.id === id ? aside : a),
    learning: [...learning.filter(s => s.asideId !== id), ...(choice || signal.engagement ? [signal] : [])].slice(-300),
  };
}

export type NudgeMessage = { id?: string; role?: string; content?: string; at?: string; replyTo?: string | { id: string } };
const related = (a: readonly string[], b: readonly string[]) => {
  const overlap = a.filter(t => b.includes(t)).length;
  return overlap >= 2 && overlap / Math.max(1, Math.min(a.length, b.length)) >= 0.4;
};
const discussed = /\b(?:already (?:told|said|discussed|talked)|(?:we|you|i)(?:'ve| have)? (?:already )?(?:discussed|covered) (?:this|that)|(?:you|i) (?:already )?(?:asked|answered) (?:this|that))\b/i;

/** Credit a named reply or an identifiable topic, not every subsequent message. */
export function learnNudgeResponse(asides: Aside[], learning: NudgeSignal[], messages: readonly NudgeMessage[], now: number) {
  const message = messages.at(-1);
  if (message?.role !== 'user' || !message.content?.trim()) return null;
  const named = typeof message.replyTo === 'string' ? message.replyTo : message.replyTo?.id;
  const terms = nudgeKeywords(message.content);
  const preceding = messages.slice(0, -1).filter(m => m.role === 'assistant').at(-1);
  const pool = asides.filter(a => isNudgeAside(a) && (!a.answeredAt || !learning.some(s => s.asideId === a.id && s.engagement !== undefined)) && now - Date.parse(a.at) >= 0)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const target = named ? pool.find(a => a.id === named) : pool.find((a, index) => {
    if (now - Date.parse(a.at) > 3 * 3_600_000) return false;
    const matches = related(terms, a.nudgeKeywords ?? nudgeKeywords(a.text));
    const directCorrection = index === 0 && discussed.test(message.content!)
      && (!preceding || Boolean(preceding.at && Date.parse(preceding.at) < Date.parse(a.at)));
    return matches || directCorrection;
  });
  if (!target) return null;
  const correction = discussed.test(message.content);
  const previous = learning.find(s => s.asideId === target.id);
  const signal: NudgeSignal = { ...signalFor(target, now),
    ...(previous?.choice ? { choice: previous.choice } : {}),
    ...(correction ? { choice: 'discussed' as const } : {}),
    engagement: correction ? 0 : message.content.trim().split(/\s+/).length >= 12 ? 2 : 1,
  };
  return {
    asides: asides.map(a => a.id === target.id ? { ...a, answeredAt: new Date(now).toISOString(), ...(correction ? { nudgeFeedback: 'discussed' as const } : {}) } : a),
    learning: [...learning.filter(s => s.asideId !== target.id), signal].slice(-300),
  };
}

/** Explicit feedback outweighs inferred engagement; silence is a small topic penalty. */
export function nudgeAffinity(subject: NudgeSubject, signals: readonly NudgeSignal[], asides: readonly Aside[], now: number): number {
  const terms = subject.keywords ?? nudgeKeywords(subject.material);
  let score = 1;
  for (const signal of signals) {
    const age = now - Date.parse(signal.at);
    if (age < 0 || age >= 90 * DAY) continue;
    const same = signal.topic === subject.key || related(signal.terms, terms);
    if (!same) continue;
    const developed = subject.development && Date.parse(subject.development.at) > Date.parse(signal.at);
    if (signal.choice === 'discussed' && age < 30 * DAY && !developed) return 0;
    if (signal.choice === 'less' && age < 2 * DAY) return 0;
    if (signal.choice === 'less') score *= 0.3;
    else if (signal.choice === 'more') score *= 1.8;
    else if (!signal.choice && signal.engagement) score *= signal.engagement === 2 ? 1.35 : 1.1;
  }
  const unanswered = asides.filter(a => isNudgeAside(a) && a.nudgeTopic === subject.key && a.reached !== false
    && !a.answeredAt && !a.nudgeFeedback && now - Date.parse(a.at) >= 4 * 3_600_000 && now - Date.parse(a.at) < 7 * DAY).length;
  return Math.max(0.1, Math.min(3, score * Math.pow(0.6, Math.min(3, unanswered))));
}
