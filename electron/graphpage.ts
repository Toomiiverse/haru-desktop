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

import {corePolicySync} from './core-policy-sync';
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
  return corePolicySync('graph-mutation.renderGraphPage', [graph, now]);
}

export function readGraphPage(text: string): ReadPage {
  {
    const held = corePolicySync<{facts:Record<string,PageLine>;headings:Record<string,string>;added:ReadPage['added']}>('graph-mutation.readGraphPage', [text]);
    return {...held, facts:new Map(Object.entries(held.facts)), headings:new Map(Object.entries(held.headings))};
  }
}

export type PageReport = { forgot: string[]; ended: string[]; restored: string[]; reworded: string[]; added: string[]; renamed: string[]; distrusted?: string };

/**
 * His edits, folded into the graph. Only what the page showed last time can be
 * changed by its absence; a fact the graph learned since the page was written
 * is not on it yet and is left alone.
 */
export function applyGraphPage(source: FactGraph, page: ReadPage, day: string, now: Date): { graph: FactGraph; report: PageReport } {
  return corePolicySync('graph-mutation.applyGraphPage', [source, {...page, facts:Object.fromEntries(page.facts), headings:Object.fromEntries(page.headings)}, day, now]);
}

export function pageReportLine(report: PageReport): string {
  return corePolicySync('graph-mutation.pageReportLine', [report]);
}
