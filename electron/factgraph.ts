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
  return corePolicySync('graph-mutation.normalizeGraph', [value]);
}

/** The user as e0, named as the profile names him. Renamed in place when the profile changes. */
export function withUser(graph: FactGraph, userName: string, day: string): FactGraph {
  return corePolicySync('graph-mutation.withUser', [graph, userName, day]);
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
  return corePolicySync('graph-mutation.findEntity', [graph, name, userName]);
}

// -- reading a day -----------------------------------------------------------------

/**
 * The instruction for the extraction call. Every rule in it answers a failure
 * seen on the real archive (2026-09-16): trivia filed as his life, the day's
 * date stamped on as a start date, today's errands kept as facts, and Haru's
 * own guesses taken as things he said.
 */
export function extractionPrompt(userName: string): string {
  return corePolicySync('graph-mutation.extractionPrompt', [userName]);
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
  return corePolicySync('graph-mutation.dayChunks', [messages, userName, maxChars]);
}

/** What the model is shown as already known: every name, and the current facts about whoever this piece names, with ids it can end. */
export function knownBlock(graph: FactGraph, chunk: string, userName: string, { maxEntities = 150, maxFacts = 60 } = {}): string {
  return corePolicySync('graph-mutation.knownBlock', [graph, chunk, userName, {maxEntities, maxFacts}]);
}

/** The user turn of the extraction call: the day, what is known, and the piece to read. */
export function extractionInput(day: string, known: string, chunk: string): string {
  return corePolicySync('graph-mutation.extractionInput', [day, known, chunk]);
}

export type EntityDraft = { name: string; kind: EntityKind; aliases: string[] };
export type FactDraft = { subject: string; relation: string; object?: string; value?: string; sentence: string; since?: string; claimedBy?: string };
export type EndedDraft = { id: string; until?: string };
export type Extraction = { entities: EntityDraft[]; facts: FactDraft[]; ended: EndedDraft[] };

/** Whatever came back, as drafts: a fenced block, prose around the object, or a wrong shape all degrade to what can be read. */
export function readExtraction(raw: string): Extraction | null {
  return corePolicySync('graph-mutation.readExtraction', [raw]);
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
  return corePolicySync('graph-mutation.isPassing', [text]);
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
  return corePolicySync('graph-mutation.rejectionOf', [fact, at, subjectNames, objectNames]);
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
  return new Set(corePolicySync<string[]>('graph-mutation.wordsBesides', [sentence, names]));
}

/**
 * Whether a draft is one he already said is wrong: the same subject and other
 * side, said with the same relation or much the same words besides the names. "Tommy works at
 * Umart" rejected does not block "Tommy buys parts from Umart". A side is the
 * same by id, or by a name it went by then and goes by now — the id may be new.
 */
export function isRejected(rejected: Rejection[] | undefined, draft: { subject: string; object?: string; valueKey?: string; relation: string; words: Set<string>; subjectNames?: string[]; objectNames?: string[] }): boolean {
  return corePolicySync('graph-mutation.isRejected', [rejected ?? null, {...draft, words: [...draft.words]}]);
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
  return corePolicySync('graph-mutation.applyExtraction', [source, extraction, {day, chunk, userName}]);
}

/** History that nothing has confirmed goes first, then single-day facts, oldest first. Names nothing points at go with them. */
export function pruneGraph(graph: FactGraph, max = MAX_FACTS): FactGraph {
  return corePolicySync('graph-mutation.pruneGraph', [graph, max]);
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
  return corePolicySync<LinkedFact[]>('graph.linkedFacts', [graph, message, {context, userName, seeds, perSeed, perNeighbour, neighbours, max}]);
}

/**
 * The note she reads. Sentences as they were written, grouped under whoever
 * the message named; history marked with when it stopped; somebody else's
 * word marked as theirs. Background, and said so — a list in front of her is
 * a list she will otherwise recite.
 */
export function linkedNote(graph: FactGraph, linked: LinkedFact[], maxChars = LINKED_NOTE_CHARS): string {
  return corePolicySync<string>('graph.linkedNote', [graph, linked, maxChars]);
}
