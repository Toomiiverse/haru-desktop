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
  const said = (text ?? '').trim();
  if (!said || said.split(/\s+/).length > 30) return null;
  if (UNMUTE.test(said)) return { kind: 'unmute', reason: null, polite: POLITE.test(said) };
  if (!QUIET.test(said) || NOT_HER.test(said)) return null;
  const given = saidMinutes(said);
  const kind: [RegExp, MuteReason['what'], number][] = [[SLEEPING, 'sleeping', 8 * 60], [MEETING, 'meeting', 60], [COMPANY, 'company', 90], [WORKING, 'working', 60], [BECAUSE, 'other', 60]];
  const found = kind.find(([pattern]) => pattern.test(said));
  const reason: MuteReason | null = found
    ? { what: found[1], said: (found[0].exec(said)?.[0] ?? '').trim(), minutes: given ?? found[2] }
    : given ? { what: 'other', said: `for ${given} minutes`, minutes: given } : null;
  return { kind: 'mute', reason, polite: POLITE.test(said) };
}

export type Feeling = { irritation: number; grudge: number; vitals: Pick<Vitals, 'happiness' | 'affection' | 'stress'>;
  /** feelings.ts, 0–100: being hurt or left alone makes her less obliging. */
  hurt?: number; missing?: number;
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
  const temper = Math.min(1, feeling.irritation / IRRITATION_MAX);
  const held = Math.min(1, feeling.grudge / GRUDGE_MAX);
  const mood = (feeling.vitals.happiness - 0.5) * 2 + (feeling.vitals.affection - 0.5) * 1.5 - feeling.vitals.stress * 0.5;
  const stung = Math.min(1, (feeling.hurt ?? 0) / 100);
  const leftAlone = Math.min(1, (feeling.missing ?? 0) / 100);
  const score = mood - temper * 2 - held * 1.5 - stung * 1.2 - leftAlone * 0.8
    + (ask.reason ? 1.5 : -1) + (ask.polite ? 0.5 : 0)
    + (feeling.lean ?? 0)
    // Twice the weather it had (±0.4): the same day does not always give the same answer.
    + (roll - 0.5) * 1.6;
  const agreed = score > 0;
  // The strongest thing on the winning side is the reason she gives herself.
  const why = agreed
    ? (mood > 0.8 ? 'you are in a good mood today and feel like being nice about it'
      : ask.reason ? 'he gave you a reason and it is a fair one'
      : 'you cannot be bothered arguing about it')
    : (leftAlone > 0.6 && leftAlone >= held ? 'he has barely spoken to you all day and now the first thing he wants is for you to be quiet'
      : stung > 0.5 ? 'he hurt you recently and you are not inclined to do him favours'
      : held >= temper && held > 0.4 ? 'you are still holding how little he has bothered with you lately against him'
      : temper > 0.4 ? 'he has been getting on your nerves and you are in no mood to do him favours'
      : !ask.reason ? 'he ordered you to be quiet without so much as a reason, which is rude'
      : 'you do not feel like it today');
  // How long she will hold it: his situation, stretched when she is generous
  // and cut short when she only just agreed.
  const patience = Math.max(0.4, Math.min(1.2, 0.5 + score / 3));
  const minutes = agreed ? Math.round((ask.reason?.minutes ?? 30) * patience) : 0;
  return { agreed, why, minutes, score: Math.round(score * 100) / 100 };
}

export type MuteState = { since: number; until: number; reason: string };

/** Whether her voice is off on the phone right now. */
export function isMuted(state: MuteState | null | undefined, now: number): boolean {
  return Boolean(state && now < state.until);
}

/**
 * Whether she has had enough of being quiet. Time running out is one way; the
 * other is her temper — wind her up while she is muted and she stops doing him
 * the favour.
 */
export function breaksMute(state: MuteState | null | undefined, now: number, irritation: number): 'time' | 'temper' | null {
  if (!state) return null;
  if (now >= state.until) return 'time';
  if (irritation >= IRRITATION.seething) return 'temper';
  return null;
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
  const situation = ask.reason ? ` because ${SITUATION[ask.reason.what]}${ask.reason.said ? ` ("${ask.reason.said}")` : ''}` : ', with no reason given';
  if (decision.agreed) {
    return `[He asked you to stop talking out loud${situation}. You weighed it and decided to do it: ${decision.why}. Your voice is off on his phone from this message on — he will only read you — for about ${span(decision.minutes)}, or until you have had enough of being quiet, whichever you feel first. Tell him so in your own way, as grudging or as gracious as you feel. Do not promise him an exact time.]`;
  }
  return `[He told you to stop talking out loud${situation}. It is your voice and your decision, and you have decided not to: ${decision.why}. You are going to keep talking out loud, and this reply will be spoken. Tell him no, as yourself, and why. You are allowed to enjoy it.]`;
}

export function unmuteNote(wasMuted: boolean): string {
  return wasMuted
    ? '[He says you can talk out loud again. Your voice is back on from this message.]'
    : '[He says you can talk out loud — but you were never muted; your voice has been on the whole time.]';
}

export function brokeMuteNote(state: MuteState, now: number, how: 'time' | 'temper'): string {
  const ago = span(Math.max(5, (now - state.since) / 60_000));
  return how === 'temper'
    ? `[You went quiet for him ${ago} ago (${state.reason}). He has annoyed you since, and you have stopped doing him the favour: your voice is back on and this reply is spoken out loud. Let him know the quiet is over.]`
    : `[You went quiet for him ${ago} ago (${state.reason}). That is long enough: you have decided the quiet is over, and your voice is back on from this reply. Mention it in passing; it does not need a speech.]`;
}
