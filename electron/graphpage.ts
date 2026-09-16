// What the graph believes, on a page he can correct.
//
// The graph (factgraph.ts) is filled by a model reading his chats, and about
// one fact in five came out wrong on the first full read — "Tommy works at
// Umart" among them, from a day he picked up a motherboard there. A belief he
// cannot see is a belief he cannot fix, and a correction said in chat only
// reaches the graph if the next day's read happens to end the fact.
//
// So the graph is written out to his vault, one heading per person or thing and
// one line per fact, and his edits are read back before it is written again:
//
//   delete a line        she forgets it, and never learns it again (rejected)
//   ~~strike it~~        it was true and is not now: kept as history
//   unstrike a line      it is true again
//   reword a line        the sentence she is shown becomes his
//   add a bullet         a new fact about that heading, in his words
//   rename a heading     the name changes; the old one stays as another name
//
// Each line carries its id in an Obsidian comment (%%f31%%), hidden when the
// page is read, so a line can be moved or reworded and still be the same fact.
// What the page showed last time is kept in graph.json (graph.page): a line
// missing now and present then is his deletion, not the graph moving on.
//
// A page that lost most of its lines at once is not trusted — a sync conflict,
// a truncated file — and a missing page is only written again, never read as
// "delete everything".
//
// Pure: reading and writing the file is main.ts's.

import { isCurrent, pruneGraph, rejectionOf, USER_ENTITY, type EntityKind, type FactGraph, type GraphFact, type PageWritten } from './factgraph';

export const GRAPH_PAGE = 'Who is who.md';

/** More than this share of the page's lines gone at once, and more than a handful, is not an edit. */
const MASS_LOSS = 0.5;
const MASS_LOSS_MIN = 10;

const KIND_ORDER: EntityKind[] = ['person', 'pet', 'organisation', 'project', 'place', 'media', 'device', 'thing'];

const HEADER = `---
tags: [haru/graph]
---

# Who is who — what Haru believes

> Haru writes this from your chats, and reads your changes back before she writes it again (hourly, and after each day she reads).
> **Wrong?** Delete the line. She forgets it and will not learn it again.
> **Was true, is not now?** Wrap it in \`~~\` like ~~this~~. She keeps it as history.
> **Badly put?** Edit the sentence. **Missing?** Add a bullet under the right heading.
> Leave the hidden \`%%…%%\` marks at the end of lines and headings alone — they tie a line to what she knows.
`;

export type PageLine = { text: string; struck: boolean };
export type ReadPage = {
  facts: Map<string, PageLine>;
  headings: Map<string, string>;
  /** Bullets he added: under a heading of hers (entity id), or under a new heading of his (its name). */
  added: { entity?: string; heading?: string; text: string }[];
};

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const UNTIL_NOTE = /\s*\(until \d{4}-\d{2}-\d{2}\)\s*$/;

/** The sentence without strike marks or the "(until …)" note the page adds to history, wherever the strike put the note. */
function sentenceOf(text: string): PageLine {
  let body = clean(text).replace(UNTIL_NOTE, '');
  const struck = /^~~.*~~$/.test(body);
  if (struck) body = body.slice(2, -2).trim().replace(UNTIL_NOTE, '');
  return { text: body, struck };
}

export function renderGraphPage(graph: FactGraph, now: Date): { text: string; written: PageWritten } {
  const written: PageWritten = { at: now.toISOString(), facts: {}, entities: {} };
  const bySubject = new Map<string, GraphFact[]>();
  for (const fact of graph.facts) {
    if (!isCurrent(fact)) continue;
    bySubject.set(fact.subject, [...(bySubject.get(fact.subject) ?? []), fact]);
  }
  const entities = graph.entities
    .filter(entity => bySubject.has(entity.id))
    .sort((a, b) => Number(b.id === USER_ENTITY) - Number(a.id === USER_ENTITY)
      || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      || a.name.localeCompare(b.name));
  const lines: string[] = [HEADER];
  for (const entity of entities) {
    written.entities[entity.id] = entity.name;
    lines.push(`## ${entity.name} %%${entity.id}%%`);
    if (entity.aliases.length) lines.push(`*Also: ${entity.aliases.join(', ')}*`);
    for (const fact of (bySubject.get(entity.id) ?? []).sort((a, b) => a.learned.localeCompare(b.learned))) {
      written.facts[fact.id] = { sentence: fact.sentence, struck: false };
      lines.push(`- ${fact.sentence} %%${fact.id}%%`);
    }
    lines.push('');
  }
  const history = graph.facts.filter(fact => !isCurrent(fact)).sort((a, b) => (b.until ?? '').localeCompare(a.until ?? ''));
  if (history.length) {
    lines.push('## No longer true');
    for (const fact of history) {
      written.facts[fact.id] = { sentence: fact.sentence, struck: true };
      lines.push(`- ~~${fact.sentence}~~${fact.until ? ` (until ${fact.until})` : ''} %%${fact.id}%%`);
    }
    lines.push('');
  }
  return { text: `${lines.join('\n').replace(/\n+$/, '')}\n`, written };
}

export function readGraphPage(text: string): ReadPage {
  const page: ReadPage = { facts: new Map(), headings: new Map(), added: [] };
  let context: { entity?: string; heading?: string } | null = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const marked = heading[1].match(/^(.*?)\s*%%\s*(e\d+)\s*%%$/);
      if (marked) {
        page.headings.set(marked[2], clean(marked[1]));
        context = { entity: marked[2] };
      } else {
        const name = clean(heading[1]);
        context = /^no longer true$/i.test(name) ? null : { heading: name };
      }
      continue;
    }
    if (/^#\s/.test(line)) { context = null; continue; }
    const bullet = line.match(/^[-*+]\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (!bullet) continue;
    // The mark may sit inside the strike as well as after it. Selecting a whole
    // line and striking it, or putting two tildes at each end of it, wraps the
    // hidden mark too: "~~Tommy uses Discord. %%f35%%~~". Read only with the
    // mark last, that line had no id, so the fact looked deleted and was
    // forgotten and rejected — the opposite of what the page tells him striking
    // does (found 2026-09-17). A strike closing after the mark closes the
    // sentence, so both spellings read as struck.
    const marked = bullet[1].match(/^(.*?)\s*%%\s*(f\d+)\s*%%\s*(~~)?$/);
    if (marked) {
      const sentence = sentenceOf(`${marked[1]}${marked[3] ?? ''}`);
      if (sentence.text) page.facts.set(marked[2], sentence);
      continue;
    }
    const added = clean(bullet[1]);
    if (context && added.length >= 4 && !/^~~/.test(added)) page.added.push({ ...context, text: added.slice(0, 220) });
  }
  return page;
}

export type PageReport = { forgot: string[]; ended: string[]; restored: string[]; reworded: string[]; added: string[]; renamed: string[]; distrusted?: string };

/**
 * His edits, folded into the graph. Only what the page showed last time can be
 * changed by its absence; a fact the graph learned since the page was written
 * is not on it yet and is left alone.
 */
export function applyGraphPage(source: FactGraph, page: ReadPage, day: string, now: Date): { graph: FactGraph; report: PageReport } {
  const report: PageReport = { forgot: [], ended: [], restored: [], reworded: [], added: [], renamed: [] };
  const written = source.page;
  if (!written) return { graph: source, report };
  const graph: FactGraph = {
    ...source,
    entities: source.entities.map(entity => ({ ...entity, aliases: [...entity.aliases] })),
    facts: source.facts.map(fact => ({ ...fact })),
    rejected: [...(source.rejected ?? [])],
  };
  // A page with no line of hers on it is a page that is not there yet, not his verdict on all of it.
  if (!page.facts.size && !page.headings.size) return { graph: source, report };
  const shown = Object.keys(written.facts).filter(id => graph.facts.some(fact => fact.id === id));
  const missing = shown.filter(id => !page.facts.has(id));
  if (missing.length > MASS_LOSS_MIN && missing.length > shown.length * MASS_LOSS) {
    report.distrusted = `${missing.length} of ${shown.length} lines gone at once — not taken as his edit`;
    return { graph: source, report };
  }
  const gone = new Set<string>();
  for (const id of shown) {
    const fact = graph.facts.find(candidate => candidate.id === id)!;
    const was = written.facts[id];
    const line = page.facts.get(id);
    if (!line) {
      gone.add(id);
      const namesOf = (id?: string) => graph.entities.filter(entity => entity.id === id).flatMap(entity => [entity.name, ...entity.aliases]);
      graph.rejected!.push(rejectionOf(fact, now.toISOString(), namesOf(fact.subject), namesOf(fact.object)));
      report.forgot.push(fact.sentence);
      continue;
    }
    if (line.struck && !was.struck && isCurrent(fact)) {
      fact.until = day;
      report.ended.push(fact.sentence);
    } else if (!line.struck && was.struck && !isCurrent(fact)) {
      delete fact.until;
      delete fact.supersededBy;
      report.restored.push(fact.sentence);
    }
    if (clean(line.text) !== clean(was.sentence)) {
      fact.sentence = line.text.slice(0, 220);
      report.reworded.push(fact.sentence);
    }
  }
  graph.facts = graph.facts.filter(fact => !gone.has(fact.id))
    .map(fact => (fact.supersededBy && gone.has(fact.supersededBy) ? { ...fact, supersededBy: undefined } : fact));
  for (const [id, name] of page.headings) {
    const entity = graph.entities.find(candidate => candidate.id === id);
    if (!entity || written.entities[id] === undefined || clean(name) === clean(written.entities[id]) || !name) continue;
    entity.aliases = [...new Set([...entity.aliases, entity.name])].filter(alias => alias.toLowerCase() !== name.toLowerCase());
    entity.name = name;
    report.renamed.push(name);
  }
  for (const item of page.added) {
    let subject = item.entity && graph.entities.some(entity => entity.id === item.entity) ? item.entity : undefined;
    if (!subject && item.heading) {
      subject = graph.entities.find(entity => entity.name.toLowerCase() === item.heading!.toLowerCase())?.id;
      if (!subject) {
        subject = `e${graph.nextId++}`;
        graph.entities.push({ id: subject, name: item.heading, kind: 'thing', aliases: [], firstSeen: day, lastSeen: day });
      }
    }
    if (!subject) continue;
    const duplicate = graph.facts.some(fact => fact.subject === subject && clean(fact.sentence).toLowerCase() === item.text.toLowerCase());
    if (duplicate) continue;
    graph.facts.push({ id: `f${graph.nextId++}`, subject, relation: 'noted', value: item.text.slice(0, 120), sentence: item.text, learned: day, confirmed: day, days: 1 });
    report.added.push(item.text);
  }
  return { graph: pruneGraph(graph), report };
}

export function pageReportLine(report: PageReport): string {
  if (report.distrusted) return report.distrusted;
  const parts = [
    report.forgot.length ? `forgot ${report.forgot.length} (${report.forgot.map(text => JSON.stringify(text.slice(0, 60))).join(', ')})` : '',
    report.ended.length ? `${report.ended.length} no longer true` : '',
    report.restored.length ? `${report.restored.length} true again` : '',
    report.reworded.length ? `${report.reworded.length} reworded` : '',
    report.added.length ? `${report.added.length} added` : '',
    report.renamed.length ? `${report.renamed.length} renamed` : '',
  ].filter(Boolean);
  return parts.join(', ');
}
