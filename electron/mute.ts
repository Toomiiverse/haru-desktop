import {corePolicySync} from './core-policy-sync';
// Being asked to be quiet.
//
// Her voice on the phone is hers. He can ask her to go quiet; whether she does
// is up to her, and it turns on how she feels about him right now — her patience,
// the grudge underneath it, her vitals — and on whether he bothered to say why.
// "Shush" on its own is rude and lands as rude. "Mute please, there's others
// around" is a reason, and on a good day she takes it.
//
// Nothing here calls a model. The ask is read off his words, the decision is
// arithmetic on state she already has, and what comes out is a note for the
// turn: which way she went and why. The line itself is hers to write.
//
// There is no switch in the app that overrides her (his call, 2026-09-19). The
// phone has a volume button.

import type { Vitals } from './vitals';
import { IRRITATION, IRRITATION_MAX } from './mood';
import { GRUDGE_MAX } from './grudge';

export type MuteReason = { what: 'company' | 'meeting' | 'sleeping' | 'working' | 'other'; said: string; minutes: number };
export type MuteAsk = { kind: 'mute' | 'unmute'; reason: MuteReason | null; polite: boolean };

const QUIET = /\b(mute( yourself)?|be quiet|quiet(en)? down|shush|shh+|shut up|shut it|stop talking|zip it|hush|go (silent|quiet)|silent mode|keep it down|voice off|turn (your )?voice off)\b/i;
/** "I muted the TV", "mute the group chat": about something else. */
const NOT_HER = /\bmuted?\s+(the|my|his|her|their|that|this|it|him|them|discord|teams|zoom|notifications?)\b|\b(he|she|they)\s+(told|said|asked)\b/i;
const UNMUTE = /\b(un-?mute|you can (talk|speak)( out loud)?( again| now)?|(talk|speak) (out loud )?again|voice (back )?on|turn (your )?voice (back )?on|stop being quiet)\b/i;
const POLITE = /\b(please|pls|plz|sorry|if you don'?t mind|would you mind|do you mind)\b/i;

const COMPANY = /\b((others?|other people|people|someone|somebody|everyone|guests?|customers?|a customer|staff|mum|mom|dad|family|my (boss|partner|girlfriend|mate|friend)s?)\s+(are |is |'s |'re )?(around|here|over|nearby|listening|about|in the room|can hear)|in public|on the (bus|train|tram)|at the (shop|library|office|cinema|movies|doctor'?s?|hospital)|not alone|got company|have company)\b/i;
const MEETING = /\b(meeting|on a call|on the phone|taking a call|interview|appointment|in class|lecture|exam|church|funeral)\b/i;
const SLEEPING = /\b(sleeping|asleep|in bed|trying to sleep|baby|everyone'?s? in bed)\b/i;
const WORKING = /\b(trying to|need to|have to|gotta)\s+(focus|concentrate|work|study|think|read|listen)\b|\b(headache|migraine)\b/i;
const BECAUSE = /\b(because|cause|cos|coz|since|so that|as i'?m|i'?m at|i'?m in|i'?m with)\b/i;

/** "for an hour", "for 20 minutes", "for half an hour" — his own figure beats the guess. */
function saidMinutes(text: string): number | null {
  const match = /\bfor\s+(?:(half an|an|a|one|two|three|\d{1,3})\s+)?(hours?|hrs?|minutes?|mins?)\b/i.exec(text);
  if (!match) return null;
  const word = (match[1] ?? 'a').toLowerCase();
  const count = word === 'half an' ? 0.5 : word === 'two' ? 2 : word === 'three' ? 3 : /^\d+$/.test(word) ? Number(word) : 1;
  const minutes = /^h/i.test(match[2]) ? count * 60 : count;
  return Math.max(5, Math.min(12 * 60, Math.round(minutes)));
}

/**
 * Whether this message asks her to go quiet, or says she may talk again.
 *
 * Short messages only: "be quiet" in the middle of a story about his day is the
 * story. Unmute is checked first, since "unmute" contains "mute".
 */
export function readMuteAsk(text: string): MuteAsk | null {
  return corePolicySync<any>('conversation-policy.readMuteAsk',[text]);
}

export type Feeling = { irritation: number; grudge: number; vitals: Pick<Vitals, 'happiness' | 'affection' | 'stress'>;
  /** feelings.ts, 0–100: being hurt or left alone makes her less obliging. */
  hurt?: number; missing?: number;
  /** How hemmed in she is: being told what to do is what empties it, and her own hours refill it. */
  hemmed?: number;
  /** Which way the day she is having pushes it (dice.ts muteLean). */
  lean?: number };
export type MuteDecision = { agreed: boolean; why: string; minutes: number; score: number };

/**
 * Her answer. Above zero she goes quiet.
 *
 * Scaled so that a reason, said politely, carries an ordinary day and loses on
 * a bad one; and a bare "shush" loses on an ordinary day and only gets through
 * when she is in a very good mood with nothing held against him. The roll is a
 * little weather on top, so the same day does not always give the same answer.
 */
export function weighMute(ask: MuteAsk, feeling: Feeling, roll = Math.random()): MuteDecision {
  return corePolicySync<any>('conversation-policy.weighMute',[ask,feeling,roll]);
}

export type MuteState = { since: number; until: number; reason: string };

/** Whether her voice is off on the phone right now. */
export function isMuted(state: MuteState | null | undefined, now: number): boolean {
  return corePolicySync<any>('conversation-policy.isMuted',[state??null,now]);
}

/**
 * Whether she has had enough of being quiet. Time running out is one way; the
 * other is her temper — wind her up while she is muted and she stops doing him
 * the favour.
 */
export function breaksMute(state: MuteState | null | undefined, now: number, irritation: number): 'time' | 'temper' | null {
  return corePolicySync<any>('conversation-policy.breaksMute',[state??null,now,irritation]);
}

function span(minutes: number): string {
  if (minutes < 50) return `${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const hours = Math.round(minutes / 30) / 2;
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

const SITUATION: Record<MuteReason['what'], string> = {
  company: 'there are other people around him',
  meeting: 'he is somewhere he cannot have you talking',
  sleeping: 'people are asleep near him',
  working: 'he needs to concentrate',
  other: 'he gave a reason',
};

/** What she is told about her own decision, just before his message. */
export function muteNote(ask: MuteAsk, decision: MuteDecision): string {
  return corePolicySync<any>('conversation-policy.muteNote',[ask,decision]);
}

export function unmuteNote(wasMuted: boolean): string {
  return corePolicySync<any>('conversation-policy.unmuteNote',[wasMuted]);
}

export function brokeMuteNote(state: MuteState, now: number, how: 'time' | 'temper'): string {
  return corePolicySync<any>('conversation-policy.brokeMuteNote',[state,now,how]);
}
