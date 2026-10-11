import {navigationPolicy} from './core-navigation-policy';
// "Let me know when the traffic eases": a watch the app keeps, not a promise she makes.
//
// Asked exactly that at 5:44 PM on 2026-09-17, with the drive home at 24 minutes
// against 16, she said "Fine. I'll check again in a bit" — and nothing in her
// could. No booking, no check, nothing on a clock. Now the ask sets a job on the
// scheduler that re-reads the road every few minutes, messages them in her words
// the moment it is back near normal, and gives up honestly when it never is. She
// is told the watch is on, so what she says about it is true.

import type { Job } from './scheduler';
import type { Route } from './routes';

export const TRAFFIC_WATCH_KIND = 'traffic-watch';
/** How often the road is read again while the watch is on. */
export const WATCH_EVERY_MS = 5 * 60_000;
/** How long a watch lasts before she says it has not cleared and stops. */
export const WATCH_FOR_MS = 2 * 3_600_000;

const TELL = String.raw`(?:let me know|lmk|tell me|ping me|notify me|message me|text me|alert me|remind me|give me a (?:shout|heads?[- ]up)|say something|wake me)`;
const WHEN = String.raw`(?:when|once|if|as soon as)`;
const ROADS = String.raw`(?:traffic|the roads?|roads?|the drive(?: home)?|the freeway|the highway)`;
const EASES = String.raw`(?:clears?(?: up)?|cleared|eases?(?: off| up)?|eased|loosens?(?: up)?|dies? down|calms? down|lightens?(?: up)?|gets? better|improves?|thins? out|goes? down|drops?(?: off)?|settles?(?: down)?|(?:is|are|'s|'re) (?:better|good|fine|ok|okay|clear|light|normal|back to normal|less bad|not bad|moving)|(?:is|are|gets?) (?:less|lighter|quieter))`;
const WATCH_ASK = new RegExp(String.raw`\b${TELL}\b[^.?!\n]*?\b${WHEN}\b[^.?!\n]*?\b${ROADS}\b[^.?!\n]*?\b${EASES}\b`, 'i');
const NAMED = /\b(?:to|towards?|into|for)\s+([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,3})/;

/** The ask, if the message is one: where the drive goes. Home unless a place is named. */
export function trafficWatchAsk(text: string): { destination: string } | null {
 return navigationPolicy('trafficWatchAsk',[text]);
}

const STOP = /^(?:(?:hey |ok )?haru[,!.]?\s+)?(?:(?:never ?mind|forget (?:it|about it)|stop|cancel|don'?t bother|no need)(?: (?:watching|checking|with))?(?: (?:the|that))?(?: traffic| roads?| watch)?(?: (?:then|now|thanks))?|(?:i'?m|we'?re) (?:leaving|heading off|heading home|driving(?: home)?|going(?: home)?|off|on my way|in the car)(?: now| home)?|(?:heading|driving|leaving|going) (?:home|now|off)(?: now)?)[.!\s]*$/i;

/** "Never mind", "I'm leaving now": the watch has nothing left to do. */
export function stopsTrafficWatch(text: string): boolean {
 return navigationPolicy('stopsTrafficWatch',[text]);
}

/** Back near a normal day: within three minutes of it, or fifteen per cent on a long drive. */
export function easedEnough(route: Pick<Route, 'minutes' | 'typicalMinutes'>): boolean {
 return navigationPolicy('easedEnough',[route]);
}

export type WatchTarget = { name: string; lat: number; lon: number };

/** The scheduler job for a watch. One at a time: a new ask replaces the old one. */
export function watchJob(destination: string, target: WatchTarget, nowMs: number): Job {
 return navigationPolicy('watchJob',[destination,target,nowMs]);
}

function clock(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone }).replace(/\s/g, ' ');
}

function way(destination: string): string {
  return /^home$/i.test(destination) ? 'home' : `to ${destination}`;
}

/** What she is told when the ask comes in, so what she says about it is true. */
export function watchNote(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'> | null, nowMs: number, timeZone: string, watching: boolean): string {
 return navigationPolicy('watchNote',[destination,route,nowMs,timeZone,watching]);
}

/** Her note for the message that says it has eased. */
export function easedPrompt(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes' | 'km' | 'via'>, startedAt: number, nowMs: number): string {
 return navigationPolicy('easedPrompt',[destination,route,startedAt,nowMs]);
}

/** Her note for the message that says the watch ran out and it never eased. */
export function gaveUpPrompt(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'> | null, startedAt: number, nowMs: number): string {
 return navigationPolicy('gaveUpPrompt',[destination,route,startedAt,nowMs]);
}

/** Said when her brain cannot be asked: the facts, plainly. */
export function easedFallback(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'>): string {
 return navigationPolicy('easedFallback',[destination,route]);
}

export function gaveUpFallback(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'> | null): string {
 return navigationPolicy('gaveUpFallback',[destination,route]);
}
