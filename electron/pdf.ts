import {coreReadPdf} from './core-attachment-files';
// Reading a PDF.
//
// The one file type ffmpeg cannot touch and the one people most expect to be
// able to hand over, so it gets its own module and its own dependency —
// pdfjs-dist, which is Mozilla's own renderer, pure JavaScript, and needs no
// native build. That last part is why it wins: anything wrapping poppler or
// ImageMagick means a binary to find at runtime, and none of the three are on
// this machine.
//
// What this does not do is read a *scanned* PDF. A scan is a picture of a page
// with no text in it at all, and telling those apart from a real document is the
// job of `scanned` below — she should say she cannot read it rather than
// reporting a document with nothing in it.

import fs from 'node:fs';

/** Enough of a document to answer questions about; far short of a whole book. */
export const MAX_PDF_CHARS = 20_000;
/** Past this a document is being mined, not read, and the prompt cannot hold it. */
export const MAX_PDF_PAGES = 40;

export type PdfRead = {
  text: string;
  pages: number;
  /** Pages actually read, which is fewer when the document is long. */
  read: number;
  /** No usable text layer — almost certainly a scan or an export of images. */
  scanned: boolean;
  truncated: boolean;
};

/**
 * Characters per page below which there is nothing really there.
 *
 * A scanned page yields either nothing or a few stray marks the extractor
 * mistook for glyphs. A real page of prose is hundreds. Twenty is comfortably
 * between the two and does not misjudge a title page, because the decision is
 * made on the document's average rather than any single page.
 */
const EMPTY_PAGE_CHARS = 20;

export async function readPdf(file: string, maxChars = MAX_PDF_CHARS): Promise<PdfRead> {
  return coreReadPdf(file,maxChars);
}

/**
 * What she is told about a document.
 *
 * The page count is stated because it changes what a sensible remark is — three
 * pages is a letter, ninety is a manual, and reacting to one as the other is the
 * sort of thing that gives away that nobody actually looked.
 */
export function pdfPrompt(name: string, read: PdfRead, asked: string): string {
  if (read.scanned) {
    return [
      `They have given you a document called "${name}", ${read.pages} page${read.pages === 1 ? '' : 's'} long.`,
      'It is a scan — pictures of pages, with no text in it that can be read.',
      'Say plainly that you cannot read this one and why: it is scanned rather than typed. Do not guess at what it says, and do not pretend to have read it.',
      asked ? `They asked: "${asked}" — you still cannot answer it from the document.` : '',
    ].filter(Boolean).join(' ');
  }
  return [
    `They have given you a document called "${name}" to read. It is ${read.pages} page${read.pages === 1 ? '' : 's'} long${read.read < read.pages ? `, and you have read the first ${read.read}` : ''}.`,
    'This is what it says:',
    read.text,
    read.truncated ? '(That is not all of it — it was cut off.)' : '',
    asked ? `They asked: "${asked}" — answer that from the document.` : 'React to it the way you would if they had put it in front of you. Do not summarise it back at them paragraph by paragraph.',
    'Never mention page counts, extraction, formats or how you came to be reading it — as far as you are concerned, you read it.',
  ].filter(Boolean).join('\n\n');
}
