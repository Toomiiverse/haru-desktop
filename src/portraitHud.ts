import { scramble } from './portraitTerminal';
import { createSingAlong, type Line, type Mouth } from './portraitSing';

/**
 * Spin on her screen, Jarvis-style: a holographic panel she calls up when asked for music (server tool `music` → main
 * → electron/spin.ts → 'portrait:music' events) and works by voice. It sits in the free space over her fringe, above
 * her eyes (the close-up's visor zone, top left), tilted a little in depth and drifting with her head. Opening, its
 * lines draw in from the corner nearest her eye, the cover and the ring fill in, the title resolves out of scrambled
 * glyphs; each command flashes its word and pulses the ring; "that's enough" folds it into a small glyph in the corner
 * that breathes with the music. Everything is drawn in 1440-wide window px and scaled to the window.
 */
export type MusicEvent = { type: string } & Record<string, unknown>;
type Song = { id: string; title: string; artist: string; album: string; artUrl: string };
type State = { playing: boolean; position: number; at: number; duration: number; volume: number; song: Song | null; upNext: { title: string; artist: string }[] };

// The panel's box on the 1440x2560 window (the visor zone, clear of her brow, eyes and mouth), its art and ring.
const BOX = { x: 44, y: 70, w: 740, h: 560 };
const ART = { cx: 196, cy: 250, r: 118 };
const BANDS = 16;
// Where her eyes go to look at it (gaze units), how long she looks when it opens or acts, and her glances at it while
// the music plays.
const LOOK = { x: -0.32, y: -0.95 }, LOOK_OPEN_MS = 2600, LOOK_COMMAND_MS = 1700, GLANCE_S = [9, 20], GLANCE_MS = [900, 1600];
const OPEN_MS = 1100, FOLD_MS = 650, FLASH_MS = 1400;
const WORDS: Record<string, string> = {
  open: 'SPIN // ONLINE', play: 'QUEUEING', pause: 'PAUSED', resume: 'RESUMING', next: 'NEXT ▸▸', previous: '◂◂ BACK',
  volume_up: 'VOLUME ▲', volume_down: 'VOLUME ▼',
};
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  return `M${p(from)} A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${p(to)}`;
};
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export function createHud(host: HTMLElement) {
  const sing = createSingAlong();
  const root = document.createElement('div');
  root.className = 'hud';
  const glyph = document.createElement('div');
  glyph.className = 'hud-glyph';
  host.append(root, glyph);

  // The frame: brackets, rails and ticks (each a path drawn in by its dash), the ring around the cover, the spectrum.
  const frame = svg('svg', { class: 'hud-frame', viewBox: `0 0 ${BOX.w} ${BOX.h}` });
  const lines: SVGPathElement[] = [];
  const line = (d: string, cls = '') => { const p = svg('path', { d, pathLength: 1, class: `hud-line ${cls}` }) as SVGPathElement; frame.append(p); lines.push(p); return p; };
  const W = BOX.w, H = BOX.h;
  // The glass behind it: a dark visor pane with clipped corners and a faint grid, so the light reads over her hair.
  const C = 34;
  frame.append(svg('path', { class: 'hud-glass', d: `M${C} 0 H${W - C} L${W} ${C} V${H - C} L${W - C} ${H} H${C} L0 ${H - C} V${C} Z` }));
  line(`M2 64 V2 H90`); line(`M${W - 90} 2 H${W - 2} V64`); line(`M2 ${H - 64} V${H - 2} H90`); line(`M${W - 90} ${H - 2} H${W - 2} V${H - 64}`);
  line(`M120 2 H${W - 120}`, 'faint'); line(`M2 96 V${H - 96}`, 'faint');
  line(arc(ART.cx, ART.cy, ART.r + 14, -Math.PI * 0.95, Math.PI * 0.7));
  line(arc(ART.cx, ART.cy, ART.r + 30, Math.PI * 0.8, Math.PI * 1.9), 'accent');
  line(`M${ART.cx + ART.r + 50} ${ART.cy - 70} H${W - 40}`, 'faint');
  line(`M${ART.cx + ART.r + 50} ${ART.cy + 92} H${W - 40}`, 'faint');
  for (let i = 0; i <= 20; i++) line(`M${360 + i * 17} ${H - 92} v${i % 5 ? 8 : 16}`, 'tick');
  const progress = svg('path', { class: 'hud-progress', d: `M360 ${H - 70} H${W - 40}`, pathLength: 1 }) as SVGPathElement;
  const volume = svg('g', { class: 'hud-volume' });
  for (let i = 0; i < 10; i++) volume.append(svg('rect', { x: W - 40 - (10 - i) * 15, y: H - 128 - (6 + i * 2.4), width: 10, height: 6 + i * 2.4 }));
  const ring = svg('g', { class: 'hud-ring' });
  const spokes: SVGLineElement[] = [];
  for (let i = 0; i < BANDS * 2; i++) {
    const s = svg('line', { class: 'hud-spoke' }) as SVGLineElement;
    ring.append(s); spokes.push(s);
  }
  const spin = svg('path', { class: 'hud-spin', d: arc(ART.cx, ART.cy, ART.r + 6, 0, Math.PI * 0.5) + arc(ART.cx, ART.cy, ART.r + 6, Math.PI, Math.PI * 1.35) });
  frame.append(progress, volume, ring, spin);

  const art = document.createElement('div');
  art.className = 'hud-art';
  const img = document.createElement('img');
  img.alt = ''; img.crossOrigin = 'anonymous';
  art.append(img);
  const text = (cls: string) => { const el = document.createElement('div'); el.className = cls; root.append(el); return el; };
  root.append(frame, art);
  const status = text('hud-status'), title = text('hud-title'), artist = text('hud-artist'), lyric = text('hud-lyric'), time = text('hud-time'), next = text('hud-next');

  let state: State | null = null, levels = new Array(BANDS).fill(0), level = 0;
  let open = false, openedAt = 0, foldedAt = 0, flash = '', flashAt = 0, lookUntil = 0, nextGlance = 0, nod = false;
  let shownTitle = '', titleAt = 0, notice = '';
  const place = () => {
    const s = host.clientWidth / 1440;
    root.style.setProperty('--s', String(s)); glyph.style.setProperty('--s', String(s));
    Object.assign(root.style, { left: `${BOX.x * s}px`, top: `${BOX.y * s}px`, width: `${BOX.w * s}px`, height: `${BOX.h * s}px` });
  };
  place();
  addEventListener('resize', place);

  function show(now: number) {
    if (!open) { open = true; openedAt = now; root.classList.add('on'); glyph.classList.remove('on'); }
    lookUntil = Math.max(lookUntil, now + LOOK_OPEN_MS);
  }

  return {
    sing,
    get open() { return open; },
    event(event: MusicEvent) {
      const now = performance.now();
      if (event.type === 'state') {
        state = event as unknown as State;
        sing.setState({ playing: state.playing, position: state.position, at: state.at, id: state.song?.id });
        if (state.song && img.dataset.src !== state.song.artUrl) { img.dataset.src = state.song.artUrl; img.src = state.song.artUrl; }
        if (state.song && state.song.title !== shownTitle) { shownTitle = state.song.title; titleAt = now; }
        notice = '';
      } else if (event.type === 'track') sing.setTrack(String(event.id), (event.mouth as Mouth | null) ?? null, (event.lines as Line[]) ?? []);
      else if (event.type === 'levels') { levels = (event.bands as number[]) ?? levels; level = Number(event.level) || 0; }
      else if (event.type === 'notice') { notice = String(event.text ?? ''); flash = 'NO MATCH'; flashAt = now; }
      else if (event.type === 'open') { show(now); flash = WORDS[String(event.action)] ?? WORDS.open; flashAt = now; nod = true; }
      else if (event.type === 'command') { if (!open) show(now); flash = WORDS[String(event.action)] ?? ''; flashAt = now; lookUntil = now + LOOK_COMMAND_MS; nod = true; }
      else if (event.type === 'fold' && open) { open = false; foldedAt = now; root.classList.remove('on'); flash = ''; lookUntil = now + 900; }
      else if (event.type === 'gone') { sing.stop(); levels = new Array(BANDS).fill(0); level = 0; }
    },
    /** Per frame: draw, and say where she should look (gaze units) and whether to nod (a command, or a beat). */
    tick(now: number, motion: number, drift: { x: number; y: number }) {
      const out = { look: null as { x: number; y: number } | null, nod: false, beat: false };
      // Opening draws in, folding draws back out; then it rests (on) or lies folded as the glyph.
      const t = open ? Math.min(1, (now - openedAt) / (motion ? OPEN_MS : 1)) : 1 - Math.min(1, (now - foldedAt) / (motion ? FOLD_MS : 1));
      if (!open && t <= 0 && foldedAt && !glyph.classList.contains('on')) glyph.classList.add('on');
      if (t <= 0 && !open) { root.style.visibility = 'hidden'; } else root.style.visibility = '';
      lines.forEach((p, i) => { p.style.strokeDashoffset = String(Math.max(0, 1 - Math.min(1, t * 1.6 - i * 0.03))); });
      const fill = Math.max(0, Math.min(1, (t - 0.35) / 0.4));
      root.style.setProperty('--fill', fill.toFixed(3));
      // Tilted in depth, drifting with her head a little (Jarvis's visor), flickering as it comes and goes.
      const flicker = motion && t < 1 && Math.random() < 0.12 ? 0.55 : 1;
      root.style.opacity = String(Math.min(1, t * 2.2) * flicker);
      root.style.transform = `translate(${(drift.x * 0.35).toFixed(1)}px, ${(drift.y * 0.35).toFixed(1)}px) perspective(1600px) rotateY(${(9 * motion).toFixed(1)}deg) rotateX(${(3 * motion).toFixed(1)}deg)`;

      const song = state?.song;
      const playing = !!state?.playing;
      // The title resolves out of scrambled glyphs when it opens or the song changes; the rest follows it.
      const since = Math.max(0, now - Math.max(titleAt, openedAt + 450));
      title.textContent = song ? (motion ? scramble(song.title, Math.min(1, since / 700)) : song.title) : notice ? '' : 'NO DISC';
      artist.textContent = song ? (motion ? scramble(song.artist, Math.min(1, (since - 200) / 600)) : song.artist) : '';
      const pos = song ? sing.position() : 0;
      time.textContent = song ? `${clock(pos)} / ${clock(state!.duration)}` : '';
      progress.style.strokeDashoffset = String(1 - (song ? sing.progress(state!.duration) : 0));
      lyric.textContent = sing.line();
      next.textContent = state?.upNext?.[0] ? `NEXT · ${state.upNext[0].title}` : '';
      const vol = state ? Math.round(state.volume * 10) : 10;
      Array.from(volume.children).forEach((r, i) => r.classList.toggle('lit', i < vol));
      const flashing = flash && now - flashAt < FLASH_MS;
      status.textContent = flashing ? (motion ? scramble(flash, Math.min(1, (now - flashAt) / 260)) : flash) : notice || (playing ? 'SPIN // NOW PLAYING' : song ? 'SPIN // HOLD' : 'SPIN // STANDBY');
      root.classList.toggle('flash', !!flashing && now - flashAt < 220);
      // The spectrum around the cover, mirrored top and bottom; the arc turns faster with the music.
      for (let i = 0; i < spokes.length; i++) {
        const b = levels[i % BANDS] ?? 0, a = -Math.PI / 2 + (i / spokes.length) * Math.PI * 2;
        const r0 = ART.r + 40, r1 = r0 + 6 + b * 46 * fill;
        spokes[i].setAttribute('x1', (ART.cx + r0 * Math.cos(a)).toFixed(1)); spokes[i].setAttribute('y1', (ART.cy + r0 * Math.sin(a)).toFixed(1));
        spokes[i].setAttribute('x2', (ART.cx + r1 * Math.cos(a)).toFixed(1)); spokes[i].setAttribute('y2', (ART.cy + r1 * Math.sin(a)).toFixed(1));
      }
      spin.setAttribute('transform', `rotate(${((now / 1000) * (20 + level * 160) * motion % 360).toFixed(1)} ${ART.cx} ${ART.cy})`);
      art.classList.toggle('playing', playing);
      glyph.style.setProperty('--level', level.toFixed(3));

      // Where she looks: at it when it opens or acts, and now and then while it plays.
      if (open && playing && now >= nextGlance) {
        if (nextGlance) lookUntil = Math.max(lookUntil, now + GLANCE_MS[0] + Math.random() * (GLANCE_MS[1] - GLANCE_MS[0]));
        nextGlance = now + 1000 * (GLANCE_S[0] + Math.random() * (GLANCE_S[1] - GLANCE_S[0]));
      }
      if (now < lookUntil) out.look = LOOK;
      out.nod = nod; nod = false;
      out.beat = open && sing.beat();
      return out;
    },
    dispose() { removeEventListener('resize', place); root.remove(); glyph.remove(); },
  };
}
export type Hud = ReturnType<typeof createHud>;
