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
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('trafficWatchAsk',[text]);
  const line = (text ?? '').trim();
  if (!line || line.length > 300 || !WATCH_ASK.test(line)) return null;
  const named = NAMED.exec(line)?.[1]?.trim();
  return { destination: named && !/^(?:Haru|I|It)$/.test(named) ? named : 'home' };
}

const STOP = /^(?:(?:hey |ok )?haru[,!.]?\s+)?(?:(?:never ?mind|forget (?:it|about it)|stop|cancel|don'?t bother|no need)(?: (?:watching|checking|with))?(?: (?:the|that))?(?: traffic| roads?| watch)?(?: (?:then|now|thanks))?|(?:i'?m|we'?re) (?:leaving|heading off|heading home|driving(?: home)?|going(?: home)?|off|on my way|in the car)(?: now| home)?|(?:heading|driving|leaving|going) (?:home|now|off)(?: now)?)[.!\s]*$/i;

/** "Never mind", "I'm leaving now": the watch has nothing left to do. */
export function stopsTrafficWatch(text: string): boolean {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('stopsTrafficWatch',[text]);
  return STOP.test((text ?? '').trim());
}

/** Back near a normal day: within three minutes of it, or fifteen per cent on a long drive. */
export function easedEnough(route: Pick<Route, 'minutes' | 'typicalMinutes'>): boolean {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('easedEnough',[route]);
  if (!(route.typicalMinutes > 0) || !(route.minutes > 0)) return false;
  return route.minutes <= Math.max(route.typicalMinutes + 3, Math.round(route.typicalMinutes * 1.15));
}

export type WatchTarget = { name: string; lat: number; lon: number };

/** The scheduler job for a watch. One at a time: a new ask replaces the old one. */
export function watchJob(destination: string, target: WatchTarget, nowMs: number): Job {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('watchJob',[destination,target,nowMs]);
  const until = nowMs + WATCH_FOR_MS;
  return {
    id: TRAFFIC_WATCH_KIND,
    kind: TRAFFIC_WATCH_KIND,
    schedule: { at: nowMs + WATCH_EVERY_MS },
    dueAt: nowMs + WATCH_EVERY_MS,
    staleAfterMs: 3 * WATCH_EVERY_MS,
    payload: { destination, name: target.name, lat: target.lat, lon: target.lon, startedAt: nowMs, until },
    createdBy: 'app',
    createdAt: nowMs,
    expiresAt: until + 3 * WATCH_EVERY_MS,
    failures: 0,
  };
}

function clock(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone }).replace(/\s/g, ' ');
}

function way(destination: string): string {
  return /^home$/i.test(destination) ? 'home' : `to ${destination}`;
}

/** What she is told when the ask comes in, so what she says about it is true. */
export function watchNote(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'> | null, nowMs: number, timeZone: string, watching: boolean): string {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('watchNote',[destination,route,nowMs,timeZone,watching]);
  if (route && !watching) {
    return `They asked to be told when the traffic ${way(destination)} eases. It already has: ${route.minutes} minutes now, ${route.typicalMinutes} on a normal day, so no watch was needed. Tell them they can go now.`;
  }
  if (!watching) {
    return `They asked to be told when the traffic ${way(destination)} eases, but the app could not read the road just now, so nothing is watching it. Say so plainly — do not promise to check later.`;
  }
  return `They asked to be told when the traffic ${way(destination)} eases. That is set up now, and it is the app that does it, not you remembering: it reads the road again every ${WATCH_EVERY_MS / 60_000} minutes until ${clock(nowMs + WATCH_FOR_MS, timeZone)} and messages them in your words once it is back near normal${route ? ` (it is ${route.minutes} minutes now, ${route.typicalMinutes} on a normal day)` : ''}. Say you will tell them — that is true. Do not say you will keep checking yourself, or give a time it will clear.`;
}

/** Her note for the message that says it has eased. */
export function easedPrompt(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes' | 'km' | 'via'>, startedAt: number, nowMs: number): string {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('easedPrompt',[destination,route,startedAt,nowMs]);
  const ago = Math.max(1, Math.round((nowMs - startedAt) / 60_000));
  return `${ago} minutes ago they asked you to tell them when the traffic ${way(destination)} eased. It has: by car it is ${route.minutes} minutes now (${route.typicalMinutes} on a normal day), ${route.km} km${route.via ? ` via ${route.via}` : ''}. Tell them, in one or two short lines in your own voice, that they can go now. Quote those numbers as they are; say nothing else about the roads.`;
}

/** Her note for the message that says the watch ran out and it never eased. */
export function gaveUpPrompt(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'> | null, startedAt: number, nowMs: number): string {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('gaveUpPrompt',[destination,route,startedAt,nowMs]);
  const hours = Math.round((nowMs - startedAt) / 360_000) / 10;
  return `${hours} hours ago they asked you to tell them when the traffic ${way(destination)} eased. It never did while it was watched${route ? `: it is still ${route.minutes} minutes, ${route.typicalMinutes} on a normal day` : ''}, and the watch has now stopped. Tell them that in one short line in your own voice. Quote any numbers as they are; do not guess when it will clear.`;
}

/** Said when her brain cannot be asked: the facts, plainly. */
export function easedFallback(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'>): string {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('easedFallback',[destination,route]);
  return `Traffic ${way(destination)} has eased — ${route.minutes} min now, ${route.typicalMinutes} on a normal day. Go.`;
}

export function gaveUpFallback(destination: string, route: Pick<Route, 'minutes' | 'typicalMinutes'> | null): string {
 if(process.env.HARU_CORE_NAVIGATION_POLICY==='on')return navigationPolicy('gaveUpFallback',[destination,route]);
  return `Traffic ${way(destination)} never cleared${route ? ` — still ${route.minutes} min against ${route.typicalMinutes}` : ''}. I've stopped watching it.`;
}
