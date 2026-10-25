/**
 * Code-terminal bursts on her screen, after the old wallpaper (the user's recording of it, 2026-10-21): for about
 * five seconds, lines of code scramble in across the upper face and her eye, white with a faint glow, some running
 * off the edges and some mirrored; a few garbled specks come first, a block of large grey CJK glyphs flashes
 * across the face, the picture tears sideways in thin bands a couple of times, and it all fades.
 *
 * Most lines are decorative code in the original's flavour; one is real, resolving last and largest: the tool she
 * just used, or the file he is working in, with the lines he just wrote under it (electron/codeWatch.ts) on the eye
 * band, in order. PortraitWindow decides when (a tool call, or now and then while he
 * codes) and drives `tick` from its own frame loop; the layer lives on the glass, outside the swaying frame. The
 * tears are an SVG displacement filter the window puts on the frame while `tearing` is true (made here, under
 * `TEAR_FILTER`), and the same filter on this layer.
 */
export const TEAR_FILTER = 'portrait-tear';

// In the original's flavour: C++ stream and hex fragments.
const CODE = [
  'operator<<(ios_base&))', 'should be one of', 'Convert Into Hex=" ;', 'static_cast<long>(integer, hex)<<endl;',
  'std::cout << std::hex << value;', 'while (buffer.size() > 0) {', 'return (mask & 0x7f) >> shift;', 'if (!stream.good()) throw;',
  'uint32_t seed = state ^ 0x9e37;', 'for (auto& b : bytes) out << b;', 'template<class T> T read(istream&);', '#include <iomanip>',
  'case 0x1b: flush(); break;', 'printf("%08x\\n", addr);', '((&s, int base))', 'cin >> std::hex >> integer;',
];
const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>[](){};:=+-*&^%$#@!_|/.,"`~';
// The flash, by what started the burst.
const CJK = { tool: ['执行', '响应', '示响应'], coding: ['读取', '解析', '显示'] };

// The burst's clock, ms from its start: specks, lines resolving (each over LINE_MS, starting by LINES_BY), the
// glyph flash, the hold, the fade. A new tool call while it runs holds it EXTEND_MS more.
const SPECKS_MS = 900, LINE_MS = 700, LINES_BY = 900, CJK_AT = 1500, CJK_MS = 420, HOLD_MS = 4400, FADE_MS = 600, EXTEND_MS = 2500;
// Sizes at the 1440-wide window (scaled to the layer), as shares of the width measured in the recording (about
// 5.4%, 3.7% and 2%), the share of lines mirrored, and where they sit (share of the height): the upper face and
// the eye band.
const SIZES = { large: 78, medium: 53, tiny: 28 }, MIRRORED = 0.25, TOP = [0.05, 0.45];
// Lines take rows this far apart (share of the height), shuffled, so no two overlap; the real one sits on the eye band.
const ROW = 0.042, REAL_ROWS = [0.26, 0.43];
// While held, this share of a line's characters re-scramble each frame; tears last TEAR_MS.
const FLICKER = 0.02, TEAR_MS = 90;

/** `text` with the characters left of `progress` (0..1) final and the rest random code glyphs; spaces stay. */
export function scramble(text: string, progress: number, rand = Math.random): string {
  const fixed = Math.floor(Math.max(0, Math.min(1, progress)) * text.length);
  let out = text.slice(0, fixed);
  for (let i = fixed; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[Math.floor(rand() * GLYPHS.length)];
  return out;
}

/** The file in an editor's window title ("PortraitWindow.tsx - haru-desktop - Visual Studio Code"), else its first part. */
export function fileFromTitle(title: string): string {
  const file = title.match(/[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/);
  return (file ? file[0] : title.split(/ [-–—|] /)[0].trim()).slice(0, 48);
}

type Line = { el: HTMLDivElement; text: string; delay: number; dur: number; drift: number; mirror: boolean; shown: string; speck: boolean; real: boolean };
export type Terminal = {
  /** Starts a burst, or, during one, puts the real line (and his lines) in for the old and holds it longer. */
  burst(real?: { line: string; lines?: string[]; kind: 'tool' | 'coding' }): void;
  /** Per frame; returns whether the picture should be torn this frame. */
  tick(now: number, motion: number): boolean;
  readonly active: boolean;
  dispose(): void;
};

export function createTerminal(host: HTMLElement): Terminal {
  // The tear: a band of the picture displaced sideways, the band drawn into a small map each time.
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="${TEAR_FILTER}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
    <feImage result="map" preserveAspectRatio="none" x="0" y="0" width="100%" height="100%"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  host.appendChild(svg);
  const mapImage = svg.querySelector('feImage')!, displace = svg.querySelector('feDisplacementMap')!;
  const mapCanvas = document.createElement('canvas'); mapCanvas.width = 8; mapCanvas.height = 256;
  const drawTear = () => {
    const g = mapCanvas.getContext('2d')!;
    g.fillStyle = 'rgb(128,128,0)'; g.fillRect(0, 0, 8, 256);
    // One or two thin bands across the upper face, each pushed one way.
    for (let k = 0; k < 1 + Math.round(Math.random()); k++) {
      const y = 256 * (0.15 + 0.35 * Math.random()), h = 256 * (0.008 + 0.025 * Math.random());
      g.fillStyle = Math.random() < 0.5 ? 'rgb(255,128,0)' : 'rgb(0,128,0)'; g.fillRect(0, y, 8, h);
    }
    mapImage.setAttribute('href', mapCanvas.toDataURL());
    displace.setAttribute('scale', String(Math.round((0.04 + 0.06 * Math.random()) * host.clientWidth)));
  };

  let lines: Line[] = [], start = 0, holdEnd = 0, tears: number[] = [], cjk: HTMLDivElement | null = null, scan: HTMLDivElement | null = null;
  let kind: 'tool' | 'coding' = 'tool', rows: number[] = [], band: number[] = [];
  const clear = () => { for (const l of lines) l.el.remove(); cjk?.remove(); scan?.remove(); lines = []; cjk = scan = null; };
  const addLine = (text: string, size: keyof typeof SIZES, delay: number, real = false, speck = false) => {
    const W = host.clientWidth, H = host.clientHeight, el = document.createElement('div');
    el.className = `portrait-term-line${real ? ' real' : ''}`;
    el.style.fontSize = `${(SIZES[size] * W / 1440).toFixed(1)}px`;
    // Real lines take the eye band's rows top down (kept for them), the rest the next shuffled row; specks (gone
    // before the lines are up) and lines past the last row go anywhere.
    const row = real && band.length ? band.shift()! : rows.length && !speck ? rows.shift()! : TOP[0] + (TOP[1] - TOP[0]) * Math.random();
    el.style.top = `${(row * H).toFixed(0)}px`;
    // Overhanging one edge, as in the original: started off the left, or late enough to run off the right.
    el.style.left = `${((Math.random() < 0.5 ? -0.05 - 0.25 * Math.random() : 0.35 + 0.4 * Math.random()) * W).toFixed(0)}px`;
    if (real) el.style.left = `${(0.04 * W).toFixed(0)}px`;
    el.style.opacity = '0';
    host.appendChild(el);
    lines.push({ el, text, delay, dur: speck ? 1 : LINE_MS, drift: (Math.random() * 2 - 1) * 6, mirror: !real && Math.random() < MIRRORED, shown: '', speck, real });
  };
  // The real line large, his lines under it a size down, each a beat after the last.
  const addReal = (real: { line: string; lines?: string[] }, delay: number) => {
    addLine(real.line, 'large', delay, true);
    (real.lines ?? []).forEach((text, k) => addLine(text, 'medium', delay + 150 * (k + 1), true));
  };

  return {
    get active() { return lines.length > 0; },
    burst(real) {
      const now = performance.now();
      if (lines.length && now < holdEnd) {
        // During a burst: the new real lines resolve in where the old ones were, and the burst holds on for them.
        if (real) {
          for (const l of lines) if (l.real) l.el.remove();
          lines = lines.filter(l => !l.real);
          band = rows.filter(y => y >= REAL_ROWS[0] && y <= REAL_ROWS[1]).sort((p, q) => p - q);
          addReal(real, now - start + 100);
        }
        holdEnd = Math.max(holdEnd, now + EXTEND_MS);
        return;
      }
      clear();
      start = now; holdEnd = now + HOLD_MS; kind = real?.kind ?? 'tool';
      const all = Array.from({ length: Math.floor((TOP[1] - TOP[0]) / ROW) + 1 }, (_, k) => TOP[0] + k * ROW);
      // The eye band's rows are kept for the real lines when there are any; the rest are dealt out shuffled.
      band = real ? all.filter(y => y >= REAL_ROWS[0] && y <= REAL_ROWS[1]) : [];
      rows = all.filter(y => !band.includes(y)).sort(() => Math.random() - 0.5);
      const pick = [...CODE].sort(() => Math.random() - 0.5).slice(0, 6 + Math.round(Math.random() * 2));
      for (let k = 0; k < 4; k++) addLine(scramble('x'.repeat(3 + Math.floor(Math.random() * 6)), 0), 'tiny', 100 + 120 * k, false, true);
      pick.forEach((text, k) => addLine(text, (['large', 'medium', 'medium', 'tiny'] as const)[k % 4], 300 + (LINES_BY - 300) * k / pick.length));
      if (real) addReal(real, LINES_BY + 200);
      tears = [CJK_AT + 60, 2500 + 600 * Math.random(), 3300 + 700 * Math.random()];
      cjk = document.createElement('div'); cjk.className = 'portrait-term-cjk';
      cjk.textContent = CJK[kind][Math.floor(Math.random() * CJK[kind].length)];
      cjk.style.fontSize = `${(0.22 * host.clientWidth).toFixed(0)}px`; cjk.style.top = `${(0.27 * host.clientHeight).toFixed(0)}px`;
      cjk.style.visibility = 'hidden'; host.appendChild(cjk);
      scan = document.createElement('div'); scan.className = 'portrait-term-scan';
      scan.style.top = `${((0.2 + 0.2 * Math.random()) * host.clientHeight).toFixed(0)}px`; scan.style.visibility = 'hidden'; host.appendChild(scan);
    },
    tick(now, motion) {
      if (!lines.length) return false;
      const t = now - start, end = holdEnd - start + FADE_MS;
      if (t > end) { clear(); return false; }
      const fade = t > holdEnd - start ? 1 - (t - (holdEnd - start)) / FADE_MS : 1;
      for (const l of lines) {
        // Specks are gone once the lines are up; still, everything simply fades in and out.
        const p = motion ? (t - l.delay) / l.dur : t >= l.delay ? 1 : 0;
        const on = t >= l.delay && (!l.speck || t < SPECKS_MS);
        const text = !on ? '' : l.speck ? scramble(l.text, 0) : p < 1 ? scramble(l.text, p) : motion && Math.random() < FLICKER * l.text.length / 10
          ? scramble(l.text, 1 - 2 / Math.max(2, l.text.length)) : l.text;
        if (text !== l.shown) { l.el.textContent = text; l.shown = text; }
        l.el.style.opacity = on ? fade.toFixed(2) : '0';
        l.el.style.transform = `translateX(${(motion * l.drift * t / 1000).toFixed(1)}px)${l.mirror ? ' scaleX(-1)' : ''}`;
      }
      if (cjk) cjk.style.visibility = motion && t >= CJK_AT && t < CJK_AT + CJK_MS ? 'visible' : 'hidden';
      if (scan) scan.style.visibility = motion && t >= CJK_AT && t < CJK_AT + 700 ? 'visible' : 'hidden';
      const tearing = motion > 0 && tears.some(at => t >= at && t < at + TEAR_MS);
      if (tearing && host.style.filter === '') drawTear();
      host.style.filter = tearing ? `url(#${TEAR_FILTER})` : '';
      return tearing;
    },
    dispose() { clear(); svg.remove(); host.style.filter = ''; },
  };
}
