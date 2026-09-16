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
};

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
  return { entities, facts, read, nextId };
}

/** The user as e0, named as the profile names him. Renamed in place when the profile changes. */
export function withUser(graph: FactGraph, userName: string, day: string): FactGraph {
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
 * The entity a name refers to, or undefined. An exact name or alias first; then
 * a bare first name that belongs to exactly one person ("Emma" is Emma Wilson);
 * then a full name whose first name is a person known only by that.
 */
export function findEntity(graph: FactGraph, name: string, userName = ''): GraphEntity | undefined {
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
  const user = userName.trim() || 'the user';
  return `You keep a map of the people, pets, places, organisations, projects, media, devices and things in ${user}'s own life, and how they connect. You are given part of one day of ${user}'s chat with Haru, his AI companion.

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
  return `The day is ${day}.\n\nKNOWN:\n${known}\n\nTRANSCRIPT:\n${chunk}`;
}

export type EntityDraft = { name: string; kind: EntityKind; aliases: string[] };
export type FactDraft = { subject: string; relation: string; object?: string; value?: string; sentence: string; since?: string; claimedBy?: string };
export type EndedDraft = { id: string; until?: string };
export type Extraction = { entities: EntityDraft[]; facts: FactDraft[]; ended: EndedDraft[] };

/** Whatever came back, as drafts: a fenced block, prose around the object, or a wrong shape all degrade to what can be read. */
export function readExtraction(raw: string): Extraction | null {
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
  const graph: FactGraph = withUser({
    entities: source.entities.map(entity => ({ ...entity, aliases: [...entity.aliases] })),
    facts: source.facts.map(fact => ({ ...fact })),
    read: { ...source.read },
    nextId: source.nextId,
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
  let facts = graph.facts;
  if (facts.length > max) {
    const order = [...facts].sort((a, b) =>
      Number(isCurrent(a)) - Number(isCurrent(b)) || a.days - b.days || a.confirmed.localeCompare(b.confirmed));
    const drop = new Set(order.slice(0, facts.length - max).map(fact => fact.id));
    facts = facts.filter(fact => !drop.has(fact.id)).map(fact => (fact.supersededBy && drop.has(fact.supersededBy) ? { ...fact, supersededBy: undefined } : fact));
  }
  const used = new Set<string>([USER_ENTITY]);
  for (const fact of facts) for (const id of [fact.subject, fact.object, fact.claimedBy]) if (id) used.add(id);
  return { ...graph, facts, entities: graph.entities.filter(entity => used.has(entity.id)) };
}

// -- reply time --------------------------------------------------------------------

/** The entities a message names, longest match first. Never the user himself: every fact is his. */
export function mentionedEntities(graph: FactGraph, text: string, userName = ''): GraphEntity[] {
  const hay = searchable(text);
  const terms = entityTerms(graph, userName);
  const found: { entity: GraphEntity; length: number }[] = [];
  for (const entity of graph.entities) {
    if (entity.id === USER_ENTITY) continue;
    const hits = (terms.get(entity.id) ?? []).filter(term => containsTerm(hay, term));
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
 */
function entityTerms(graph: FactGraph, userName: string): Map<string, string[]> {
  const out = new Map(graph.entities.map(entity => [entity.id, matchTerms(entity, userName)] as const));
  const firsts = new Map<string, string[]>();
  for (const entity of graph.entities) {
    if (entity.id === USER_ENTITY) continue;
    const words = withoutOwner(entity.name, userName).split(/\s+/);
    if (words.length < 2 || !/^[A-Z][A-Za-z0-9]{3,}$/.test(words[0])) continue;
    const first = nameKey(words[0]);
    if (GENERIC_FIRST.has(first) || first === nameKey(userName)) continue;
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
