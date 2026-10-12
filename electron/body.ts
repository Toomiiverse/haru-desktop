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
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.bodyReport',[body,now.toISOString(),bodyDateFacts(body)]);

  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.day !== 'string' || !DAY.test(record.day)) return null;
  const sleepMinutes = minutes(record.sleepMinutes);
  const steps = count(record.steps, 200_000);
  if (sleepMinutes === null && steps === null) return null;
  return {
    day: record.day,
    sleepMinutes,
    sleepStart: sleepMinutes === null ? null : iso(record.sleepStart),
    sleepEnd: sleepMinutes === null ? null : iso(record.sleepEnd),
    steps,
    at: now.toISOString(),
  };
}

export function readBody(saved: unknown): Body {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.bodyRead',[saved,bodyDateFacts((saved as any)?.last)]);

  if (!saved || typeof saved !== 'object') return { ...DEFAULT_BODY };
  const record = saved as Record<string, unknown>;
  const last = record.last && typeof record.last === 'object' ? (record.last as Record<string, unknown>) : null;
  const report = last && typeof last.day === 'string' && DAY.test(last.day) && typeof last.at === 'string'
    ? {
        day: last.day,
        sleepMinutes: minutes(last.sleepMinutes),
        sleepStart: iso(last.sleepStart),
        sleepEnd: iso(last.sleepEnd),
        steps: count(last.steps, 200_000),
        at: last.at,
      }
    : null;
  return { enabled: record.enabled === true, last: report };
}

/** What the phone page and the app show under the switch. */
export function bodyForPage(state: Body, nowMs = Date.now()): { enabled: boolean; at: string | null; fresh: boolean; day: string | null; sleepMinutes: number | null; steps: number | null } {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.bodyPage',[state,nowMs,dateFact(state.last?.at)]);

  const last = state.last;
  const fresh = !!last && nowMs - Date.parse(last.at) <= BODY_STALE_MS;
  return { enabled: state.enabled, at: last?.at ?? null, fresh, day: last?.day ?? null, sleepMinutes: last?.sleepMinutes ?? null, steps: last?.steps ?? null };
}

/** "5 h 40 m", "7 h", "45 m". */
export function sleepLength(minutes: number): string {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on')return corePolicySync('conversation-inputs.sleepLength',[minutes]);

  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/**
 * The one sentence she gets. `clock` renders an instant in their timezone;
 * `todayKey` is today as YYYY-MM-DD there, so a report from yesterday's
 * steps is not read as today's.
 */
export function describeBody(state: Body, nowMs: number, clock: (ms: number) => string, todayKey: string): string {
  if(process.env.HARU_CORE_STARTUP_CONTEXT==='on'){const p=corePolicySync<any>('conversation-inputs.bodyStart',[state,nowMs,todayKey,{at:dateFact(state.last?.at),sleepStart:dateFact(state.last?.sleepStart),sleepEnd:dateFact(state.last?.sleepEnd)}]);if('result' in p)return p.result;return corePolicySync('conversation-inputs.bodyFinish',[p,p.clock.map((ms:number|null)=>clock(ms===null?NaN:ms))]);}

  if (!state.enabled || !state.last) return '';
  const report = state.last;
  const age = nowMs - Date.parse(report.at);
  if (!Number.isFinite(age) || age < 0 || age > BODY_STALE_MS) return '';
  const parts: string[] = [];
  if (report.sleepMinutes !== null) {
    const span = report.sleepStart && report.sleepEnd ? ` (${clock(Date.parse(report.sleepStart))} to ${clock(Date.parse(report.sleepEnd))})` : '';
    const verdict = report.sleepMinutes < 5 * 60 ? ', a short night' : report.sleepMinutes < 6.5 * 60 ? ', on the short side' : report.sleepMinutes > 9.5 * 60 ? ', a long one' : '';
    parts.push(`slept ${sleepLength(report.sleepMinutes)} last night${span}${verdict}`);
  }
  if (report.steps !== null) {
    const steps = report.steps.toLocaleString('en-AU');
    parts.push(report.day === todayKey ? `have walked ${steps} steps so far today` : `walked ${steps} steps yesterday`);
  }
  if (!parts.length) return '';
  return `Their phone says they ${parts.join(' and ')}. That is background she may notice if it fits, never a thing to read out.`;
}
