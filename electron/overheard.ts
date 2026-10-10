import {supplement,supplementOwned} from './core-context-supplement';
// What she comes to know from the chats he let her read (2026-09-19).
//
// Tier 1 of the WhatsApp door. The messages themselves are never a turn — she
// is reading over his shoulder, not sitting in Sam's conversation — so what
// they are for is this: the thing in them that changes his day, and the thing
// in them that is still true next month.
//
// Two destinations, because those are two different kinds of knowing:
//
//   plans -> his list (kept.items), where a wrong one is visible and he can
//     delete it. "Sam moved dinner to 8" is the whole reason this tier exists.
//   facts -> the graph, where a wrong one is invisible and compounds. Which is
//     why that half is off unless he switches it on: graphBrain() already
//     refuses to read his own days with a local model, having measured it
//     filing the Eiffel Tower as part of his life (2026-09-16). The model has
//     changed since — a 27B now, not that 9B — but the measurement has not been
//     redone, and a graph of wrong facts about his friends is worse than none.
//
// Everything here runs on the local brain, and `isLoopback` is what makes that
// true rather than intended: his contacts never agreed to be read by anything,
// let alone by a hosted model, and the config could be pointed anywhere.

import type { Extraction } from './factgraph';

/** One line from a chat she is allowed to read. */
export type Line = { chat: string; chatName: string; who: string; text: string; at: string };

/**
 * Whether a brain is on this machine.
 *
 * The check that keeps his contacts' messages off the internet. `ai.config` is
 * the local route today, but it is a config value and config values move; this
 * turns "the local model reads these" from an intention into something the
 * code refuses to break.
 */
export function isLoopback(endpoint: string): boolean {
  if(supplementOwned())return supplement('isLoopback',[endpoint]);

  let host = '';
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  // The Tailscale address of this same machine is still this machine, but it is
  // a network hop and a tailnet is not one host. Refused, deliberately: the
  // loopback rule is easier to be sure of than a list of addresses we trust.
  return /^127\./.test(host);
}

/** A rolling window of what was said, bounded per chat so one busy group cannot crowd out the rest. */
export class Overheard {
  private readonly byChat = new Map<string, Line[]>();
  private readonly coreLimits:Record<string,number>;
  constructor(private readonly perChat = 60, private readonly chats = 20) {this.coreLimits={...(arguments[0]===undefined?{}:{perChat:arguments[0]}),...(arguments[1]===undefined?{}:{chats:arguments[1]})};}

  note(line: Line): void {
    if(supplementOwned()){const p=supplement<any>('bufferNote',[[...this.byChat.keys()],this.byChat.get(line.chat)??[],line,this.coreLimits]);if(p.write){this.byChat.delete(p.chat);this.byChat.set(p.chat,p.rows);for(const key of p.remove)this.byChat.delete(key);}return;}
    if (!line.chat || !line.text.trim()) return;
    const held = this.byChat.get(line.chat) ?? [];
    held.push(line);
    while (held.length > this.perChat) held.shift();
    this.byChat.delete(line.chat);
    this.byChat.set(line.chat, held);
    while (this.byChat.size > this.chats) {
      const oldest = this.byChat.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.byChat.delete(oldest);
    }
  }

  /** Everything held, oldest chat first, and emptied -- a pass reads each line once. */
  drain(): Line[][] {
    if(supplementOwned()){const p=supplement<any>('bufferDrain',[[...this.byChat].map(([key,rows])=>({key,length:rows.length}))]);const values=p.take.map((key:string)=>this.byChat.get(key)!);if(p.clear)this.byChat.clear();return values;}
    const all = [...this.byChat.values()];
    this.byChat.clear();
    return all.filter(lines => lines.length > 0);
  }

  get lines(): number {
    return [...this.byChat.values()].reduce((count, lines) => count + lines.length, 0);
  }
}

/** A thing that changes his day, as the model is asked for it. */
export type Plan = { title: string; date: string; time?: string; who?: string; said?: string };

export function overheardPrompt(userName: string): string {
  if(supplementOwned())return supplement('overheardPrompt',[userName]);

  const user = userName.trim() || 'the user';
  return `You are reading part of a WhatsApp conversation ${user} is in, so that his assistant knows what he has been told. You are not in the conversation and you never reply to it.

Lines starting "${user}:" are him. Every other name is somebody else.

Return only JSON: {"plans": [...], "entities": [...], "facts": [...], "ended": []}

plans: things said here that change ${user}'s own plans -- something arranged, moved, cancelled or asked of him, that he would want on his list.
- {"title", "date", "time", "who", "said"}
- title: what it is, in a few plain words, as an instruction to himself. "Dinner with Sam", not "Sam says dinner is moved".
- date: YYYY-MM-DD. Work it out from the date of the conversation, which is given below. Only a date you are sure of; leave the plan out entirely rather than guess one.
- time: "7:00 PM" when a time was actually said. Leave it out otherwise. Never invent one.
- who: the person who said it.
- said: the one sentence they said it in.
Only things ${user} is actually part of. Somebody else's plans that do not involve him are not his. A plan he has already agreed to elsewhere is still a plan; a suggestion nobody settled ("we should do something sometime") is not.

facts: lasting facts about the people in ${user}'s life that would still be true next month -- where somebody lives, works or studies, who they are to each other, what they own, dates that matter. Unlike the plans, these may come from what anybody here said about themselves.
- {"subject", "relation", "object" or "value", "sentence", "claimedBy"}
- subject: an entity name. relation: 1 to 4 lowercase words read in order. sentence: one standalone sentence using names, never "he", "she", "I", "you".
- claimedBy: who said it. Always set it here -- nothing in this conversation is ${user}'s own word.

entities: each named thing a fact uses, as {"name", "kind", "aliases"}. Call him "${user}". Never include Haru.

ended: always an empty list. Nothing overheard in one conversation ends a fact.

What is not a plan and not a fact: chat, jokes, opinions, how somebody feels, what is on television, anything already over, and anything you had to guess at. Most stretches of conversation contain neither; then return empty lists. Fewer and surer beats more.`;
}

export function overheardInput(chatName: string, day: string, lines: Line[]): string {
  if(supplementOwned())return supplement('overheardInput',[chatName,day,lines]);

  const said = lines.map(line => `${line.who}: ${line.text.replace(/\s+/g, ' ').trim().slice(0, 400)}`).join('\n');
  return `Conversation: ${chatName}\nDate of this conversation: ${day}\n\n${said}`;
}

/** For an Ollama endpoint, which can hold the model to the shape. */
export const OVERHEARD_SCHEMA = {
  type: 'object',
  properties: {
    plans: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, who: { type: 'string' }, said: { type: 'string' } }, required: ['title', 'date'] } },
    entities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } } }, required: ['name', 'kind'] } },
    facts: { type: 'array', items: { type: 'object', properties: { subject: { type: 'string' }, relation: { type: 'string' }, object: { type: 'string' }, value: { type: 'string' }, sentence: { type: 'string' }, claimedBy: { type: 'string' } }, required: ['subject', 'relation', 'sentence'] } },
    ended: { type: 'array', items: { type: 'object' } },
  },
  required: ['plans', 'entities', 'facts', 'ended'],
} as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The plans out of whatever came back. Tolerant of prose around the object, like readExtraction. */
export function readPlans(raw: string): Plan[] {
  if(supplementOwned())return supplement('readPlans',[raw]);

  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const held = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  if (!Array.isArray(held.plans)) return [];
  return held.plans
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map(entry => ({
      title: String(entry.title ?? '').trim(),
      date: String(entry.date ?? '').trim(),
      time: typeof entry.time === 'string' && entry.time.trim() ? entry.time.trim() : undefined,
      who: typeof entry.who === 'string' && entry.who.trim() ? entry.who.trim() : undefined,
      said: typeof entry.said === 'string' && entry.said.trim() ? entry.said.trim() : undefined,
    }));
}

/** What an entry on his list looks like to this file. */
export type Kept = { id: string; title: string; date: string; time?: string; kind: string; done: boolean; heardAbout?: string };

/**
 * Words that make two titles the same thing, for the duplicate check.
 *
 * Short words are dropped so "Dinner with Sam!" and "dinner with sam" are one
 * thing -- but never a word carrying a digit, however short. Dropping those
 * made "Episode 5" and "Episode 6" the same entry, and one of them would have
 * been silently refused as a duplicate of the other.
 */
const shape = (title: string) => title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter(word => word.length > 2 || /\d/.test(word)).sort().join(' ');

export type PlanRefusal = { plan: Plan; why: string };

/**
 * The plans that may go on his list, and why the rest may not.
 *
 * This is the whole defence against a local model inventing his week, so it
 * refuses generously. Every rule here is a shape something has actually gone
 * wrong in before: a date invented because a day of the week was mentioned, a
 * reminder filed years out, the same thing arriving twice under two wordings.
 */
export function keepable(plans: Plan[], existing: Kept[], todayKey: string, { horizonDays = 400, most = 5 } = {}): { keep: Plan[]; refused: PlanRefusal[] } {
  if(supplementOwned())return supplement('keepable',[plans,existing,todayKey,arguments[3]??{}]);

  const keep: Plan[] = [];
  const refused: PlanRefusal[] = [];
  const open = existing.filter(item => !item.done);
  const taken = new Set(open.map(item => `${item.date}|${shape(item.title)}`));
  const horizon = new Date(`${todayKey}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
  const horizonKey = horizon.toISOString().slice(0, 10);

  for (const plan of plans) {
    if (keep.length >= most) { refused.push({ plan, why: 'more than one pass should add' }); continue; }
    if (plan.title.length < 3) { refused.push({ plan, why: 'no title worth keeping' }); continue; }
    if (!ISO_DAY.test(plan.date)) { refused.push({ plan, why: `"${plan.date}" is not a date` }); continue; }
    // A plan in the past is not a plan. The model working out "Friday" and
    // landing on the wrong week is the common way this goes wrong, and it lands
    // behind today about as often as ahead of it.
    if (plan.date < todayKey) { refused.push({ plan, why: 'already past' }); continue; }
    if (plan.date > horizonKey) { refused.push({ plan, why: 'too far out to have been meant' }); continue; }
    const key = `${plan.date}|${shape(plan.title)}`;
    if (taken.has(key)) { refused.push({ plan, why: 'already on his list' }); continue; }
    taken.add(key);
    keep.push(plan);
  }
  return { keep, refused };
}

/**
 * A kept plan, as the entry that goes on his list.
 *
 * `heardAbout` carries where it came from, in words, because an item he did not
 * put there himself and cannot account for is worse than no item: the car rego
 * that was never saved (2026-09-13) was one failure, and a reminder appearing
 * from nowhere would be the opposite one.
 */
export function asKept(plan: Plan, chatName: string): Omit<Kept, 'id' | 'done'> {
  if(supplementOwned())return supplement('asKept',[plan,chatName]);

  const from = plan.who ? `${plan.who} on WhatsApp` : `WhatsApp (${chatName})`;
  return {
    title: plan.title.slice(0, 120),
    date: plan.date,
    ...(plan.time ? { time: plan.time } : {}),
    kind: 'event',
    heardAbout: plan.said ? `${from}: "${plan.said.slice(0, 160)}"` : from,
  };
}

/** The facts half, as the graph's own reader wants it, with every claim attributed. */
export function factsFor(extraction: Extraction | null): Extraction | null {
  if(supplementOwned())return supplement('factsFor',[extraction]);

  if (!extraction) return null;
  // Nothing overheard ends a fact. Somebody saying "Ryan doesn't work there any
  // more" in a chat she is reading is hearsay, and the graph's `ended` list is
  // not the place to act on hearsay.
  const facts = extraction.facts.filter(fact => !!fact.sentence && !!fact.subject);
  if (!facts.length && !extraction.entities.length) return null;
  return { entities: extraction.entities, facts, ended: [] };
}
