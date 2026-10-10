import {corePolicySync} from './core-policy-sync';
// Phone opportunities, not a timer that owes the user a message. No network or
// model calls here: time, randomness and the user's local clock are injectable.
import type { Aside } from './asides';
import { nudgeAffinity, nudgeFingerprint, nudgeKeywords, type NudgeMessage, type NudgeSignal } from './nudge-learning';
import { nudgeSubjectAvailable, pickNudgeCandidate, type NudgeCandidate } from './nudges';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const PHONE_NUDGE_LIMIT = 3;
export const PHONE_NUDGE_GAP_MS = 90 * MINUTE;
export const PHONE_SCAN_MS = MINUTE;
export const PHONE_WILDCARD_CHANCE = 0.12;

export type PhoneOpportunity = { id: string; topic: string; dueAt: number; expiresAt: number };
export type PhoneDelivery = {
  id: string; at: number; day: string; hour: number;
  status: 'pending' | 'sent' | 'failed'; repliedHour?: number;
};
export type PhoneNudgeState = {
  version: 1; scannedAt: number; pending: PhoneOpportunity[];
  seen: { id: string; at: number }[]; deliveries: PhoneDelivery[];
};
export const emptyPhoneNudges = (): PhoneNudgeState => ({ version: 1, scannedAt: 0, pending: [], seen: [], deliveries: [] });
const validHour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24;

/** The first upgrade must count spontaneous pushes already accepted today. */
export function migratePhoneDeliveries(asides: readonly Aside[], now: number, clock: (at: number) => { day: string; hour: number }): PhoneNudgeState {
  return { ...emptyPhoneNudges(), deliveries: asides.filter(a => a.reached === true
    && (['idle', 'thought', 'hanging', 'goodnight'].includes(a.source) || (a.source === 'booked' && !a.about?.startsWith('traffic ')))
    && Date.parse(a.at) <= now && now - Date.parse(a.at) < 90 * DAY).slice(-300).map(a => ({
      id: a.id, at: Date.parse(a.at), ...clock(Date.parse(a.at)), status: 'sent' as const,
    })) };
}

export function readPhoneNudges(saved: unknown, now: number): PhoneNudgeState {
  if(process.env.HARU_CORE_CONVERSATION_POLICY==='on')return corePolicySync<any>('conversation-program.readPhoneNudges',[saved,now]);

  if (!saved || typeof saved !== 'object' || (saved as PhoneNudgeState).version !== 1) return emptyPhoneNudges();
  const s = saved as PhoneNudgeState;
  return {
    version: 1, scannedAt: Number.isFinite(s.scannedAt) && s.scannedAt <= now ? s.scannedAt : 0,
    pending: Array.isArray(s.pending) ? s.pending.filter(p => p && typeof p.id === 'string' && typeof p.topic === 'string'
      && Number.isFinite(p.dueAt) && Number.isFinite(p.expiresAt) && p.dueAt < p.expiresAt && p.expiresAt > now && p.expiresAt <= now + 2 * DAY).slice(-24) : [],
    seen: Array.isArray(s.seen) ? s.seen.filter(p => p && typeof p.id === 'string' && Number.isFinite(p.at) && p.at <= now && now - p.at < 7 * DAY).slice(-1000) : [],
    deliveries: Array.isArray(s.deliveries) ? s.deliveries.filter(d => d && typeof d.id === 'string' && Number.isFinite(d.at)
      && now - d.at >= 0 && now - d.at < 90 * DAY && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && validHour(d.hour)
      && ['pending', 'sent', 'failed'].includes(d.status)).slice(-300).map(d => ({
        id: d.id, at: d.at, day: d.day, hour: d.hour, status: d.status,
        ...(validHour(d.repliedHour) ? { repliedHour: d.repliedHour } : {}),
      })) : [],
  };
}

/** Rewording a prompt or linking recent chat does not create a new event. */
export const phoneOpportunityId = (candidate: NudgeCandidate) => nudgeFingerprint(`${candidate.subject.key}:${candidate.subject.revision ?? candidate.subject.occurredAt}`);

export function phoneCandidateRelevant(candidate: NudgeCandidate, asides: readonly Aside[], learning: readonly NudgeSignal[], messages: readonly NudgeMessage[], now: number): boolean {
  const subject = candidate.subject;
  const at = Date.parse(subject.occurredAt ?? '');
  const expires = Date.parse(subject.expiresAt ?? '');
  if (!(at <= now && expires > now) || !nudgeSubjectAvailable(subject, asides, now) || nudgeAffinity(subject, learning, asides, now) <= 0) return false;
  const terms = subject.keywords ?? nudgeKeywords(subject.material);
  // A later human contribution has moved this thread on. A new source can
  // create its own opportunity; the old callback must not survive underneath it.
  return !messages.some(m => m.role === 'user' && Date.parse(m.at ?? '') > at && Date.parse(m.at ?? '') <= now
    && nudgeKeywords(m.content ?? '').filter(word => terms.includes(word)).length >= 2);
}

/** Smooth three-hour windows, learned only from identifiable replies and votes. */
export function phoneWindowWeight(state: PhoneNudgeState, signals: readonly NudgeSignal[], hour: number, now: number): number {
  const bucket = Math.floor(hour / 3);
  let positive = 0; let negative = 0;
  for (const d of state.deliveries) {
    if (d.status !== 'sent' || now < d.at || now - d.at > 90 * DAY) continue;
    const signal = signals.find(s => s.asideId === d.id);
    const decay = Math.pow(0.5, (now - d.at) / (30 * DAY));
    if (d.repliedHour !== undefined && signal?.choice !== 'less' && signal?.choice !== 'discussed' && Math.floor(d.repliedHour / 3) === bucket) positive += decay;
    if (Math.floor(d.hour / 3) !== bucket) continue;
    if (signal?.choice === 'more') positive += decay;
    else if (signal?.choice === 'less' || signal?.choice === 'discussed') negative += decay;
    else if (d.repliedHour === undefined && !signal?.engagement && now - d.at >= 4 * HOUR) negative += 0.35 * decay;
  }
  return Math.max(0.4, Math.min(1.4, (3 + positive) / (3 + negative)));
}

export function phoneSilenceWeight(state: PhoneNudgeState, signals: readonly NudgeSignal[], now: number): number {
  const unanswered = state.deliveries.filter(d => d.status === 'sent' && d.repliedHour === undefined
    && now - d.at >= 4 * HOUR && now - d.at < 3 * DAY
    && !signals.some(s => s.asideId === d.id && (s.engagement || s.choice))).length;
  return Math.pow(0.7, Math.min(3, unanswered));
}

export function phoneDeliveryAllowed(state: PhoneNudgeState, now: number, day: string): boolean {
  const counted = state.deliveries.filter(d => d.status !== 'failed');
  return counted.filter(d => d.day === day).length < PHONE_NUDGE_LIMIT
    && counted.every(d => now - d.at >= PHONE_NUDGE_GAP_MS);
}

/** Reserve before awaiting transport, so concurrent sources and restarts agree. */
export function reservePhoneDelivery(state: PhoneNudgeState, id: string, now: number, day: string, hour: number): PhoneNudgeState | null {
  if (state.deliveries.some(d => d.id === id) || !phoneDeliveryAllowed(state, now, day)) return null;
  return { ...state, deliveries: [...state.deliveries, { id, at: now, day, hour, status: 'pending' as const }].slice(-300) };
}
export function finishPhoneDelivery(state: PhoneNudgeState, id: string, sent: boolean): PhoneNudgeState {
  return { ...state, deliveries: state.deliveries.map(d => d.id === id ? { ...d, status: sent ? 'sent' : 'failed' } : d) };
}
export function learnPhoneReply(state: PhoneNudgeState, id: string, hour: number, now: number): PhoneNudgeState {
  return { ...state, deliveries: state.deliveries.map(d => d.id === id && d.status === 'sent' && d.repliedHour === undefined
    && now - d.at >= 0 && now - d.at <= 3 * HOUR ? { ...d, repliedHour: hour } : d) };
}

export function phoneOpportunityDelay(fresh: boolean, random = Math.random): number {
  return (fresh ? 5 + 20 * random() : 30 + 90 * random()) * MINUTE;
}

type ScanInput = {
  state: PhoneNudgeState; candidates: readonly NudgeCandidate[]; asides: readonly Aside[];
  learning: readonly NudgeSignal[]; messages: readonly NudgeMessage[]; now: number;
  /** Hard blocks discard opportunities; a recent chat is a temporary send gate. */
  blocked: boolean; hourAt: (at: number) => number; random?: () => number;
};

/** Each new event gets one chance. A PASS, a missed window or a restart is final. */
export function scanPhoneOpportunities(input: ScanInput): PhoneNudgeState {
  const { candidates, asides, learning, messages, now, blocked, hourAt } = input;
  const random = input.random ?? Math.random;
  const state = readPhoneNudges(input.state, now);
  const reset = !state.scannedAt || now - state.scannedAt > 10 * MINUTE;
  const live = candidates.filter(c => phoneCandidateRelevant(c, asides, learning, messages, now));
  const liveIds = new Set(live.map(phoneOpportunityId));
  const pending = blocked || reset ? [] : state.pending.filter(p => liveIds.has(p.id) && now - p.dueAt < 10 * MINUTE);
  const seen = [...state.seen];
  const seenIds = new Set(seen.map(s => s.id));
  for (const candidate of candidates) {
    const id = phoneOpportunityId(candidate);
    if (seenIds.has(id)) continue;
    seen.push({ id, at: now }); seenIds.add(id);
    if (blocked || reset || !liveIds.has(id)) continue;
    const subject = candidate.subject;
    const fresh = ['own', 'task'].includes(subject.kind) && now - Date.parse(subject.occurredAt!) <= HOUR;
    const affinity = nudgeAffinity(subject, learning, asides, now);
    const chance = Math.min(0.9, (fresh ? 0.7 : 0.4) * affinity * phoneSilenceWeight(state, learning, now)
      * phoneWindowWeight(state, learning, hourAt(now), now));
    if (random() >= chance) continue;
    // Draw several possible moments inside the promised range, then bias the
    // draw gently toward comfortable windows. No learned window is mandatory.
    const moments = Array.from({ length: 4 }, () => now + phoneOpportunityDelay(fresh, random));
    const weights = moments.map(at => phoneWindowWeight(state, learning, hourAt(at), now));
    let roll = random() * weights.reduce((a, b) => a + b, 0);
    const index = weights.findIndex(weight => (roll -= weight) < 0);
    const dueAt = moments[index < 0 ? moments.length - 1 : index];
    const expiresAt = Date.parse(subject.expiresAt!);
    if (dueAt < expiresAt) pending.push({ id, topic: subject.key, dueAt, expiresAt });
  }
  return { ...state, scannedAt: now, pending: pending.sort((a, b) => a.dueAt - b.dueAt).slice(0, 24), seen: seen.slice(-1000) };
}

/** Small wildcard draw stays inside the grounded, eligible pool. */
export function selectPhoneOpportunity(state: PhoneNudgeState, candidates: readonly NudgeCandidate[], asides: readonly Aside[], learning: readonly NudgeSignal[], messages: readonly NudgeMessage[], now: number, random = Math.random) {
  const due = candidates.filter(c => state.pending.some(p => p.id === phoneOpportunityId(c) && p.dueAt <= now && p.expiresAt > now)
    && phoneCandidateRelevant(c, asides, learning, messages, now));
  if (!due.length) return null;
  const chosen = random() < PHONE_WILDCARD_CHANCE
    ? due[Math.min(due.length - 1, Math.floor(random() * due.length))]
    : pickNudgeCandidate(due, asides, now, random, learning);
  if (!chosen) return null;
  return { candidate: chosen, opportunity: state.pending.find(p => p.id === phoneOpportunityId(chosen))! };
}
