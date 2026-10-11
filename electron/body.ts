const dateFact=(v:unknown):number|null=>{const n=typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(n)?n:null;};
const isoFact=(v:unknown):string|null=>{const n=dateFact(v);return n===null?null:new Date(n).toISOString();};
const bodyDateFacts=(v:any)=>({sleepStart:isoFact(v?.sleepStart),sleepEnd:isoFact(v?.sleepEnd)});
import {corePolicySync} from './core-policy-sync';
// What the phone knows about their body, for her: how they slept last night
// and how far they have walked today. The app reads Apple Health and sends
// one report at a time; she gets one background sentence out of it — enough
// to notice a short night, never a thing to recite. Off until the phone's
// switch says otherwise, and a report older than a day and a half is dropped
// rather than read as today's.

export type BodyReport = {
  /** The day the report is about, YYYY-MM-DD in their timezone. */
  day: string;
  /** Minutes asleep last night, or null when the phone has no record. */
  sleepMinutes: number | null;
  /** When that sleep began and ended (ISO), when known. */
  sleepStart: string | null;
  sleepEnd: string | null;
  /** Steps so far on `day`, or null. */
  steps: number | null;
  /** When the phone sent it, ISO. */
  at: string;
};

export type Body = { enabled: boolean; last: BodyReport | null };

export const DEFAULT_BODY: Body = { enabled: false, last: null };
/** A report older than this says nothing about today. */
export const BODY_STALE_MS = 36 * 3_600_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function minutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 24 * 60 ? Math.round(value) : null;
}
function count(value: unknown, cap: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 0 && value <= cap ? Math.round(value) : null;
}
function iso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** One report from the phone, or null when it is not one. At least one figure is needed. */
export function readBodyReport(body: unknown, now = new Date()): BodyReport | null {
  return corePolicySync('conversation-inputs.bodyReport',[body,now.toISOString(),bodyDateFacts(body)]);
}

export function readBody(saved: unknown): Body {
  return corePolicySync('conversation-inputs.bodyRead',[saved,bodyDateFacts((saved as any)?.last)]);
}

/** What the phone page and the app show under the switch. */
export function bodyForPage(state: Body, nowMs = Date.now()): { enabled: boolean; at: string | null; fresh: boolean; day: string | null; sleepMinutes: number | null; steps: number | null } {
  return corePolicySync('conversation-inputs.bodyPage',[state,nowMs,dateFact(state.last?.at)]);
}

/** "5 h 40 m", "7 h", "45 m". */
export function sleepLength(minutes: number): string {
  return corePolicySync('conversation-inputs.sleepLength',[minutes]);
}

/**
 * The one sentence she gets. `clock` renders an instant in their timezone;
 * `todayKey` is today as YYYY-MM-DD there, so a report from yesterday's
 * steps is not read as today's.
 */
export function describeBody(state: Body, nowMs: number, clock: (ms: number) => string, todayKey: string): string {
  {const p=corePolicySync<any>('conversation-inputs.bodyStart',[state,nowMs,todayKey,{at:dateFact(state.last?.at),sleepStart:dateFact(state.last?.sleepStart),sleepEnd:dateFact(state.last?.sleepEnd)}]);if('result' in p)return p.result;return corePolicySync('conversation-inputs.bodyFinish',[p,p.clock.map((ms:number|null)=>clock(ms===null?NaN:ms))]);}
}
