import {corePolicySync} from './core-policy-sync';
export type ChunkOptions = {
  maxSize: number;
  overlap: number;
};

export type Chunk = {
  content: string;
  heading?: string;
};

const CODE_FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE = /^\s*>/;
const TABLE_ROW = /^\s*\|/;

function splitUnits(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { index++; continue; }
    if (CODE_FENCE.test(line)) {
      const start = index;
      index++;
      while (index < lines.length && !CODE_FENCE.test(lines[index])) index++;
      index++;
      out.push(lines.slice(start, index).join('\n'));
      continue;
    }
    if (HEADING.test(trimmed)) { out.push(line); index++; continue; }
    if (LIST_ITEM.test(trimmed)) {
      const start = index;
      const indent = line.length - line.trimStart().length;
      index++;
      while (index < lines.length) {
        const next = lines[index];
        const nextTrimmed = next.trim();
        if (!nextTrimmed) { index++; continue; }
        if (HEADING.test(nextTrimmed) || CODE_FENCE.test(next) || TABLE_ROW.test(next)) break;
        const nextIndent = next.length - next.trimStart().length;
        if (LIST_ITEM.test(nextTrimmed) || nextIndent > indent) { index++; continue; }
        break;
      }
      out.push(lines.slice(start, index).join('\n'));
      continue;
    }
    if (BLOCKQUOTE.test(line)) {
      const start = index;
      index++;
      while (index < lines.length) {
        const next = lines[index];
        if (!next.trim()) { index++; continue; }
        if (BLOCKQUOTE.test(next)) { index++; continue; }
        break;
      }
      out.push(lines.slice(start, index).join('\n'));
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const start = index;
      index++;
      while (index < lines.length && TABLE_ROW.test(lines[index])) index++;
      out.push(lines.slice(start, index).join('\n'));
      continue;
    }
    const start = index;
    index++;
    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      if (!nextTrimmed) break;
      if (HEADING.test(nextTrimmed) || CODE_FENCE.test(next) || LIST_ITEM.test(nextTrimmed) || BLOCKQUOTE.test(next) || TABLE_ROW.test(next)) break;
      index++;
    }
    out.push(lines.slice(start, index).join('\n'));
  }
  return out;
}

function lastBreak(text: string, at: number): number {
  const slice = text.slice(0, at);
  const newline = slice.lastIndexOf('\n');
  const space = slice.lastIndexOf(' ');
  const best = Math.max(newline, space);
  return best > at * 0.5 ? best + 1 : at;
}

function splitLong(text: string, maxSize: number, overlap: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > maxSize) {
    const cut = lastBreak(rest, maxSize);
    const piece = rest.slice(0, cut).trim();
    out.push(piece);
    const keep = Math.min(overlap, piece.length);
    const from = Math.max(0, piece.length - keep);
    rest = (piece.slice(from) + rest.slice(cut)).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function packUnits(units: string[], options: ChunkOptions): Chunk[] {
  const { maxSize, overlap } = options;
  const chunks: Chunk[] = [];
  let heading: string | undefined;
  let current: string[] = [];
  let currentLen = 0;
  const tail = (content: string): string => {
    if (overlap <= 0 || !content) return '';
    const words = content.split(' ');
    let out = '';
    for (let at = words.length - 1; at >= 0; at--) {
      const next = out ? `${words[at]} ${out}` : words[at];
      if (next.length > overlap) break;
      out = next;
    }
    return out;
  };
  const flush = (carry: boolean) => {
    if (!current.length) return;
    const content = current.join('\n\n');
    chunks.push({ content, heading });
    const kept = carry ? tail(content) : '';
    current = kept ? [kept] : [];
    currentLen = kept ? kept.length : 0;
  };
  for (const unit of units) {
    const match = HEADING.exec(unit.trim());
    if (match) {
      flush(false);
      heading = match[2].trim();
      current.push(unit);
      currentLen = unit.length;
      continue;
    }
    if (unit.length > maxSize) {
      flush(false);
      for (const piece of splitLong(unit, maxSize, overlap)) {
        current.push(piece);
        currentLen = piece.length;
        flush(false);
      }
      continue;
    }
    if (currentLen > 0 && currentLen + unit.length + 2 > maxSize) flush(true);
    current.push(unit);
    currentLen += unit.length + 2;
  }
  flush(false);
  return chunks;
}

export function chunkMarkdown(text: string, options: ChunkOptions): Chunk[] {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-chunks.markdown',[text,options]); 
  return packUnits(splitUnits(text), options);
}

export function chunkText(text: string, options: ChunkOptions): Chunk[] {
  if(process.env.HARU_CORE_KNOWLEDGE==='on')return corePolicySync('knowledge-chunks.text',[text,options]); 
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
  return packUnits(paragraphs.length ? paragraphs : [text.trim()].filter(Boolean), options);
}
