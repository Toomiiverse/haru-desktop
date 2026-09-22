import { useEffect, useRef } from 'react';
import {
  adaptEmotion,
  DEFAULT_TRANSITION_MS,
  EASE_OUT_CSS,
  emotionConfig,
  HARU_EMOTIONS,
  MOOD_TO_EMOTION,
} from '../../electron/emotions';
import type { MouthReading } from '../companion/mouth';
import type { Gaze } from '../companion/behaviour';

/**
 * Her face, on the desk.
 *
 * The phone page's own SVG avatar — the same artwork, the same engine, the same
 * blink calendar and wander — brought into the companion window in place of the
 * 3D body. The page builds this from a string served over HTTP and fetches each
 * face from /emotions; here the faces are bundled at build time (import.meta.glob)
 * so nothing has to be running behind the window, and the engine is the same
 * code, ported rather than rewritten.
 *
 * What the desktop loses with the model is everything that was about a body in a
 * room: perching, jumping, the wardrobe, lip sync against the audio. What is kept
 * is what the face is for — how she feels, where she looks, and how she holds
 * herself while she does it.
 */
export type SvgAvatarHandle = {
  /** A mood word or a face name; null settles back to neutral. */
  expression(name: string | null): void;
  /** Action names from the life loop have no clip here; kept so the wiring is uniform. */
  play(name: string): void;
  /** True while the point is over her, so the desk knows the pointer is on her. */
  hitTest(x: number, y: number): boolean;
  notify(): void;
  attend(why: string, ms?: number): void;
};

interface Props {
  className?: string;
  onError(message: string): void;
  onReady(handle: SvgAvatarHandle | null): void;
  onFit(width: number): void;
  read?(): { mouth: MouthReading; gaze: Gaze };
}

type IdleMotion = { periodMs: number; bobPx: number; swayDeg: number; breath: number };
type FacePose = { tiltDeg: number; roam: number; leanDeg: number };

const NAMES = HARU_EMOTIONS as readonly string[];
const LABELS: Record<string, string> = Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].label]));
const TRANSITIONS: Record<string, string> = Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].transition]));
const IDLE: Record<string, IdleMotion> = Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].idle]));
const GAZE: Record<string, number> = Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].gaze]));
const BLINKS: Record<string, boolean> = Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].blink]));
const POSES: Record<string, FacePose> = Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].pose]));
const ADAPT: Record<string, string> = MOOD_TO_EMOTION as unknown as Record<string, string>;

// One file per face, beside the others and served as-is by the page. The glob
// keys are the literal pattern paths, so they are re-keyed by file name.
const FACE_FILES = import.meta.glob('../../build/emotions/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FACE_SOURCE: Record<string, string> = {};
for (const [path, text] of Object.entries(FACE_FILES)) {
  const match = /([^/\\]+)\.svg$/.exec(path);
  if (match) FACE_SOURCE[match[1]] = text;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const hashN = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

type EngineSample = {
  emotion: string;
  previousEmotion: string | null;
  transitionProgress: number;
  opacity: number;
  previousOpacity: number;
  transitioning: boolean;
};

/** The engine, pure and clock-free, exactly as the page runs it. */
function createEmotionEngine(duration: () => number) {
  let emotion = 'neutral', previous: string | null = null, startedAt = -Infinity, leavingFrom = 0, arrivingFrom = 1;
  const progress = (t: number) => {
    const d = previous === null ? 0 : (TRANSITIONS[emotion] === 'cut' ? 0 : duration());
    return d <= 0 ? 1 : clamp((t - startedAt) / d, 0, 1);
  };
  const engine = {
    sample(t: number): EngineSample {
      const p = easeOut(progress(t));
      const opacity = arrivingFrom + (1 - arrivingFrom) * p;
      const previousOpacity = previous === null ? 0 : leavingFrom * (1 - p);
      return { emotion, previousEmotion: previous, transitionProgress: p, opacity, previousOpacity, transitioning: p < 1 };
    },
    idle(t: number) {
      const m = IDLE[emotion] || IDLE.neutral;
      const phase = (t / m.periodMs) * TAU;
      return { bob: Math.sin(phase) * m.bobPx, sway: Math.sin(phase * 0.5 + 1.3) * m.swayDeg, breath: 1 + (1 - Math.cos(phase)) / 2 * m.breath, periodMs: m.periodMs };
    },
    gaze(t: number) {
      const beat = Math.floor(t / 2400);
      const r = hashN(beat), a = hashN(beat + 1000) * TAU, d = 0.35 + hashN(beat + 2000) * 0.65;
      const looking = r > 0.45;
      const x = (looking ? Math.cos(a) * d : 0) + Math.sin(t / 2300) * 0.06;
      const y = (looking ? Math.sin(a) * d * 0.6 : 0) + Math.sin(t / 3100 + 1) * 0.04;
      return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), looking, beat };
    },
    nextBlink(t: number) {
      let at = 1400, k = 0;
      while (k < 100000) {
        if (at >= t) return at;
        const double = hashN(k + 5000) < 0.18;
        if (double && at + 240 >= t) return at + 240;
        at += 1900 + hashN(k) * 2700 + (double ? 240 : 0); k++;
      }
      return at;
    },
    blink(t: number) {
      if (!BLINKS[emotion]) return 1;
      let at = 1400, k = 0;
      while (k < 100000 && at + 400 < t) { const double = hashN(k + 5000) < 0.18; at += 1900 + hashN(k) * 2700 + (double ? 240 : 0); k++; }
      const lid = (start: number) => { const u = t - start; if (u < 0 || u > 180) return 1; return u < 70 ? 1 - (u / 70) * 0.9 : 0.1 + ((u - 70) / 110) * 0.9; };
      const second = hashN(k + 5000) < 0.18 ? lid(at + 240) : 1;
      return Math.min(lid(at), second);
    },
    blinks: () => !!BLINKS[emotion],
    pose(t: number) {
      const m = POSES[emotion] || POSES.neutral;
      const beat = Math.floor(t / 5200), phase = (t - beat * 5200) / 5200;
      const r = hashN(beat + 3000), posed = r > 0.4 && phase < 0.62;
      const sign = hashN(beat + 4000) < 0.5 ? -1 : 1, amount = 0.4 + hashN(beat + 5000) * 0.6;
      const a = hashN(beat + 6000) * TAU, d = hashN(beat + 7000);
      return {
        tilt: m.leanDeg + (posed ? sign * amount * m.tiltDeg : 0),
        dx: posed ? Math.cos(a) * d * m.roam : 0,
        dy: posed ? Math.sin(a) * d * m.roam * 0.6 : 0,
        posed, beat,
      };
    },
    set(next: string, t: number) {
      if (NAMES.indexOf(next) < 0) next = 'neutral';
      if (next === emotion) return false;
      const now = engine.sample(t);
      previous = emotion; emotion = next; startedAt = t;
      leavingFrom = now.opacity; arrivingFrom = 0;
      return true;
    },
    emotion: () => emotion,
    duration,
  };
  return engine;
}

// The bounding box of a path, walking its commands, relative ones included.
function pathBox(d: string) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, cmd: string | null = null, x = 0, y = 0, sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  const mark = (px: number, py: number) => { if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py; n++; };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) { cmd = t; i++; continue; }
    if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'M') { const px = num(), py = num(); x = rel ? x + px : px; y = rel ? y + py : py; sx = x; sy = y; mark(x, y); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { const px = num(), py = num(); x = rel ? x + px : px; y = rel ? y + py : py; mark(x, y); }
    else if (C === 'H') { const px = num(); x = rel ? x + px : px; mark(x, y); }
    else if (C === 'V') { const py = num(); y = rel ? y + py : py; mark(x, y); }
    else if (C === 'C') { const ox = rel ? x : 0, oy = rel ? y : 0; mark(ox + num(), oy + num()); mark(ox + num(), oy + num()); x = ox + num(); y = oy + num(); mark(x, y); }
    else if (C === 'S' || C === 'Q') { const ox = rel ? x : 0, oy = rel ? y : 0; mark(ox + num(), oy + num()); x = ox + num(); y = oy + num(); mark(x, y); }
    else if (C === 'T') { const ox = rel ? x : 0, oy = rel ? y : 0; x = ox + num(); y = oy + num(); mark(x, y); }
    else if (C === 'A') { const ox = rel ? x : 0, oy = rel ? y : 0; i += 5; x = ox + num(); y = oy + num(); mark(x, y); }
    else if (C === 'Z') { x = sx; y = sy; }
    else { i++; }
  }
  return n ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } : null;
}

type Box = NonNullable<ReturnType<typeof pathBox>>;
type FoundEyes = [Element, Element] | null;

// A path or rect that covers the whole canvas is a backdrop, not her.
function coversCanvas(el: Element, box: Box | null, x: number, y: number, w: number, h: number) {
  if (el.nodeName.toLowerCase() === 'rect') return Number(el.getAttribute('x') || 0) <= x && Number(el.getAttribute('y') || 0) <= y && Number(el.getAttribute('width')) >= w && Number(el.getAttribute('height')) >= h;
  return !!box && box.x0 <= x + 1 && box.y0 <= y + 1 && box.x1 >= x + w - 1 && box.y1 >= y + h - 1 && (el.getAttribute('d') || '').length < 200;
}

// Her eyes: two small shapes, one each side of the middle, level with each
// other. By shape alone — the artwork's face is the dark silhouette and the eyes
// are the same pink as the mouth, so colour says nothing.
function findEyes(paths: { el: Element; box: Box | null }[], W: number, H: number): FoundEyes {
  const band = paths.filter(p => p.box && p.box.w < W * 0.16 && p.box.h < H * 0.16 && p.box.cy > H * 0.58 && p.box.cy < H * 0.74);
  const left = band.filter(p => p.box!.cx > W * 0.32 && p.box!.cx < W * 0.46);
  const right = band.filter(p => p.box!.cx > W * 0.54 && p.box!.cx < W * 0.68);
  let best: FoundEyes = null, score = 0;
  for (const a of left) for (const b of right) {
    if (Math.abs(a.box!.cy - b.box!.cy) > H * 0.04 || Math.abs(a.box!.w - b.box!.w) > W * 0.06 || Math.abs(a.box!.h - b.box!.h) > H * 0.06) continue;
    const area = a.box!.w * a.box!.h + b.box!.w * b.box!.h;
    if (area > score) { score = area; best = [a.el, b.el]; }
  }
  return best;
}

export function SvgAvatarCanvas({ className = '', onError, onReady, onFit, read }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onError, onReady, onFit, read });
  callbacks.current = { onError, onReady, onFit, read };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const finePointer = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);

    container.innerHTML = '<div id="avatar" role="img" aria-label="' + LABELS.neutral + '"><div id="avatar-pose"><div id="avatar-body"><div class="face"></div><div class="face"></div></div></div></div>';
    const box = container.querySelector('#avatar') as HTMLElement;
    const body = container.querySelector('#avatar-body') as HTMLElement;
    const poseEl = container.querySelector('#avatar-pose') as HTMLElement;
    const faces = Array.from(container.querySelectorAll<HTMLElement>('.face'));
    const engine = createEmotionEngine(() => (reduced ? 0 : DEFAULT_TRANSITION_MS));
    const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    let front = 0, resting = 'neutral', timer: ReturnType<typeof setTimeout> | null = null, frozenAt: number | null = null, request = 0;
    let eyes: FoundEyes = null, mounted = false;
    const cache: Record<string, string> = { ...FACE_SOURCE };

    function load(name: string): Promise<string> {
      if (cache[name] !== undefined) return Promise.resolve(cache[name]);
      return Promise.reject(Error('face ' + name + ' is not in the bundle'));
    }
    function mount(layer: HTMLElement, text: string): FoundEyes {
      const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('not a face');
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      let found: FoundEyes = null;
      if (vb.length === 4) {
        const paths: { el: Element; box: Box | null }[] = [];
        for (const el of Array.from(svg.querySelectorAll('path, rect'))) {
          const b = el.nodeName.toLowerCase() === 'path' ? pathBox(el.getAttribute('d') || '') : null;
          if (coversCanvas(el, b, vb[0], vb[1], vb[2], vb[3])) { el.setAttribute('class', 'backdrop'); continue; }
          paths.push({ el, box: b });
        }
        found = findEyes(paths, vb[2], vb[3]);
        if (found) for (const eye of found) eye.setAttribute('class', 'eye');
      }
      layer.replaceChildren(document.adoptNode(svg));
      return found;
    }
    function idleFor(name: string) {
      const m = IDLE[name] || IDLE.neutral;
      box.style.setProperty('--idle-bob', m.bobPx + 'px'); box.style.setProperty('--idle-sway', m.swayDeg + 'deg'); box.style.setProperty('--idle-breath', String(1 + m.breath));
    }
    function paint(frame: EngineSample, animate: boolean) {
      const fore = faces[front], back = faces[1 - front];
      const ease = animate && !reduced && engine.duration() > 0 ? 'opacity ' + engine.duration() + 'ms ' + EASE_OUT_CSS : 'none';
      fore.style.transition = ease; back.style.transition = ease;
      fore.style.opacity = animate ? '1' : String(frame.opacity);
      back.style.opacity = animate ? '0' : String(frame.previousOpacity);
      fore.classList.add('on'); back.classList.remove('on');
    }
    function replay(el: HTMLElement, cls: string) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
    function show(name: string, t: number) {
      const changed = engine.set(name, t);
      if (!changed && mounted) return;
      const frame = engine.sample(t);
      const mine = ++request;
      box.setAttribute('aria-label', LABELS[frame.emotion] || ('Haru feeling ' + frame.emotion));
      const incoming = faces[1 - front];
      load(frame.emotion).then(text => {
        if (mine !== request) return;
        incoming.classList.remove('missing');
        eyes = mount(incoming, text);
        front = 1 - front;
        mounted = true;
        idleFor(frame.emotion);
        paint(frozenAt === null ? frame : engine.sample(frozenAt), frozenAt === null);
        if (!reduced && frozenAt === null) replay(body, 'changed');
        look(); scheduleBlink();
      }).catch(() => { if (mine === request) { incoming.replaceChildren(); incoming.classList.add('missing'); } });
    }
    function settleBack(ms: number) { if (timer) clearTimeout(timer); timer = setTimeout(() => show(resting, clock()), ms); }
    const POKES: Record<string, [string, number]> = { exclaim: ['angry', 2000], burst: ['surprised', 1600], orbit: ['excited', 1600], comet: ['surprised', 1600], play: ['happy', 1600] };

    // ---- attention: where the eyes go, and why ----------------------------
    // The desktop already decides where she looks — cursor, screen watching, the
    // wander, what she is doing — and hands it down through read(). That target
    // wins; the engine's own wander is the fallback for when nothing is reading.
    const RANGE_X = 34, RANGE_Y = 18;
    let claim: { why: string } | null = null, claimUntil = 0, pointer: { x: number; y: number } | null = null, pointerAt = 0;
    function engineTarget(t: number) {
      const strength = GAZE[engine.emotion()] === undefined ? 1 : GAZE[engine.emotion()];
      if (!strength) return { x: 0, y: 0, why: 'fixed' };
      if (pointer && t - pointerAt < 4000) return { x: pointer.x, y: pointer.y, why: 'pointer' };
      if (claim && t < claimUntil) return claim.why === 'typing' ? { x: 0.15, y: 0.9, why: 'typing' } : claim.why === 'talking' ? { x: 0, y: 0.15, why: 'talking' } : { x: 0, y: 0, why: claim.why };
      if (engine.emotion() === 'thinking') return { x: -0.7, y: -0.8, why: 'thinking' };
      const g = engine.gaze(t);
      return { x: g.x * strength, y: g.y * strength, why: g.looking ? 'looking' : 'resting' };
    }
    function target(t: number) {
      const strength = GAZE[engine.emotion()] === undefined ? 1 : GAZE[engine.emotion()];
      if (!strength) return { x: 0, y: 0, why: 'fixed' };
      const gaze = callbacks.current.read?.().gaze;
      if (gaze && Number.isFinite(gaze.x) && Number.isFinite(gaze.y)) return { x: clamp(gaze.x * strength, -1, 1), y: clamp(gaze.y * strength, -1, 1), why: 'desk' };
      return engineTarget(t);
    }
    function look() {
      if (frozenAt !== null || reduced) {
        box.style.setProperty('--gaze-x', '0px'); box.style.setProperty('--gaze-y', '0px');
        const still = frozenAt === null ? { tilt: 0, dx: 0, dy: 0 } : engine.pose(frozenAt);
        poseEl.style.setProperty('--tilt', still.tilt.toFixed(2) + 'deg'); poseEl.style.setProperty('--drift-x', still.dx.toFixed(3)); poseEl.style.setProperty('--drift-y', still.dy.toFixed(3));
        return;
      }
      const t = clock(), at = target(t), p = engine.pose(t);
      box.style.setProperty('--gaze-x', (at.x * RANGE_X).toFixed(1) + 'px');
      box.style.setProperty('--gaze-y', (at.y * RANGE_Y).toFixed(1) + 'px');
      poseEl.style.setProperty('--tilt', p.tilt.toFixed(2) + 'deg');
      poseEl.style.setProperty('--drift-x', p.dx.toFixed(3)); poseEl.style.setProperty('--drift-y', p.dy.toFixed(3));
    }
    const gazeTimer = setInterval(look, 250);
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    function blinkNow() {
      box.style.setProperty('--lid', '0.1');
      blinkTimer = setTimeout(() => { box.style.setProperty('--lid', '1'); scheduleBlink(); }, 90);
    }
    function scheduleBlink() {
      if (blinkTimer) clearTimeout(blinkTimer); blinkTimer = null;
      if (reduced || frozenAt !== null || !engine.blinks()) { box.style.setProperty('--lid', '1'); return; }
      const now = clock();
      blinkTimer = setTimeout(blinkNow, Math.max(50, engine.nextBlink(now + 50) - now));
    }
    if (finePointer) {
      window.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        const r = box.getBoundingClientRect(); if (!r.width) return;
        const hw = Math.max(1, window.innerWidth / 2), hh = Math.max(1, window.innerHeight / 2);
        pointer = { x: clamp((e.clientX - (r.left + r.width / 2)) / hw, -1, 1), y: clamp((e.clientY - (r.top + r.height / 2)) / hh, -1, 1) }; pointerAt = clock();
      });
      document.addEventListener('pointerleave', () => { pointer = null; });
    }

    function fit() {
      const el = container as HTMLDivElement;
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      const side = Math.max(48, Math.round(Math.min(w, h) * 0.94));
      el.style.setProperty('--avatar-size', side + 'px');
      document.documentElement.style.setProperty('--haru-width', side + 'px');
      callbacks.current.onFit(side);
    }

    function expression(name: string | null) { resting = adaptEmotion(name); if (timer) clearTimeout(timer); show(resting, clock()); }
    function notify() {
      if (engine.emotion() === 'thinking') { if (timer) clearTimeout(timer); show(resting, clock()); }
      if (frozenAt !== null || reduced) return;
      replay(body, 'pop'); attend('talking', 2500);
    }
    function attend(why: string, ms?: number) { claim = why ? { why } : null; claimUntil = clock() + (ms === undefined ? 1500 : ms); look(); }

    const handle: SvgAvatarHandle = {
      expression,
      // The life loop's action names are all about a body she no longer has;
      // the face layer is the emotion handler above.
      play: () => {},
      hitTest: (x, y) => { const r = box.getBoundingClientRect(); return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; },
      notify,
      attend,
    };

    idleFor('neutral');
    show('neutral', clock());
    scheduleBlink();
    fit();
    const observer = new ResizeObserver(fit); observer.observe(container);
    callbacks.current.onReady(handle);

    return () => {
      observer.disconnect();
      clearInterval(gazeTimer);
      if (blinkTimer) clearTimeout(blinkTimer);
      if (timer) clearTimeout(timer);
      callbacks.current.onReady(null);
      container.replaceChildren();
    };
  // Built once: the host element does not change identity across renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className={'svg-avatar-canvas ' + className} ref={host} aria-label="Her face" />;
}
