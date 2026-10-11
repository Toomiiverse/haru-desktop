// Who is who in his life, and how it all connects — the graph step.
//
// memories.json holds sixty records at most, and the triples on them were
// filled on two of fifty-nine and read only as a five-per-cent entity score.
// Nothing could answer "who is Ryan" once Ryan's record had been pruned, and
// nothing linked Ryan to the finance team or the finance team to the shop.
//
// This is a separate layer beside the memories, not a replacement for them:
//
//   entities  people, pets, places, organisations, projects, media, devices,
//             each with the other names he uses for them
//   facts     one sentence each, tied to one entity and to another entity or a
//             plain value, dated when it stopped being true — kept rather than
//             deleted, so "what did he do before" still has an answer
//
// Filled from each finished day by the hosted brain (readDayIntoGraph in
// main.ts). The local 9B was measured first, 2026-09-16, on the same prompt: it
// filed the Eiffel Tower as part of his life, made a date the subject of a
// birthday and wrote "Tommy works at a job". Kimi K2.5 on the same two days
// kept his job, the finance team lead and his stepdad, and nothing else.
//
// At reply time the message is matched against the names, and the facts one
// step out from anyone it names go in front of her (linkedFacts, linkedNote).
// No model call on that path, and nothing at all when nobody is named.
//
// Pure: the model call and the file live in main.ts and store.ts.

import {corePolicySync} from './core-policy-sync';

export const ENTITY_KINDS = ['person', 'pet', 'place', 'organisation', 'project', 'media', 'device', 'thing'] as const;
export type EntityKind = typeof ENTITY_KINDS[number];

export type GraphEntity = {
  id: string;
  name: string;
  kind: EntityKind;
  /** Other names he uses for the same one — a first name, "mum", "the cafe". */
  aliases: string[];
  /** Day keys, YYYY-MM-DD. */
  firstSeen: string;
  lastSeen: string;
};

export type GraphFact = {
  id: string;
  /** Entity id. */
  subject: string;
  /** A few lowercase words — "works at", "stepfather of". */
  relation: string;
  /** Entity id, when the other side is something with a name… */
  object?: string;
  /** …or plain text when it is not. */
  value?: string;
  /** What she is shown: one standalone sentence with names in it. */
  sentence: string;
  /** When it became true, only when that was actually said. */
  since?: string;
  /** When it stopped being true. A fact with this set is history, not current. */
  until?: string;
  /** The fact that replaced this one, when there was one. */
  supersededBy?: string;
  /** Entity id of whoever he was passing on — "Sudin reckons…" is Sudin's word, not his. */
  claimedBy?: string;
  /** The day it was first learned and the day it last came up. */
  learned: string;
  confirmed: string;
  /** Separate days it has come up on. */
  days: number;
};

export type FactGraph = {
  entities: GraphEntity[];
  facts: GraphFact[];
  /**
   * Day key → how many messages that day held when it was read. A day that has
   * grown since (a conversation started over and archived twice) is read again;
   * a restart never pays for a day twice.
   */
  read: Record<string, number>;
  /** Ids are short on purpose: the model is shown them in KNOWN and names them back. */
  nextId: number;
  /** Facts he deleted from his page as wrong — never learned again (graphpage.ts). */
  rejected?: Rejection[];
  /** What his page last showed, so his edits can be told from the graph moving on (graphpage.ts). */
  page?: PageWritten;
};

/**
 * subjectNames and objectNames are the names each side went by when he said no.
 * The ids alone did not hold (2026-09-17): a fact that was the only one about
 * somebody took that somebody with it when it was deleted, the next read of a
 * day minted a fresh id for the same name, and the rejection was left pointing
 * at nothing while the fact came back. Rejections from before carry no names
 * and still match by id.
 */
export type Rejection = { subject: string; object?: string; value?: string; relation: string; words: string[]; at: string; subjectNames?: string[]; objectNames?: string[] };
export type PageWritten = { at: string; facts: Record<string, { sentence: string; struck: boolean }>; entities: Record<string, string> };

/** The user is always entity e0 — every day is about him. */
export const USER_ENTITY = 'e0';

/** Past this the least-confirmed history goes first. Measured size: 44 days read gave a few hundred. */
export const MAX_FACTS = 2000;

/** Everything a message can pull in, so a name-dense message cannot take over the prompt. */
export const LINKED_NOTE_CHARS = 1400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyGraph(): FactGraph {
  return { entities: [], facts: [], read: {}, nextId: 1 };
}

/** A file somebody edited by hand comes back usable rather than throwing — the bargain memories.json makes. */
export function normalizeGraph(value: unknown): FactGraph {
  if ((true as boolean)) return corePolicySync('graph-mutation.normalizeGraph', [value]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyGraph();
  const held = value as Partial<Record<keyof FactGraph, unknown>>;
  const text = (candidate: unknown) => (typeof candidate === 'string' ? candidate : '');
  const entities = (Array.isArray(held.entities) ? held.entities : [])
    .filter((entity): entity is GraphEntity => Boolean(entity) && typeof (entity as GraphEntity).id === 'string' && Boolean(text((entity as GraphEntity).name).trim()))
    .map(entity => ({
      id: entity.id,
      name: entity.name.trim(),
      kind: (ENTITY_KINDS as readonly string[]).includes(entity.kind) ? entity.kind : 'thing',
      aliases: Array.isArray(entity.aliases) ? entity.aliases.filter(alias => typeof alias === 'string' && alias.trim()).map(alias => alias.trim()) : [],
      firstSeen: text(entity.firstSeen),
      lastSeen: text(entity.lastSeen),
    }));
  const ids = new Set(entities.map(entity => entity.id));
  const facts = (Array.isArray(held.facts) ? held.facts : [])
    .filter((fact): fact is GraphFact => Boolean(fact) && typeof (fact as GraphFact).id === 'string' && ids.has((fact as GraphFact).subject) && Boolean(text((fact as GraphFact).sentence).trim()))
    .map(fact => ({ ...fact, days: Number.isFinite(fact.days) && fact.days > 0 ? fact.days : 1 }))
    .filter(fact => !fact.object || ids.has(fact.object));
  const read: Record<string, number> = {};
  if (held.read && typeof held.read === 'object' && !Array.isArray(held.read)) {
    for (const [day, count] of Object.entries(held.read as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count)) read[day] = count;
    }
  }
  const highest = [...entities.map(entity => entity.id), ...facts.map(fact => fact.id)]
    .map(id => Number(id.slice(1)))
    .filter(Number.isFinite)
    .reduce((max, n) => Math.max(max, n), 0);
  const nextId = typeof held.nextId === 'number' && held.nextId > highest ? held.nextId : highest + 1;
  const rejected = (Array.isArray(held.rejected) ? held.rejected : []).filter((item): item is Rejection =>
    Boolean(item) && typeof (item as Rejection).subject === 'string' && typeof (item as Rejection).relation === 'string' && Array.isArray((item as Rejection).words));
  const page = held.page as PageWritten | undefined;
  const validPage = page && typeof page === 'object' && page.facts && typeof page.facts === 'object' && page.entities && typeof page.entities === 'object';
  return { entities, facts, read, nextId, ...(rejected.length ? { rejected } : {}), ...(validPage ? { page } : {}) };
}

/** The user as e0, named as the profile names him. Renamed in place when the profile changes. */
export function withUser(graph: FactGraph, userName: string, day: string): FactGraph {
  if ((true as boolean)) return corePolicySync('graph-mutation.withUser', [graph, userName, day]);
  const name = userName.trim() || 'the user';
  const existing = graph.entities.find(entity => entity.id === USER_ENTITY);
  if (existing?.name === name) return graph;
  const user: GraphEntity = existing
    ? { ...existing, name, aliases: uniqueNames([...existing.aliases, existing.name].filter(alias => nameKey(alias) !== nameKey(name))) }
    : { id: USER_ENTITY, name, kind: 'person', aliases: [], firstSeen: day, lastSeen: day };
  return { ...graph, entities: [user, ...graph.entities.filter(entity => entity.id !== USER_ENTITY)] };
}

export function isCurrent(fact: GraphFact): boolean {
  return !fact.until && !fact.supersededBy;
}

// -- names -------------------------------------------------------------------------

/**
 * The words that make two names the same name: case, accents, a leading "the",
 * an owner in front ("Tommy's mum", "his mum" and "mum" are one person) and
 * punctuation all fall away.
 */
export function nameKey(name: string, userName = ''): string {
  const key = withoutOwner(String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), userName);
  return key.replace(/'s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Tommy's mum", "his mum", "the mum" → "mum". Case kept, so a capital still tells a name from a noun. */
function withoutOwner(text: string, userName: string): string {
  const user = userName.trim().replace(/[^a-zA-Z0-9 ]+/g, '').replace(/\s+/g, '\\s+');
  const owner = new RegExp(`^(?:${user ? `${user}'s\\s+|` : ''}his\\s+|my\\s+|their\\s+)`, 'i');
  return text.replace(/[’`]/g, "'").trim().replace(owner, '').replace(/^the\s+/i, '');
}

/** Family words and the like: lowercase, and still somebody. Everything else lowercase is a common noun. */
const KIN = new Set(['mum', 'mom', 'mother', 'dad', 'father', 'stepdad', 'stepfather', 'stepmum', 'stepmom', 'stepmother', 'sister', 'brother',
  'nan', 'nana', 'grandma', 'grandpa', 'grandmother', 'grandfather', 'aunt', 'auntie', 'uncle', 'cousin', 'girlfriend', 'boyfriend',
  'wife', 'husband', 'gf', 'bf', 'psychologist', 'therapist', 'boss']);

/**
 * The words a message has to contain for this entity to count as named. A
 * lowercase alias is a common noun — "the shop", "work" — and would drag the
 * shop into every message that mentions work, so only names with a capital,
 * and family words, are matched.
 */
export function matchTerms(entity: GraphEntity, userName = ''): string[] {
  const out = new Set<string>();
  for (const form of [entity.name, ...entity.aliases]) {
    const stripped = withoutOwner(form, userName);
    const key = nameKey(form, userName);
    if (key.length < 3) continue;
    if (/[A-Z0-9]/.test(stripped) || KIN.has(key)) out.add(key);
  }
  return [...out];
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}

/** Whole words, possessive or plural "s" allowed: "mums house" names mum. */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.split(' ').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?:^|\\s)${escaped}s?(?=\\s|$)`).test(haystack);
}

function searchable(text: string): string {
  return ` ${String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/'s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * The commonest English words, three letters and up (shorter never match).
 * A name that is one of these — Square the payment company, The Office once
 * "the" falls away — is named by a message only where it is written with a
 * capital mid-sentence; otherwise "back to square one" brings in Square. Kept
 * to ordinary words on purpose: the people in his life (Emma, Sam, Logan,
 * Ryan, Johnny) are not words, and a name that is a word as well as a name
 * (Will, Mark) still counts when it is written as a name.
 */
const COMMON_WORDS = new Set(`
the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who did its let put say she too use
that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them
well were what where which while would there their these those then into about after again also back because before being below between both could down each
even every few further having off once other ought ours own same should since still through under until upon why yet yes yeah yep nope okay lol haha
gonna wanna gotta thanks thank please sorry hey hello bye maybe really actually probably pretty quite rather almost always never sometimes often usually
already soon later today tonight tomorrow yesterday morning afternoon evening night week weekend month year hour minute second moment
hers herself himself itself themselves yourself yours mine anyone anything anybody everyone everything everybody someone something somebody nobody nothing none
three four five six seven eight nine ten twenty hundred thousand first third last next half
ask become begin believe bring buy call care carry change check choose close cook cost cut decide die drink drive eat end enjoy explain fall feel fight fill
find finish fit fix fly follow forget give grow happen hate hear help hide hit hold hope hurt keep kill laugh lay lead learn leave lie listen live look lose love
mean meet miss move need open pass pay pick plan play pull push reach read remember rest return ride ring rise run save seem sell send set share show shut sing
sit sleep smile sound speak spend stand start stay stop study talk teach tell think throw touch travel try turn understand visit wait wake walk wash watch wear
win wish wonder work worry write
said made went gone came took taken gave given got gotten told thought knew known felt left kept found saw seen done brought bought caught taught sent spent
built held stood understood ran sat met lost paid heard meant led fell fallen grew grown drew drawn wrote written spoke spoken broke broken chose chosen drove
driven ate eaten slept woke woken won sang sung began begun became forgot forgotten wore worn hid hidden shot hung stuck swam threw thrown flew flown rode
ridden rose risen shook shaken fed fought sought laid lit dealt quit
people person thing place world life home house room door car road street city town country school class job money food water game show movie film book
story music song phone computer internet name word friend family kid child children baby girl boy woman men women guy dude mate team group company business
shop store office part side point fact case idea problem question answer reason issue lot kind sort type number line top bottom front head face hand eye body
heart mind window table bed chair floor wall kitchen bathroom garden yard dog cat bird fish tree fire air sun moon star sky rain snow weather heat summer
winter spring autumn lunch dinner breakfast coffee tea beer bread meat chicken rice pizza power light voice picture photo video message text chat email news
paper letter list project test exam grade lesson system program app site page screen level fun trip holiday gift present future past history war peace law
rule government state area land sea river lake hill mountain island beach park field farm market bank hospital church club bar restaurant hotel station airport
train bus plane boat bike ship truck board card box bag bottle cup glass plate key lock clock shirt shoes dress hat coat price bill cash deal sale order
meeting interview result effect research science health doctor police army king art square mark
great best better bad worse worst big small little large short high low young early late hard easy fast slow hot cold warm cool nice fine sure real true false
right wrong full empty free busy ready happy sad glad angry tired sick dead alive clear dark bright black white red blue green yellow brown pink purple grey
gray gold silver heavy strong weak rich poor cheap expensive clean dirty quiet loud safe dangerous simple important different whole main certain able likely
possible impossible final major minor common basic entire perfect favourite favorite funny weird crazy cute beautiful ugly lovely awesome amazing boring
interesting serious honest
alone along anyway around away else enough especially ever everywhere far however instead least less near nearly outside inside perhaps quickly together
`.split(/\s+/).filter(Boolean));

/** Whether a word is one of the commonest, as written or with an ordinary ending taken off: "walking" is "walk", "parties" is "party". */
function isCommonWord(word: string): boolean {
  const stems = [
    word,
    word.replace(/s$/, ''), word.replace(/es$/, ''), word.replace(/ies$/, 'y'),
    word.replace(/ed$/, ''), word.replace(/ed$/, 'e'), word.replace(/ied$/, 'y'), word.replace(/(.)\1ed$/, '$1'),
    word.replace(/ing$/, ''), word.replace(/ing$/, 'e'), word.replace(/(.)\1ing$/, '$1'),
  ];
  return stems.some(stem => stem.length >= 3 && COMMON_WORDS.has(stem));
}

/**
 * Whether the message writes this word with a capital where a sentence does
 * not begin: "paid through Square" names it, "Square is down" and "square one"
 * do not. The start of the text, of a line, and anything after . ! ? or : (a
 * transcript line's "Tommy:" label) count as a sentence beginning.
 */
function capitalisedMidSentence(text: string, word: string): boolean {
  const plain = String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'");
  const pattern = new RegExp(`(?<![A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|s)?(?![A-Za-z0-9])`, 'gi');
  for (const match of plain.matchAll(pattern)) {
    if (!/^[A-Z]/.test(match[0])) continue;
    const before = plain.slice(0, match.index);
    const lead = before.match(/[\s"'“”‘(\[*_~•-]*$/)?.[0] ?? '';
    const prior = before.slice(0, before.length - lead.length);
    if (prior && !/[.!?:…]$/.test(prior) && !lead.includes('\n')) return true;
  }
  return false;
}

/**
 * The entity a name refers to, or undefined. An exact name or alias first; then
 * a bare first name that belongs to exactly one person ("Emma" is Emma Wilson);
 * then a full name whose first name is a person known only by that.
 */
export function findEntity(graph: FactGraph, name: string, userName = ''): GraphEntity | undefined {
  if ((true as boolean)) return corePolicySync('graph-mutation.findEntity', [graph, name, userName]);
  const key = nameKey(name, userName);
  if (!key) return undefined;
  if (userName && key === nameKey(userName)) return graph.entities.find(entity => entity.id === USER_ENTITY);
  const exact = graph.entities.find(entity => [entity.name, ...entity.aliases].some(form => nameKey(form, userName) === key));
  if (exact) return exact;
  const people = graph.entities.filter(entity => entity.kind === 'person' && entity.id !== USER_ENTITY);
  const words = key.split(' ');
  if (words.length === 1) {
    const byFirst = people.filter(entity => nameKey(entity.name, userName).split(' ')[0] === key);
    return byFirst.length === 1 ? byFirst[0] : undefined;
  }
  const byShort = people.filter(entity => nameKey(entity.name, userName) === words[0]);
  return byShort.length === 1 ? byShort[0] : undefined;
}

// -- reading a day -----------------------------------------------------------------

/**
 * The instruction for the extraction call. Every rule in it answers a failure
 * seen on the real archive (2026-09-16): trivia filed as his life, the day's
 * date stamped on as a start date, today's errands kept as facts, and Haru's
 * own guesses taken as things he said.
 */
export function extractionPrompt(userName: string): string {
  if ((true as boolean)) return corePolicySync('graph-mutation.extractionPrompt', [userName]);
  const user = userName.trim() || 'the user';
  return `You keep a map of the people, pets, places, organisations, projects, media, devices and things in ${user}'s own life, and how they connect. You are given part of one day of ${user}'s chat with Haru, his companion.

Lines starting "${user}:" are him. Lines starting "Haru:" are her. Take facts only from what ${user} said, or from something Haru said that ${user} clearly confirmed. Haru's guesses, jokes, teasing, opinions and suggestions are never facts.

What counts: lasting facts about ${user}'s life that would still be true next month. Who the people in his life are to him and to each other, where he and they live, work or study, roles in his business, what his projects are and what they run on, what he owns and uses, pets, birthdays and other dates that matter.
What does not count: general knowledge and trivia (what a landmark is, what a show is about, how far one place is from another), characters in shows, games and books, passing moods, anything that happened or is planned only for today or this week, errands, pickups, parties, appointments, reminders, what a computer's readout says, chit-chat, and anything about Haru herself.
Not facts, for example: "${user} messaged Connor today", "${user} plans to go hiking this weekend", "${user} picked up a motherboard from Umart", "Jandakot is 34 km from Rockingham", "The server has 298 GB free".

Return only JSON: {"entities": [...], "facts": [...], "ended": [...]}
- entities: each named thing a fact uses, as {"name", "kind", "aliases"}. kind is one of ${ENTITY_KINDS.join(', ')}. name is the fullest proper name used. aliases are other names used for the same one (a first name, a nickname, "his mum"). Call him "${user}". Never include Haru. A date, an amount or a generic noun ("a job", "the store", "website") is not an entity. When KNOWN already has it, use the KNOWN name.
- facts: {"subject", "relation", "object" or "value", "sentence", "since", "claimedBy"}
  subject: an entity name
  relation: 1 to 4 lowercase words, read in order: subject, relation, object. "Johnny" "stepfather of" "${user}", never "${user}" "stepfather of" "Johnny".
  object: an entity name, OR value: short plain text when the other side is not a named entity
  sentence: one standalone sentence that uses names, never "he", "she", "they", "I" or "you"
  since: YYYY-MM-DD, only when a start date was actually said. The date of the chat is not a start date. Otherwise leave it out.
  claimedBy: a name, only when ${user} was passing on what somebody else said
- ended: ids from KNOWN that this conversation shows are no longer true, as {"id", "until"}, with until as YYYY-MM-DD when known.

Fewer, surer facts beat many guesses. Most days have only a few and many have none; then return empty lists.`;
}

/** For an Ollama endpoint, which can hold the model to the shape; a hosted one is asked for a JSON object. */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    entities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: [...ENTITY_KINDS] }, aliases: { type: 'array', items: { type: 'string' } } }, required: ['name', 'kind'] } },
    facts: { type: 'array', items: { type: 'object', properties: { subject: { type: 'string' }, relation: { type: 'string' }, object: { type: 'string' }, value: { type: 'string' }, sentence: { type: 'string' }, since: { type: 'string' }, claimedBy: { type: 'string' } }, required: ['subject', 'relation', 'sentence'] } },
    ended: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, until: { type: 'string' } }, required: ['id'] } },
  },
  required: ['entities', 'facts', 'ended'],
} as const;

type DayMessage = { role?: string; content?: unknown };

/** A day as labelled lines, split into pieces a single call reads comfortably. His lines keep more than hers: facts come from him. */
export function dayChunks(messages: DayMessage[], userName: string, maxChars = 12_000): string[] {
  if ((true as boolean)) return corePolicySync('graph-mutation.dayChunks', [messages, userName, maxChars]);
  const user = userName.trim() || 'the user';
  const lines = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => {
      const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
      return text ? `${message.role === 'user' ? user : 'Haru'}: ${text.slice(0, message.role === 'user' ? 600 : 240)}` : '';
    })
    .filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length > maxChars && current.length) {
      chunks.push(current.join('\n'));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current.join('\n'));
  // A piece where he says almost nothing has nothing of his to take facts from.
  return chunks.filter(chunk => chunk.split('\n').filter(line => line.startsWith(`${user}:`)).join(' ').length >= 80);
}

/** What the model is shown as already known: every name, and the current facts about whoever this piece names, with ids it can end. */
export function knownBlock(graph: FactGraph, chunk: string, userName: string, { maxEntities = 150, maxFacts = 60 } = {}): string {
  if ((true as boolean)) return corePolicySync('graph-mutation.knownBlock', [graph, chunk, userName, {maxEntities, maxFacts}]);
  const entities = [...graph.entities]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, maxEntities)
    .map(entity => `${entity.name} (${entity.kind}${entity.aliases.length ? `; also ${entity.aliases.join(', ')}` : ''})`);
  const named = new Set(mentionedEntities(graph, chunk, userName).map(entity => entity.id));
  named.add(USER_ENTITY);
  const facts = graph.facts
    .filter(fact => isCurrent(fact) && (named.has(fact.subject) || (fact.object ? named.has(fact.object) : false)))
    .sort((a, b) => Number(b.subject !== USER_ENTITY) - Number(a.subject !== USER_ENTITY) || b.confirmed.localeCompare(a.confirmed))
    .slice(0, maxFacts)
    .map(fact => `${fact.id}: ${fact.sentence}`);
  return [
    'Names:', entities.length ? entities.join('\n') : '(none yet)',
    '', 'Facts about who this part names:', facts.length ? facts.join('\n') : '(none yet)',
  ].join('\n');
}

/** The user turn of the extraction call: the day, what is known, and the piece to read. */
export function extractionInput(day: string, known: string, chunk: string): string {
  if ((true as boolean)) return corePolicySync('graph-mutation.extractionInput', [day, known, chunk]);
  return `The day is ${day}.\n\nKNOWN:\n${known}\n\nTRANSCRIPT:\n${chunk}`;
}

export type EntityDraft = { name: string; kind: EntityKind; aliases: string[] };
export type FactDraft = { subject: string; relation: string; object?: string; value?: string; sentence: string; since?: string; claimedBy?: string };
export type EndedDraft = { id: string; until?: string };
export type Extraction = { entities: EntityDraft[]; facts: FactDraft[]; ended: EndedDraft[] };

/** Whatever came back, as drafts: a fenced block, prose around the object, or a wrong shape all degrade to what can be read. */
export function readExtraction(raw: string): Extraction | null {
  if ((true as boolean)) return corePolicySync('graph-mutation.readExtraction', [raw]);
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const held = parsed as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : []);
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return {
    entities: list(held.entities).map(entity => ({
      name: str(entity.name),
      kind: ((ENTITY_KINDS as readonly string[]).includes(str(entity.kind)) ? str(entity.kind) : 'thing') as EntityKind,
      aliases: Array.isArray(entity.aliases) ? entity.aliases.map(str).filter(Boolean) : [],
    })).filter(entity => entity.name),
    facts: list(held.facts).map(fact => ({
      subject: str(fact.subject), relation: str(fact.relation), object: str(fact.object) || undefined, value: str(fact.value) || undefined,
      sentence: str(fact.sentence), since: str(fact.since) || undefined, claimedBy: str(fact.claimedBy) || undefined,
    })).filter(fact => fact.subject && fact.relation && fact.sentence),
    ended: list(held.ended).map(item => ({ id: str(item.id), until: str(item.until) || undefined })).filter(item => item.id),
  };
}

const HARU = /^haru\b/i;
/** Entities that are somebody or something of his in their own right; places, media and devices are his only through a fact. */
const OWN_KINDS = new Set(['person', 'pet', 'organisation', 'project']);

/**
 * A fact about a day rather than a life. Every pattern here is a line from the
 * first full read of the archive (2026-09-16) that the prompt alone did not
 * stop: "messaged Connor today", "plans to go hiking this weekend", "picked up
 * the motherboard from Umart", "Ammie's birthday party at 8pm", "a rescheduled
 * appointment for next Friday".
 */
export function isPassing(text: string): boolean {
  if ((true as boolean)) return corePolicySync('graph-mutation.isPassing', [text]);
  return /\b(today|tonight|tomorrow|yesterday|this (morning|afternoon|evening|weekend|week)|next (week|weekend|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|last night|right now|at the moment)\b/i.test(text)
    || /\b(plans? to|planning to|going to|about to|needs? to|has to|have to|trying to|wants? to)\b/i.test(text)
    || /\b(messaged|asked|picked up|picks up|pick up|went (out|to)|rescheduled|troubleshoot(s|ing|ed)?|dropped off|drops off|is creating|is setting up|free space|GB free)\b/i.test(text)
    // A customer's machine on his bench is not his machine.
    || /\bcustomer'?s?\b/i.test(text)
    || /\bparty\b/i.test(text)
    || /\bat \d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(text);
}
const ADDRESSED = /\b(you|your|yours|yourself|i|me|my|mine)\b/i;
/** Birthdays do not move; a second one for the same person is a correction. */
const ONE_ONLY = new Set(['birthday', 'born on', 'date of birth', 'birth date']);

/**
 * The record of a fact he said is wrong: who it was about, what it tied them
 * to, how it was said — and the names both sides went by, so the rejection
 * outlives the ids (see Rejection).
 */
export function rejectionOf(fact: GraphFact, at: string, subjectNames: string[] = [], objectNames: string[] = []): Rejection {
  if ((true as boolean)) return corePolicySync('graph-mutation.rejectionOf', [fact, at, subjectNames, objectNames]);
  const subjects = properNames(subjectNames);
  const objects = fact.object ? properNames(objectNames) : [];
  return {
    subject: fact.subject, relation: relationKey(fact.relation), words: [...wordsBesides(fact.sentence, [...subjectNames, ...objectNames])], at,
    ...(fact.object ? { object: fact.object } : { value: searchable(fact.value ?? '').trim() }),
    ...(subjects.length ? { subjectNames: subjects } : {}),
    ...(objects.length ? { objectNames: objects } : {}),
  };
}

/**
 * The names worth holding a rejection by: the ones with a capital, and family
 * words — the same line matchTerms draws. A lowercase alias is a common noun,
 * and on the live graph both The PC Project and Happytel Rockingham are "the
 * shop": holding "Tommy works at Happytel Rockingham" rejected by "the shop"
 * would refuse his real job at The PC Project too.
 */
function properNames(names: string[]): string[] {
  return uniqueNames(names.filter(name => typeof name === 'string' && (/[A-Z0-9]/.test(withoutOwner(name, '')) || KIN.has(nameKey(name)))));
}

/** One side of a rejection and one side of a draft are the same one: the same id, or a name in common. */
function sameSide(id: string | undefined, names: unknown, draftId: string | undefined, draftNames: string[] | undefined): boolean {
  if (id !== undefined && id === draftId) return true;
  if (!Array.isArray(names) || !draftNames?.length) return false;
  // By nameKey — searchable() with a leading "the" and an owner dropped — so
  // "The Pharisees" then is "Pharisees" now, in any case. The held side is
  // proper names only (properNames), which is what keeps "the shop" out.
  const held = new Set(names.filter((name): name is string => typeof name === 'string').map(name => nameKey(name)).filter(Boolean));
  return draftNames.some(name => held.has(nameKey(name)));
}

/** A sentence's content words without the names in it: what is said about them, not who. */
export function wordsBesides(sentence: string, names: string[]): Set<string> {
  if ((true as boolean)) return new Set(corePolicySync<string[]>('graph-mutation.wordsBesides', [sentence, names]));
  const named = contentWords(names.join(' '));
  return new Set([...contentWords(sentence)].filter(word => !named.has(word)));
}

/**
 * Whether a draft is one he already said is wrong: the same subject and other
 * side, said with the same relation or much the same words besides the names. "Tommy works at
 * Umart" rejected does not block "Tommy buys parts from Umart". A side is the
 * same by id, or by a name it went by then and goes by now — the id may be new.
 */
export function isRejected(rejected: Rejection[] | undefined, draft: { subject: string; object?: string; valueKey?: string; relation: string; words: Set<string>; subjectNames?: string[]; objectNames?: string[] }): boolean {
  if ((true as boolean)) return corePolicySync('graph-mutation.isRejected', [rejected ?? null, {...draft, words: [...draft.words]}]);
  return (rejected ?? []).some(no => sameSide(no.subject, no.subjectNames, draft.subject, draft.subjectNames)
    && (draft.object ? Boolean(no.object) && sameSide(no.object, no.objectNames, draft.object, draft.objectNames) : Boolean(draft.valueKey) && no.value === draft.valueKey)
    && (no.relation === draft.relation || overlap(new Set(no.words), draft.words) >= 0.5));
}

function relationKey(relation: string): string {
  return relation.toLowerCase().replace(/^(is|are|was|has been|have been)\s+/, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentWords(text: string): Set<string> {
  // Numbers count whatever their length: "25 August" and "28 August" are not the same birthday.
  return new Set(searchable(text).split(' ').filter(word => word.length >= 4 || /\d/.test(word)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(word => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

export type ApplyReport = { added: number; confirmed: number; ended: number; rejected: string[] };

/**
 * Folds one piece's extraction into the graph. Every draft has to be grounded
 * in the piece it came from — a name that is not in the text is a name the
 * model invented — and a fact that is already known is confirmed, not added
 * twice. Returns a new graph; the old one is untouched.
 */
export function applyExtraction(source: FactGraph, extraction: Extraction, { day, chunk, userName }: { day: string; chunk: string; userName: string }): { graph: FactGraph; report: ApplyReport } {
  if ((true as boolean)) return corePolicySync('graph-mutation.applyExtraction', [source, extraction, {day, chunk, userName}]);
  const graph: FactGraph = withUser({
    entities: source.entities.map(entity => ({ ...entity, aliases: [...entity.aliases] })),
    facts: source.facts.map(fact => ({ ...fact })),
    read: { ...source.read },
    nextId: source.nextId,
    ...(source.rejected ? { rejected: source.rejected } : {}),
    ...(source.page ? { page: source.page } : {}),
  }, userName, day);
  const report: ApplyReport = { added: 0, confirmed: 0, ended: 0, rejected: [] };
  const hay = searchable(chunk);
  // His lines alone. The first full read (2026-09-16) filed her recital of the
  // server's free disk space as a fact about his life: something new has to be
  // in his own words, whatever she said around it.
  const label = `${userName.trim() || 'the user'}:`;
  const his = searchable(chunk.split('\n').filter(line => line.startsWith(label)).map(line => line.slice(label.length)).join('\n'));
  const inText = (name: string, where = hay) => {
    const key = nameKey(name, userName);
    return key.length >= 2 && containsTerm(where, key);
  };
  const inHisWords = (name: string) => inText(name, his);
  const newId = (prefix: 'e' | 'f') => `${prefix}${graph.nextId++}`;
  const isUser = (name: string) => {
    const key = nameKey(name, userName);
    return key === nameKey(userName) || ['user', 'the user', 'him', 'he', 'me', 'i'].includes(key);
  };

  // Names first, so the facts can point at them. Resolved against what is
  // known before anything new is made: the same person under a first name is
  // an alias, not a second person.
  const accepted = new Map<string, string>(); // nameKey → entity id
  const accept = (draft: EntityDraft): string | undefined => {
    if (!draft.name || draft.name.length > 60 || HARU.test(draft.name)) return undefined;
    if (isUser(draft.name)) return USER_ENTITY;
    const forms = uniqueNames([draft.name, ...draft.aliases]).filter(form => !HARU.test(form) && form.length <= 60 && !isUser(form));
    const known = forms.map(form => findEntity(graph, form, userName)).find(Boolean);
    // Somebody already known may be named by either of them; somebody new, only by him.
    if (!forms.some(form => (known ? inText(form) : inHisWords(form)))) return undefined;
    if (known) {
      if (known.id === USER_ENTITY) return USER_ENTITY;
      // A fuller name for somebody known by a first name becomes the name.
      const fuller = nameKey(draft.name, userName).split(' ').length > nameKey(known.name, userName).split(' ').length
        && nameKey(draft.name, userName).startsWith(nameKey(known.name, userName));
      if (fuller) {
        known.aliases = uniqueNames([known.name, ...known.aliases]);
        known.name = draft.name;
      }
      known.aliases = uniqueNames([...known.aliases, ...forms]).filter(form => nameKey(form, userName) !== nameKey(known.name, userName));
      if (day > known.lastSeen) known.lastSeen = day;
      return known.id;
    }
    const entity: GraphEntity = { id: newId('e'), name: draft.name, kind: draft.kind, aliases: forms.filter(form => nameKey(form, userName) !== nameKey(draft.name, userName)), firstSeen: day, lastSeen: day };
    graph.entities.push(entity);
    return entity.id;
  };
  for (const draft of extraction.entities) {
    const id = accept(draft);
    if (id) for (const form of [draft.name, ...draft.aliases]) accepted.set(nameKey(form, userName), id);
    else report.rejected.push(`entity "${draft.name}"`);
  }
  const resolve = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    if (isUser(name)) return USER_ENTITY;
    if (HARU.test(name)) return undefined;
    const id = accepted.get(nameKey(name, userName));
    if (id) return id;
    // Named in a fact but not listed as an entity: still fine, if it is known
    // already and the piece really does name it.
    const known = findEntity(graph, name, userName);
    return known && [known.name, ...known.aliases].some(form => inText(form)) ? known.id : undefined;
  };

  const endedIds = new Set<string>();
  for (const item of extraction.ended) {
    const fact = graph.facts.find(candidate => candidate.id === item.id && isCurrent(candidate));
    if (!fact) { report.rejected.push(`ended ${item.id}`); continue; }
    // Only something this piece is about can be ended by it.
    const ends = [fact.subject, fact.object].filter((id): id is string => Boolean(id) && id !== USER_ENTITY);
    const named = ends.some(id => {
      const entity = graph.entities.find(candidate => candidate.id === id);
      return entity ? [entity.name, ...entity.aliases].some(form => inText(form)) : false;
    });
    if (!named && ends.length) { report.rejected.push(`ended ${item.id} (not in this part)`); continue; }
    fact.until = item.until && DAY.test(item.until) && item.until <= day ? item.until : day;
    endedIds.add(fact.id);
    report.ended += 1;
  }

  // What touches him first, so a place he has just been tied to is connected by
  // the time a fact about that place is weighed.
  const touchesUser = (draft: FactDraft) => [draft.subject, draft.object].some(name => name && isUser(name));
  const ordered = [...extraction.facts].sort((a, b) => Number(touchesUser(b)) - Number(touchesUser(a)));
  const kindOf = (id: string) => graph.entities.find(entity => entity.id === id)?.kind;
  const connected = (id: string) => id === USER_ENTITY || OWN_KINDS.has(kindOf(id) ?? 'thing')
    || graph.facts.some(fact => isCurrent(fact) && ((fact.subject === id && fact.object === USER_ENTITY) || (fact.object === id && fact.subject === USER_ENTITY)));

  for (const draft of ordered) {
    const tag = `fact "${draft.sentence.slice(0, 60)}"`;
    if (isPassing(draft.sentence) || isPassing(draft.relation)) { report.rejected.push(`${tag} (passing)`); continue; }
    const subject = resolve(draft.subject);
    if (!subject) { report.rejected.push(`${tag} (subject)`); continue; }
    let object = resolve(draft.object);
    let value = draft.value?.slice(0, 120);
    // An object that is not a known name is a value in disguise ("works on" "website").
    if (draft.object && !object) value = value ?? draft.object.slice(0, 120);
    if (object === subject) object = undefined;
    if (!object && !value) { report.rejected.push(`${tag} (no other side)`); continue; }
    // Trivia is two things neither of which is in his life: the airport nearest
    // a suburb he once drove through. One side has to be him, somebody, or
    // something already tied to him.
    if (subject !== USER_ENTITY && object !== USER_ENTITY && !connected(subject) && !(object && connected(object))) { report.rejected.push(`${tag} (not his)`); continue; }
    const relation = relationKey(draft.relation);
    if (!relation || relation.split(' ').length > 5 || relation.length > 40) { report.rejected.push(`${tag} (relation)`); continue; }
    const sentence = draft.sentence.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (ADDRESSED.test(sentence) || /\bharu\b/i.test(sentence)) { report.rejected.push(`${tag} (addressed)`); continue; }
    // A value has to be there in what was said, or the model supplied it.
    if (!object && value) {
      const words = [...contentWords(value)];
      if (words.length && words.filter(word => his.includes(` ${word}`)).length / words.length < 0.5) { report.rejected.push(`${tag} (value not in his words)`); continue; }
    }
    // The day of the chat is not when something started — the measured slip.
    const since = draft.since && DAY.test(draft.since) && draft.since < day ? draft.since : undefined;
    const claimedBy = resolve(draft.claimedBy);

    const valueKey = value ? searchable(value).trim() : '';
    const words = contentWords(sentence);
    // He deleted this from his page as wrong: whatever the day says, it is not learned again.
    const namesOf = (id?: string) => graph.entities.filter(entity => entity.id === id).flatMap(entity => [entity.name, ...entity.aliases]);
    if (isRejected(graph.rejected, { subject, object, valueKey, relation, words: wordsBesides(sentence, [...namesOf(subject), ...namesOf(object)]), subjectNames: namesOf(subject), objectNames: namesOf(object) })) { report.rejected.push(`${tag} (he said it is wrong)`); continue; }
    const same = graph.facts.find(fact => {
      if (!isCurrent(fact)) return false;
      const sameRelation = fact.subject === subject && relationKey(fact.relation) === relation;
      // Same subject and relation is the same claim only with the same other
      // side; with a different one it is a different claim, however alike the
      // sentences read.
      if (sameRelation) return object ? fact.object === object : searchable(fact.value ?? '').trim() === valueKey;
      // The same pair told the other way round, or the same thing reworded.
      const pair = Boolean(object && fact.object) && new Set([fact.subject, fact.object]).has(subject) && new Set([fact.subject, fact.object]).has(object as string);
      if (pair) return overlap(contentWords(fact.sentence), words) >= 0.6;
      return fact.subject === subject && overlap(contentWords(fact.sentence), words) >= 0.8;
    });
    if (same) {
      if (day > same.confirmed) { same.confirmed = day; same.days += 1; }
      if (!same.since && since) same.since = since;
      report.confirmed += 1;
      continue;
    }
    const fact: GraphFact = {
      id: newId('f'), subject, relation, ...(object ? { object } : { value }), sentence,
      ...(since ? { since } : {}), ...(claimedBy && claimedBy !== USER_ENTITY ? { claimedBy } : {}),
      learned: day, confirmed: day, days: 1,
    };
    // What this replaces: a birthday corrected, or a fact the same piece ended
    // with the same subject and relation — "works at X" ended, "works at Y" new.
    for (const old of graph.facts) {
      if (old.subject !== subject || relationKey(old.relation) !== relation || old.supersededBy) continue;
      if (endedIds.has(old.id) || (ONE_ONLY.has(relation) && isCurrent(old))) {
        old.supersededBy = fact.id;
        old.until = old.until ?? since ?? day;
      }
    }
    graph.facts.push(fact);
    report.added += 1;
  }
  return { graph: pruneGraph(graph), report };
}

/** History that nothing has confirmed goes first, then single-day facts, oldest first. Names nothing points at go with them. */
export function pruneGraph(graph: FactGraph, max = MAX_FACTS): FactGraph {
  if ((true as boolean)) return corePolicySync('graph-mutation.pruneGraph', [graph, max]);
  let facts = graph.facts;
  if (facts.length > max) {
    const order = [...facts].sort((a, b) =>
      Number(isCurrent(a)) - Number(isCurrent(b)) || a.days - b.days || a.confirmed.localeCompare(b.confirmed));
    const drop = new Set(order.slice(0, facts.length - max).map(fact => fact.id));
    facts = facts.filter(fact => !drop.has(fact.id)).map(fact => (fact.supersededBy && drop.has(fact.supersededBy) ? { ...fact, supersededBy: undefined } : fact));
  }
  const used = new Set<string>([USER_ENTITY]);
  for (const fact of facts) for (const id of [fact.subject, fact.object, fact.claimedBy]) if (id) used.add(id);
  // A rejection made before rejections kept names (2026-09-17) takes them from
  // its entities while they are still here, so the names outlast the entity.
  const namesOf = (id?: string) => properNames(graph.entities.filter(entity => entity.id === id).flatMap(entity => [entity.name, ...entity.aliases]));
  const rejected = graph.rejected?.map(no => {
    if (no.subjectNames || no.objectNames) return no;
    const subjects = namesOf(no.subject);
    const objects = no.object ? namesOf(no.object) : [];
    return subjects.length || objects.length ? { ...no, ...(subjects.length ? { subjectNames: subjects } : {}), ...(objects.length ? { objectNames: objects } : {}) } : no;
  });
  return { ...graph, facts, entities: graph.entities.filter(entity => used.has(entity.id)), ...(rejected ? { rejected } : {}) };
}

// -- reply time --------------------------------------------------------------------

/** The entities a message names, longest match first. Never the user himself: every fact is his. */
export function mentionedEntities(graph: FactGraph, text: string, userName = ''): GraphEntity[] {
  const hay = searchable(text);
  const terms = entityTerms(graph, userName);
  // A name of one ordinary word is only a name where it is written as one — see
  // COMMON_WORDS. Longer names, family words and words that are nothing but
  // names (Emma, Happytel) match however he types them.
  const names = (term: string) => containsTerm(hay, term)
    && (term.includes(' ') || KIN.has(term) || !isCommonWord(term) || capitalisedMidSentence(text, term));
  const found: { entity: GraphEntity; length: number }[] = [];
  for (const entity of graph.entities) {
    if (entity.id === USER_ENTITY) continue;
    const hits = (terms.get(entity.id) ?? []).filter(names);
    if (hits.length) found.push({ entity, length: Math.max(...hits.map(term => term.length)) });
  }
  // "Emma Wilson" in a message should not also bring in an "Emma" who is somebody else.
  return found
    .sort((a, b) => b.length - a.length || b.entity.lastSeen.localeCompare(a.entity.lastSeen))
    .filter((hit, index, all) => !all.slice(0, index).some(longer => longer.length > hit.length && (terms.get(longer.entity.id) ?? []).some(term => (terms.get(hit.entity.id) ?? []).some(short => term.includes(short)))))
    .map(hit => hit.entity);
}

/** Leading words that say what kind of place a name is rather than which one. */
const GENERIC_FIRST = new Set(['north', 'south', 'east', 'west', 'saint', 'mount', 'lake', 'port', 'royal', 'national', 'university', 'city', 'new', 'old', 'big', 'little', 'great']);

/**
 * Every entity's match terms, plus the first word of a longer name when that
 * word is a name in itself and nobody else's: he says "happytel", not
 * "Happytel Rockingham". Shared first words stay out — two Emmas mean "emma"
 * names neither.
 *
 * And so do first words that are ordinary words. Titles are made of them, and
 * the first word alone matched his messages rather than the title: "made"
 * brought in Made in Abyss on 7 of his 1,393 real messages ("I made dinner"),
 * "walking" brought in Walking Dead (measured 2026-09-17). Those are named by
 * the whole name, or by an alias the reading of a day heard him use. Not even a
 * capital lets an ordinary first word through: "Made" at the start of a
 * sentence is the verb far more often than the show.
 */
function entityTerms(graph: FactGraph, userName: string): Map<string, string[]> {
  const out = new Map(graph.entities.map(entity => [entity.id, matchTerms(entity, userName)] as const));
  const firsts = new Map<string, string[]>();
  for (const entity of graph.entities) {
    if (entity.id === USER_ENTITY) continue;
    const words = withoutOwner(entity.name, userName).split(/\s+/);
    if (words.length < 2 || !/^[A-Z][A-Za-z0-9]{3,}$/.test(words[0])) continue;
    const first = nameKey(words[0]);
    if (GENERIC_FIRST.has(first) || isCommonWord(first) || first === nameKey(userName)) continue;
    firsts.set(first, [...(firsts.get(first) ?? []), entity.id]);
  }
  const taken = new Set([...out.values()].flat());
  for (const [first, ids] of firsts) {
    if (ids.length !== 1 || taken.has(first)) continue;
    out.set(ids[0], [...(out.get(ids[0]) ?? []), first]);
  }
  return out;
}

/** Asking how things were, not how they are — the one time the history is worth its space. */
export function asksAboutChange(text: string): boolean {
  return /\b(used to|any ?more|no longer|before|previous(ly)?|originally|back then|changed|since when|when did|last (year|month|time)|old (job|place|house))\b/i.test(String(text ?? ''));
}

export type LinkedFact = { fact: GraphFact; seed: string; depth: 0 | 1 };

/**
 * The facts one step out from whoever the message names: theirs first, then a
 * couple each about the names those facts lead to. Never through the user —
 * he is on the other end of nearly everything and would bring all of it.
 */
export function linkedFacts(graph: FactGraph, message: string, { context = '', userName = '', seeds = 3, perSeed = 6, perNeighbour = 2, neighbours = 4, max = 16 } = {}): LinkedFact[] {
  if ((true as boolean)) return corePolicySync<LinkedFact[]>('graph.linkedFacts', [graph, message, {context, userName, seeds, perSeed, perNeighbour, neighbours, max}]);
  let named = mentionedEntities(graph, message, userName);
  // "how's she doing" names nobody; the message before it may have.
  if (!named.length && context) named = mentionedEntities(graph, context, userName);
  const chosen = named.slice(0, seeds);
  if (!chosen.length) return [];
  const temporal = asksAboutChange(message);
  const recent = (a: GraphFact, b: GraphFact) => b.confirmed.localeCompare(a.confirmed) || b.days - a.days;
  const touching = (id: string) => graph.facts.filter(fact => fact.subject === id || fact.object === id);
  const out: LinkedFact[] = [];
  const taken = new Set<string>();
  const take = (fact: GraphFact, seed: string, depth: 0 | 1) => {
    if (taken.has(fact.id) || out.length >= max) return;
    taken.add(fact.id);
    out.push({ fact, seed, depth });
  };
  const seedIds = new Set(chosen.map(entity => entity.id));
  for (const seed of chosen) {
    const facts = touching(seed.id);
    facts.filter(isCurrent).sort(recent).slice(0, perSeed).forEach(fact => take(fact, seed.id, 0));
    if (temporal) facts.filter(fact => !isCurrent(fact)).sort((a, b) => (b.until ?? '').localeCompare(a.until ?? '')).slice(0, 3).forEach(fact => take(fact, seed.id, 0));
  }
  const next: { id: string; seed: string }[] = [];
  for (const { fact, seed } of [...out]) {
    const other = fact.subject === seed ? fact.object : fact.subject;
    if (!other || other === USER_ENTITY || seedIds.has(other) || next.some(entry => entry.id === other)) continue;
    next.push({ id: other, seed });
  }
  for (const { id, seed } of next.slice(0, neighbours)) {
    touching(id).filter(isCurrent).sort(recent).slice(0, perNeighbour).forEach(fact => take(fact, seed, 1));
  }
  return out;
}

/**
 * The note she reads. Sentences as they were written, grouped under whoever
 * the message named; history marked with when it stopped; somebody else's
 * word marked as theirs. Background, and said so — a list in front of her is
 * a list she will otherwise recite.
 */
export function linkedNote(graph: FactGraph, linked: LinkedFact[], maxChars = LINKED_NOTE_CHARS): string {
  if ((true as boolean)) return corePolicySync<string>('graph.linkedNote', [graph, linked, maxChars]);
  if (!linked.length) return '';
  const name = (id?: string) => graph.entities.find(entity => entity.id === id)?.name ?? '';
  // When it came up, and whether more than once: one mention a month ago is a
  // thing to hold lightly, not to state back at him as settled.
  const when = (day: string) => {
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  };
  const line = ({ fact }: LinkedFact) => {
    const notes = [
      fact.until ? `no longer true, since ${when(fact.until)}` : fact.days > 1 ? `came up on ${fact.days} days, last ${when(fact.confirmed)}` : `came up once, ${when(fact.learned)}`,
      fact.claimedBy ? `${name(fact.claimedBy)}'s word, passed on` : '',
    ].filter(Boolean);
    return `- ${fact.sentence}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  };
  const lines: string[] = [];
  for (const seed of [...new Set(linked.map(entry => entry.seed))]) {
    const own = linked.filter(item => item.seed === seed && item.depth === 0);
    const further = linked.filter(item => item.seed === seed && item.depth === 1);
    if (!own.length && !further.length) continue;
    lines.push(`${name(seed)}:`);
    lines.push(...own.map(line), ...further.map(entry => `  ${line(entry)}`));
  }
  const head = 'Who and what that message names, as it has come up in your talks over time — background to answer from, not something to recite:';
  const kept: string[] = [];
  let size = head.length;
  for (const text of lines) {
    if (size + text.length + 1 > maxChars) break;
    kept.push(text);
    size += text.length + 1;
  }
  // A heading left with nothing under it says less than no note at all.
  while (kept.length && kept[kept.length - 1].endsWith(':')) kept.pop();
  return kept.length ? `${head}\n${kept.join('\n')}` : '';
}
