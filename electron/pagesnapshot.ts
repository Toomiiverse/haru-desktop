// Reading a page the way Playwright MCP describes it.
//
// Playwright MCP does not hand over HTML. It hands over an accessibility
// snapshot — the tree a screen reader would walk — as indented YAML-ish lines:
//
//   - navigation [ref=e2]:
//     - link "About" [ref=e4] [cursor=pointer]:
//       - /url: /about
//   - main [ref=e7]:
//     - heading "Welcome to the shop" [level=1] [ref=e8]
//     - paragraph [ref=e9]: Blue shoes are £40 today.
//     - textbox "Search" [ref=e13]
//     - button "Go" [ref=e14]
//
// Every interactive thing carries a ref, and the ref is what a click or a
// keystroke is addressed to. This file turns that tree into what she is
// handed: the readable text, with the chrome of the page (navigation, cookie
// banners, footers) left out; the links, numbered; the things she can click
// or type into, numbered. Numbers rather than refs or addresses on her side
// for the reason read_web_page takes a result number — a number can only name
// something that is really on the page, where a URL she composes can be
// anything a page talked her into.

export type PageLink = { n: number; text: string; href: string; ref: string };
export type PageElement = { n: number; role: string; label: string; ref: string; value?: string };

export type PageReading = {
  url: string;
  title: string;
  /** The readable text of the page, chrome left out, whitespace collapsed. */
  text: string;
  links: PageLink[];
  elements: PageElement[];
};

/** How many characters of text one `part` carries. */
export const PART_CHARS = 6000;
export const MAX_PARTS = 20;
export const MAX_LINKS = 40;
export const MAX_ELEMENTS = 40;

/** The roles she can act on, and the verb for each. */
const ACTIONABLE: Record<string, string> = {
  button: 'click', link: 'click', textbox: 'type', searchbox: 'type', combobox: 'choose', checkbox: 'tick',
  radio: 'tick', switch: 'toggle', tab: 'click', menuitem: 'click', option: 'choose', slider: 'set', spinbutton: 'type',
};

/** Landmarks whose contents are the page's furniture, not its content. */
const FURNITURE = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'menubar', 'toolbar']);
const COOKIE_WORDS = /\b(?:cookies?|consent|gdpr|privacy choices|accept all|reject all)\b/i;

type Node = { indent: number; role: string; name: string; attrs: Record<string, string>; inline: string; children: Node[]; props: Record<string, string> };

/** The "### Page" header every action result carries. */
export function readPageHeader(text: string): { url: string; title: string } {
  const url = /^- Page URL:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  const title = /^- Page Title:\s*(.*)$/m.exec(text)?.[1]?.trim() ?? '';
  return { url, title };
}

/** The error Playwright MCP reports, when a result is one. */
export function readError(text: string): string | null {
  const match = /^### Error\s*\n(?:Error:\s*)?(?:browserBackend\.callTool:\s*)?([^\n]*)/m.exec(text);
  return match ? match[1].trim() : null;
}

/** The yaml block of a snapshot result; the whole text when it is a bare
 *  tree; nothing when it is a result with headers and no snapshot in it. */
function snapshotBody(text: string): string {
  const fenced = /```ya?ml\s*\n([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1];
  if (/^### /m.test(text)) {
    const after = /^### Snapshot\s*\n([\s\S]*)$/m.exec(text);
    return after ? after[1].replace(/^- \[Snapshot\]\(.*\)\s*$/m, '') : '';
  }
  return text;
}

const LINE = /^(\s*)-\s+(.*)$/;
const HEAD = /^([a-zA-Z][\w-]*)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s+\[[^\]]*\])*)\s*(?::\s*(.*))?$/;

function parseTree(body: string): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const raw of body.split('\n')) {
    const line = LINE.exec(raw);
    if (!line) continue;
    const indent = line[1].length;
    const rest = line[2];
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    // A property of the node above it: "/url: /about", "/placeholder: …".
    const prop = /^\/(\w+):\s*(.*)$/.exec(rest);
    if (prop) {
      if (parent) parent.props[prop[1]] = unquote(prop[2]);
      continue;
    }
    const head = HEAD.exec(rest);
    const node: Node = head
      ? { indent, role: head[1], name: unescape(head[2] ?? ''), attrs: readAttrs(head[3] ?? ''), inline: unquote(head[4] ?? ''), children: [], props: {} }
      : { indent, role: 'text', name: '', attrs: {}, inline: unquote(rest), children: [], props: {} };
    if (node.role === 'text') node.inline = node.inline || node.name;
    (parent ? parent.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

function readAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(/\[([^\]=]+)(?:=([^\]]*))?\]/g)) attrs[match[1]] = match[2] ?? 'true';
  return attrs;
}

function unescape(text: string): string {
  return text.replace(/\\(["\\])/g, '$1');
}

function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return unescape(trimmed.slice(1, -1));
  return trimmed;
}

function looksLikeCookieBanner(node: Node): boolean {
  const words = gatherText(node, true);
  return words.length < 600 && COOKIE_WORDS.test(words) && node.children.some(child => child.role === 'button');
}

function gatherText(node: Node, everything: boolean): string {
  const parts: string[] = [];
  const walk = (current: Node) => {
    if (!everything && (FURNITURE.has(current.role) || looksLikeCookieBanner(current))) return;
    if (current.role === 'img') { if (current.name) parts.push(`[image: ${current.name}]`); return; }
    if (current.role === 'option') return; // listed under its combobox
    // A label and the box it labels both carry the same words; once is enough.
    const say = (words: string) => { if (words && parts[parts.length - 1] !== words) parts.push(words); };
    if (current.name && !['text'].includes(current.role) && current.role !== 'generic') say(current.name);
    if (current.inline) say(current.inline);
    for (const child of current.children) walk(child);
    if (/^(?:heading|paragraph|listitem|list|table|row|article|section|region|main|blockquote|cell)$/.test(current.role)) parts.push('\n');
  };
  walk(node);
  return parts.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** The reading of one snapshot result. `base` resolves relative hrefs. */
export function readSnapshot(text: string, base = ''): PageReading {
  const { url, title } = readPageHeader(text);
  const roots = parseTree(snapshotBody(text));
  const links: PageLink[] = [];
  const elements: PageElement[] = [];
  const seenRefs = new Set<string>();
  const walk = (node: Node, insideFurniture: boolean) => {
    const furniture = insideFurniture || FURNITURE.has(node.role) || looksLikeCookieBanner(node);
    const ref = node.attrs.ref;
    if (ref && !seenRefs.has(ref)) {
      if (node.role === 'link') {
        const href = resolveHref(node.props.url ?? '', url || base);
        // Links in the navigation are kept too — "About" is a link she may
        // well want — but after the content's own, so numbering favours them.
        if (href && links.length < MAX_LINKS * 2) links.push({ n: 0, text: node.name || node.inline || href, href, ref: `${furniture ? '~' : ''}${ref}` });
        seenRefs.add(ref);
      } else if (ACTIONABLE[node.role] && !furniture) {
        const label = node.name || node.props.placeholder || node.inline || node.role;
        const value = node.role === 'combobox' ? node.children.filter(child => child.role === 'option').map(child => `${child.name}${child.attrs.selected ? ' (selected)' : ''}`).join(', ') : undefined;
        elements.push({ n: 0, role: `${node.role} (${ACTIONABLE[node.role]})`, label, ref, ...(value ? { value } : {}) });
        seenRefs.add(ref);
      }
    }
    for (const child of node.children) walk(child, furniture);
  };
  for (const root of roots) walk(root, false);
  // Content links first, then the furniture's, then the cap — and the markers come off.
  const ordered = [...links.filter(link => !link.ref.startsWith('~')), ...links.filter(link => link.ref.startsWith('~'))].slice(0, MAX_LINKS);
  ordered.forEach((link, index) => { link.n = index + 1; link.ref = link.ref.replace(/^~/, ''); });
  const kept = elements.slice(0, MAX_ELEMENTS);
  kept.forEach((element, index) => { element.n = index + 1; });
  const body = roots.map(root => gatherText(root, false)).join('\n').trim();
  // A page that is all furniture still has to say something.
  const fallback = body || roots.map(root => gatherText(root, true)).join('\n').trim();
  return { url, title, text: fallback, links: ordered, elements: kept };
}

function resolveHref(href: string, base: string): string {
  if (!href) return '';
  try {
    return new URL(href, base || undefined).href;
  } catch {
    return href.startsWith('http') ? href : '';
  }
}

/**
 * The reading as she is handed it: one part of the text, the links, the
 * things to act on. `part` is 1-based; a page shorter than one part has one.
 */
export function formatReading(page: PageReading, part = 1): { text: string; part: number; parts: number; links: string; elements: string } {
  const parts = Math.max(1, Math.min(MAX_PARTS, Math.ceil(page.text.length / PART_CHARS)));
  const at = Math.min(parts, Math.max(1, Math.round(part)));
  const text = page.text.slice((at - 1) * PART_CHARS, at * PART_CHARS);
  const links = page.links.map(link => `[${link.n}] ${link.text.slice(0, 80)} (${shortUrl(link.href)})`).join('\n');
  const elements = page.elements.map(element => `[${element.n}] ${element.role}: ${element.label.slice(0, 80)}${element.value ? ` — ${element.value.slice(0, 120)}` : ''}`).join('\n');
  return { text, part: at, parts, links, elements };
}

function shortUrl(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname.length > 40 ? `${url.pathname.slice(0, 37)}…` : url.pathname;
    return `${url.hostname}${path === '/' ? '' : path}`;
  } catch {
    return href.slice(0, 60);
  }
}
