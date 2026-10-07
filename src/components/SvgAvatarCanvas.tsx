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
import { idleMotion, settleSpring, hairMotionTarget, dragMotionTarget, depthMotionTarget } from '../companion/idle';
import { EXPRESSION_REACTIONS, SVG_REACTIONS, TAP_REACTIONS } from '../companion/svgReactions';
import { ANIMATION_SYMBOLS, EXPRESSION_SYMBOLS, HAIR_SYMBOLS, REACTION_SYMBOLS, hairSymbolFrames, symbolFrames } from '../companion/svgSymbols';

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
  /** Named face motions; unrelated body actions are ignored. */
  play(name: string): void;
  tap(): void;
  drag(point: { x: number; y: number } | null): void;
  /** Temporary manga marks or a fluid hair symbol; null clears it. */
  symbol(name: string | null): void;
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
  loadFace?(name: string): Promise<string>;
}

type IdleMotion = { periodMs: number; bobPx: number; swayDeg: number; breath: number };
type FacePose = { tiltDeg: number; roam: number; leanDeg: number };
type HairState = { el: SVGGraphicsElement; source: SVGGraphicsElement; origin: DOMPoint; stiffness: number; damping: number; limit: number; vertical: number; angle: number; speed: number; stretch: number; stretchSpeed: number; previous: { x: number; y: number; roll: number } | null };

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
const FACE_FILES = import.meta.env.HARU_PHONE_AVATAR ? {} : import.meta.glob('../../build/emotions/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
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

/** Face transitions are clock-free; spontaneous glances hold for varied intervals. */
function createEmotionEngine(duration: () => number) {
  let emotion = 'neutral', previous: string | null = null, startedAt = -Infinity, leavingFrom = 0, arrivingFrom = 1;
  let glanceAt = 1700, glance = { x: 0, y: 0 };
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
    gaze(t: number) {
      if (t >= glanceAt) {
        const angle = Math.random() * TAU, distance = Math.random() < .45 ? 0 : .2 + Math.random() * .4;
        glance = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance * .5 };
        glanceAt = t + 1900 + Math.random() * 3900;
      }
      return { ...glance, looking: !!(glance.x || glance.y) };
    },
    blinks: () => !!BLINKS[emotion],
    pose(t: number) {
      const m = POSES[emotion] || POSES.neutral;
      const beat = Math.floor(t / 5200), phase = (t - beat * 5200) / 5200;
      const r = hashN(beat + 3000), posed = r > 0.4 && phase < 0.62;
      const sign = hashN(beat + 4000) < 0.5 ? -1 : 1, amount = 0.4 + hashN(beat + 5000) * 0.6;
      const a = hashN(beat + 6000) * TAU, d = hashN(beat + 7000);
      return {
        tilt: m.leanDeg + (posed ? sign * amount * m.tiltDeg * .4 : 0),
        dx: posed ? Math.cos(a) * d * m.roam * .25 : 0,
        dy: posed ? Math.sin(a) * d * m.roam * .15 : 0,
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

export function SvgAvatarCanvas({ className = '', onError, onReady, onFit, read, loadFace }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onError, onReady, onFit, read, loadFace });
  callbacks.current = { onError, onReady, onFit, read, loadFace };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motionPreference.matches;
    const finePointer = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);

    container.innerHTML = '<div id="avatar" role="img" aria-label="' + LABELS.neutral + '"><div id="avatar-pose"><div class="avatar-depth"><div class="avatar-gesture"><div class="avatar-drag"><div id="avatar-body"><div class="face"></div><div class="face"></div><svg class="avatar-symbol-layer" viewBox="0 0 1254 1254" aria-hidden="true"></svg></div></div></div></div></div></div>';
    const box = container.querySelector('#avatar') as HTMLElement;
    const body = container.querySelector('#avatar-body') as HTMLElement;
    const poseEl = container.querySelector('#avatar-pose') as HTMLElement;
    const gestureEl = container.querySelector('.avatar-gesture') as HTMLElement;
    const depthEl = container.querySelector('.avatar-depth') as HTMLElement;
    const depthPose = [0, 0, 0], depthSpeed = [0, 0, 0];
    const dragEl = container.querySelector('.avatar-drag') as HTMLElement;
    let dragPoint: { x: number; y: number; at: number } | null = null;
    let dragVelocity = { x: 0, y: 0 };
    const dragShape = [1, 0, 1, 0], dragSpeed = [0, 0, 0, 0];
    let tapIndex = Math.floor(Math.random() * TAP_REACTIONS.length);
    const symbolLayer = container.querySelector('.avatar-symbol-layer') as SVGSVGElement;
    const symbolAnimations = new Set<Animation>();
    let symbolTimer: ReturnType<typeof setTimeout> | null = null;
    const animations = new Map<Element, Animation>();
    const reactionAnimations = new Set<Animation>();
    let reactionName = '', reactionStart = 0, reactionUntil = 0;
    const hairLayers = new Map<HTMLElement, HairState[]>();
    let hairFrame = 0, hairTime = 0;
    let lastMotion = -Infinity;
    const faces = Array.from(container.querySelectorAll<HTMLElement>('.face'));
    const engine = createEmotionEngine(() => (reduced ? 0 : DEFAULT_TRANSITION_MS));
    const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    let nextEarTwitch = clock() + 1800;
    let front = 0, resting = 'neutral', timer: ReturnType<typeof setTimeout> | null = null, frozenAt: number | null = null, request = 0;
    let eyes: FoundEyes = null, mounted = false;
    const cache: Record<string, string> = { ...FACE_SOURCE };

    function load(name: string): Promise<string> {
      if (cache[name] !== undefined) return Promise.resolve(cache[name]);
      if (callbacks.current.loadFace) return callbacks.current.loadFace(name).then(text => (cache[name] = text));
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
          if (el.closest('defs')) continue;
          const b = el.nodeName.toLowerCase() === 'path' ? pathBox(el.getAttribute('d') || '') : null;
          if (coversCanvas(el, b, vb[0], vb[1], vb[2], vb[3])) { el.setAttribute('class', 'backdrop'); continue; }
          paths.push({ el, box: b });
        }
        const left = svg.querySelector('[data-part="eye-left"]'), right = svg.querySelector('[data-part="eye-right"]');
        found = left && right ? [left, right] : findEyes(paths, vb[2], vb[3]);
        if (found) for (const eye of found) {
          eye.classList.add('eye');
          if (eye.getAttribute('data-blink') === 'false') eye.classList.add('closed-eye');
        }
        // ponytail: bounds identify this old pack's tuft; name data-part explicitly in new artwork.
        if (!svg.querySelector('[data-part="tuft"]')) {
          const tuft = paths.find(p => p.box && p.box.x0 > vb[2] * 0.3 && p.box.x1 < vb[2] * 0.7 && p.box.y1 < vb[3] * 0.32 && p.box.h > vb[3] * 0.08);
          if (tuft?.box) {
            tuft.el.setAttribute('data-part', 'tuft');
            tuft.el.setAttribute('style', `transform-origin:${tuft.box.cx}px ${tuft.box.y1}px`);
          }
        }
      }
      const tuft = svg.querySelector<SVGGraphicsElement>('[data-part="tuft"]');
      if (tuft && !tuft.closest('[data-hair]')) {
        const root = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        root.setAttribute('data-hair', 'tuft');
        root.style.transformOrigin = tuft.style.transformOrigin;
        tuft.parentNode!.insertBefore(root, tuft); root.appendChild(tuft);
      }
      // Follow-through moves the whole ear; authored flicks stay on the inner group.
      for (const ear of Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-part="ear-left"], [data-part="ear-right"]'))) {
        ear.querySelector('[data-hair]')?.removeAttribute('data-hair');
        const root = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        root.setAttribute('data-hair', ear.getAttribute('data-part')!);
        root.style.transformOrigin = ear.style.transformOrigin;
        ear.parentNode!.insertBefore(root, ear); root.appendChild(ear);
      }
      layer.replaceChildren(document.adoptNode(svg));
      hairLayers.set(layer, Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-hair]')).map(el => {
        const name = el.getAttribute('data-hair')!;
        const ear = name.startsWith('ear-'), fringe = name === 'fringe', tuft = name === 'tuft';
        el.style.setProperty('--layer-depth', String(ear ? -.45 : fringe ? .8 : tuft ? 1.25 : .4));
        const origin = el.style.transformOrigin.split(' ').map(parseFloat);
        const from = hairLayers.get(faces[front])?.find(state => state.el.getAttribute('data-hair') === name);
        return { el, source: el.parentElement as unknown as SVGGraphicsElement, origin: new DOMPoint(origin[0], origin[1]),
          stiffness: ear ? 135 : fringe ? 180 : tuft ? 75 : name === 'left' ? 100 : 115,
          damping: ear ? 13 : fringe ? 17 : tuft ? 9 : 11,
          limit: ear ? 4 : fringe ? 4 : tuft ? 9 : 6, vertical: name === 'left' || name === 'ear-left' ? -1 : 1,
          angle: from?.angle ?? 0, speed: from?.speed ?? 0, stretch: from?.stretch ?? 0, stretchSpeed: from?.stretchSpeed ?? 0, previous: null };
      }));
      return found;
    }
    function followHair(time: number) {
      hairFrame = 0;
      if (motionPreference.matches) {
        if (!reduced) onMotionPreference();
        return;
      }
      if (frozenAt !== null) return;
      const elapsed = (time - hairTime) / 1000, dt = Math.min(elapsed, .1);
      hairTime = time;
      // Reuse Haru's existing breathing and counter-sway, whose channels have different periods.
      const fallingAsleep = reactionName === 'sleep-transition' ? clamp((time - reactionStart) / 6500, 0, 1) : 0;
      const quiet = ['sleepy', 'unimpressed', 'drowsy', 'content', 'disappointed'].includes(engine.emotion());
      const idle = idleMotion(time, { energy: (quiet ? .2 : .55) * (1 - fallingAsleep), sleepiness: Math.max(quiet ? .75 : .1, fallingAsleep), stress: 0 }, claim?.why === 'talking' && time < claimUntil ? .8 : 0);
      box.style.transform = `translate(calc(var(--idle-bob) * ${(idle.driftX * 65).toFixed(4)}), calc(var(--idle-bob) * ${(-idle.breath).toFixed(4)})) rotate(calc(var(--idle-sway) * ${(idle.headZ * .4 + idle.bodyZ * .2).toFixed(4)})) scaleY(calc(1 + (var(--idle-breath) - 1) * ${idle.breath.toFixed(4)}))`;
      const decay = dragPoint ? Math.exp(-Math.max(0, time - dragPoint.at - 40) / 85) : 0;
      const deformation = dragMotionTarget(dragVelocity.x * decay, dragVelocity.y * decay, box.offsetWidth, !!dragPoint);
      for (let i = 0; i < dragShape.length; i++) {
        [dragShape[i], dragSpeed[i]] = settleSpring(dragShape[i], dragSpeed[i], deformation[i], 155, 15, dt);
      }
      dragEl.style.transform = `matrix(${dragShape[0]},${dragShape[1]},${dragShape[1]},${dragShape[2]},0,0) rotate(${dragShape[3]}deg)`;
      const gaze = target(time);
      const depthTarget = depthMotionTarget(time, gaze.x, gaze.y, !!claim && time < claimUntil, quiet);
      depthTarget[0] += dragPoint ? Math.min(.15, Math.hypot(dragVelocity.x, dragVelocity.y) * decay / Math.max(1, box.offsetWidth) * .02) : 0;
      for (let i = 0; i < depthPose.length; i++) {
        [depthPose[i], depthSpeed[i]] = settleSpring(depthPose[i], depthSpeed[i], depthTarget[i], 85, 11, dt);
      }
      depthEl.style.setProperty('--view-yaw', String(depthPose[2]));
      depthEl.style.setProperty('--view-pitch', String(depthPose[1]));
      depthEl.style.setProperty('--total-depth', `clamp(-.95, calc(${depthPose[0]} + var(--depth-z)), .82)`);
      depthEl.style.transform = `translateY(calc(var(--avatar-size) * var(--total-depth) * .08)) perspective(calc(var(--avatar-size) * 2.8)) translateZ(calc(var(--avatar-size) * var(--total-depth))) rotateX(calc((${depthPose[1]} + var(--depth-pitch)) * 1deg)) rotateY(calc((${depthPose[2]} + var(--depth-yaw)) * 1deg))`;
      // Read parent matrices before writing strand transforms, avoiding repeated layout work.
      const matrices = new Map<SVGGraphicsElement, DOMMatrix | null>();
      for (const states of hairLayers.values()) for (const strand of states) {
        if (!matrices.has(strand.source)) matrices.set(strand.source, strand.source.getScreenCTM());
      }
      for (const states of hairLayers.values()) for (const strand of states) {
        const matrix = matrices.get(strand.source);
        if (!matrix) continue;
        const point = strand.origin.matrixTransform(matrix);
        if (!Number.isFinite(point.w) || point.w <= .01) continue;
        const sample = { x: point.x / point.w + window.screenX, y: point.y / point.w + window.screenY, roll: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI };
        const previous = strand.previous;
        strand.previous = sample;
        if (!previous || elapsed > .1 || dt <= 0) {
          strand.speed = strand.stretchSpeed = 0;
          continue;
        }
        const scale = Math.max(0.01, Math.hypot(matrix.a, matrix.b) / point.w);
        const vx = (sample.x - previous.x) / dt / scale, vy = (sample.y - previous.y) / dt / scale;
        const turn = ((sample.roll - previous.roll + 540) % 360 - 180) / dt;
        const { angle: target, stretch } = hairMotionTarget(sample.roll, turn, vx, vy,
          strand.el.getAttribute('data-hair')?.startsWith('ear-') ?? false, strand.vertical, strand.limit);
        [strand.angle, strand.speed] = settleSpring(strand.angle, strand.speed, target, strand.stiffness, strand.damping, dt);
        [strand.stretch, strand.stretchSpeed] = settleSpring(strand.stretch, strand.stretchSpeed, stretch, strand.stiffness, strand.damping, dt);
        strand.angle = clamp(strand.angle, -strand.limit, strand.limit);
        strand.el.style.transform = `rotate(${strand.angle.toFixed(3)}deg) skewX(${(strand.angle * .2).toFixed(3)}deg) scaleY(${(1 + strand.stretch).toFixed(4)})`;
      }
      hairFrame = requestAnimationFrame(followHair);
    }
    function idleFor(name: string) {
      const m = IDLE[name] || IDLE.neutral;
      box.style.setProperty('--idle-bob', m.bobPx * .4 + 'px'); box.style.setProperty('--idle-sway', m.swayDeg * .6 + 'deg'); box.style.setProperty('--idle-breath', String(1 + m.breath * .25));
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
      stopReaction(true);
      const frame = engine.sample(t);
      const mine = ++request;
      box.setAttribute('aria-label', LABELS[frame.emotion] || ('Haru feeling ' + frame.emotion));
      const incoming = faces[1 - front];
      load(frame.emotion).then(text => {
        if (mine !== request) return;
        incoming.classList.remove('missing');
        const hairSource = faces[front].querySelector<SVGPathElement>('[data-part="tuft"]') ?? undefined;
        eyes = mount(incoming, text);
        front = 1 - front;
        mounted = true;
        idleFor(frame.emotion);
        paint(frozenAt === null ? frame : engine.sample(frozenAt), frozenAt === null);
        if (!reduced && frozenAt === null) replay(body, 'changed');
        look(); scheduleBlink();
        if (changed && EXPRESSION_REACTIONS[frame.emotion]) play(EXPRESSION_REACTIONS[frame.emotion], hairSource);
        else if (changed && clock() - lastMotion > 2000) {
          if (frame.emotion === 'excited' || frame.emotion === 'wink') play('tuft-bounce');
          else if (frame.emotion === 'curious' || frame.emotion === 'skeptical') play('head-tilt');
          else if (frame.emotion === 'determined') play('double-nod');
        }
        if (changed && (!EXPRESSION_REACTIONS[frame.emotion] || reduced)) showSymbol(EXPRESSION_SYMBOLS[frame.emotion] ?? null, { source: hairSource });
      }).catch(() => { if (mine === request) { incoming.replaceChildren(); incoming.classList.add('missing'); } });
    }
    function settleBack(ms: number) { if (timer) clearTimeout(timer); timer = setTimeout(() => show(resting, clock()), ms); }
    const POKES: Record<string, [string, number]> = { exclaim: ['angry', 2000], burst: ['surprised', 1600], orbit: ['excited', 1600], comet: ['surprised', 1600], play: ['happy', 1600] };

    // ---- attention: where the eyes go, and why ----------------------------
    // The desktop already decides where she looks — cursor, screen watching, the
    // wander, what she is doing — and hands it down through read(). That target
    // wins; the engine's own wander is the fallback for when nothing is reading.
    const RANGE_X = 26, RANGE_Y = 15;
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
      if (t < reactionUntil) return;
      if (t >= nextEarTwitch) {
        nextEarTwitch = t + 7000 + Math.random() * 10000;
        if (t - lastMotion > 2200) play('ear-flick');
      }
      box.style.setProperty('--gaze-x', (at.x * RANGE_X).toFixed(1) + 'px');
      box.style.setProperty('--gaze-y', (at.y * RANGE_Y).toFixed(1) + 'px');
      // Eyes arrive first; the slower pose transition lets her head catch up.
      poseEl.style.setProperty('--tilt', (p.tilt + at.x * 1.8).toFixed(2) + 'deg');
      poseEl.style.setProperty('--drift-x', (p.dx + at.x * .008).toFixed(3)); poseEl.style.setProperty('--drift-y', (p.dy + at.y * .005).toFixed(3));
    }
    const gazeTimer = setInterval(look, 250);
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    function blinkNow(second = false) {
      if (motionPreference.matches || !engine.blinks()) return;
      if (clock() < reactionUntil) { scheduleBlink(); return; }
      const duration = engine.emotion() === 'drowsy' ? 500 + Math.random() * 200 : 220 + Math.random() * 60;
      animate(box, [{ '--lid': '1', offset: 0 }, { '--lid': '.06', offset: .2 }, { '--lid': '.06', offset: .3 }, { '--lid': '1', offset: 1 }], duration);
      blinkTimer = setTimeout(() => {
        if (!second && Math.random() < .16) blinkTimer = setTimeout(() => blinkNow(true), 150 + Math.random() * 130);
        else scheduleBlink();
      }, duration);
    }
    function scheduleBlink() {
      if (blinkTimer) clearTimeout(blinkTimer); blinkTimer = null;
      if (reduced || frozenAt !== null || !engine.blinks()) { box.style.setProperty('--lid', '1'); return; }
      if (reactionUntil === Infinity) return;
      blinkTimer = setTimeout(blinkNow, Math.max(0, reactionUntil - clock()) + 2200 + Math.random() * 4000);
    }
    const onPointerMove = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        const r = box.getBoundingClientRect(); if (!r.width) return;
        const hw = Math.max(1, window.innerWidth / 2), hh = Math.max(1, window.innerHeight / 2);
        pointer = { x: clamp((e.clientX - (r.left + r.width / 2)) / hw, -1, 1), y: clamp((e.clientY - (r.top + r.height / 2)) / hh, -1, 1) }; pointerAt = clock();
    };
    const onPointerLeave = () => { pointer = null; };
    if (finePointer) {
      window.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerleave', onPointerLeave);
    }

    function fit() {
      const el = container as HTMLDivElement;
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      const side = Math.max(48, Math.round(Math.min(w, h) * 0.94));
      el.style.setProperty('--avatar-size', side + 'px');
      document.documentElement.style.setProperty('--haru-width', side + 'px');
      callbacks.current.onFit(side);
    }

    function expression(name: string | null) {
      resting = adaptEmotion(name);
      if (resting === engine.emotion()) { stopReaction(true); showSymbol(null); }
      if (timer) clearTimeout(timer);
      show(resting, clock()); look(); scheduleBlink();
    }
    function notify() {
      if (engine.emotion() === 'thinking') { if (timer) clearTimeout(timer); show(resting, clock()); }
      if (frozenAt !== null || reduced) return;
      if (reactionName === 'sleep-transition') { stopReaction(); scheduleBlink(); }
      replay(body, 'pop'); attend('talking', 2500);
    }
    function attend(why: string, ms?: number) { claim = why ? { why } : null; claimUntil = clock() + (ms === undefined ? 1500 : ms); look(); }

    function clearSymbol() {
      if (symbolTimer) clearTimeout(symbolTimer); symbolTimer = null;
      for (const animation of symbolAnimations) animation.cancel();
      symbolAnimations.clear(); symbolLayer.replaceChildren();
      box.removeAttribute('data-symbol'); box.removeAttribute('data-symbol-eyes');
    }
    function showSymbol(name: string | null, options: { duration?: number; rise?: number; hold?: boolean; source?: SVGPathElement } = {}) {
      const settling = name === null;
      if (settling && !box.getAttribute('data-symbol')?.startsWith('hair-')) { clearSymbol(); return; }
      if (name !== null && !Object.hasOwn(REACTION_SYMBOLS, name) && !Object.hasOwn(HAIR_SYMBOLS, name)) return;
      const hair = name !== null && Object.hasOwn(HAIR_SYMBOLS, name) ? HAIR_SYMBOLS[name] : null;
      const duration = options.duration ?? (settling ? 420 : hair?.duration ?? REACTION_SYMBOLS[name!].duration);
      nextEarTwitch = Math.max(nextEarTwitch, clock() + duration + 2000);
      if (settling || hair) {
        const tuft = faces[front].querySelector<SVGPathElement>('[data-part="tuft"]');
        if (!tuft || motionPreference.matches) {
          if (hair) showSymbol(hair.fallback); else clearSymbol();
          return;
        }
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outline.setAttribute('d', hair?.d ?? tuft.getAttribute('d') ?? '');
        const rest = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rest.setAttribute('d', tuft.getAttribute('d') || '');
        try {
          const frames = hairSymbolFrames(options.source ?? tuft, outline, rest, duration, options.rise ?? hair?.rise, settling || options.hold,
            settling ? 0 : options.hold ? .25 : (hair?.rise ?? 0) >= 700 ? .45 : 1);
          clearSymbol();
          // Both cross-fading faces share the same contour, so switching emotions never flashes a resting tuft.
          for (const face of faces) {
            const strand = face.querySelector<SVGPathElement>('[data-part="tuft"]');
            if (strand) symbolAnimations.add(strand.animate(frames, { duration, fill: options.hold ? 'forwards' : 'none' }));
          }
          box.setAttribute('data-symbol', name ?? 'hair-rest');
          if (!options.hold) symbolTimer = setTimeout(clearSymbol, duration);
        } catch { clearSymbol(); callbacks.current.onError('Haru could not animate this hair outline.'); }
        return;
      }
      clearSymbol();
      const mark = REACTION_SYMBOLS[name!];
      symbolLayer.innerHTML = mark.markup;
      box.setAttribute('data-symbol', name!);
      if (mark.eyeOverlay) box.setAttribute('data-symbol-eyes', 'true');
      const parts = symbolLayer.querySelectorAll<SVGGraphicsElement>('[data-symbol-part]');
      if (!motionPreference.matches) parts.forEach((part, index) => {
        symbolAnimations.add(part.animate(symbolFrames(mark.motion), { duration: mark.duration, delay: index * 80, fill: 'both' }));
      });
      symbolTimer = setTimeout(clearSymbol, mark.duration + Math.max(0, parts.length - 1) * 80);
    }
    function tap() {
      if (motionPreference.matches || dragPoint) return;
      play(TAP_REACTIONS[tapIndex++ % TAP_REACTIONS.length]);
    }
    function drag(point: { x: number; y: number } | null) {
      if (!point || motionPreference.matches) { dragPoint = null; dragVelocity = { x: 0, y: 0 }; return; }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const at = clock(), elapsed = dragPoint ? (at - dragPoint.at) / 1000 : 0;
      if (!dragPoint) stopReaction();
      dragVelocity = elapsed > 0 && elapsed <= .1 && dragPoint
        ? { x: (point.x - dragPoint.x) / elapsed, y: (point.y - dragPoint.y) / elapsed } : { x: 0, y: 0 };
      dragPoint = { ...point, at };
    }
    function stopReaction(preserveSymbol = false) {
      if (!preserveSymbol) clearSymbol();
      for (const animation of reactionAnimations) {
        const element = (animation.effect as KeyframeEffect | null)?.target;
        if (element && animations.get(element) === animation) animations.delete(element);
        animation.cancel();
      }
      reactionAnimations.clear(); reactionName = ''; reactionUntil = 0;
      box.removeAttribute('data-reaction');
      box.setAttribute('aria-label', LABELS[engine.emotion()]);
    }
    function animate(element: Element, frames: Keyframe[], duration: number, delay = 0, fill: FillMode = 'none') {
      animations.get(element)?.cancel();
      const animation = element.animate(frames, { duration, delay, easing: 'linear', fill });
      animations.set(element, animation);
      animation.onfinish = () => { if (fill !== 'forwards' && animations.get(element) === animation) animations.delete(element); };
      return animation;
    }
    function play(name: string, hairSource?: SVGPathElement) {
      if (motionPreference.matches || frozenAt !== null || dragPoint) return;
      if (Object.hasOwn(SVG_REACTIONS, name)) {
        stopReaction(!!ANIMATION_SYMBOLS[name]);
        const reaction = SVG_REACTIONS[name];
        reactionName = name; reactionStart = clock();
        reactionUntil = reaction.hold ? Infinity : reactionStart + reaction.duration;
        box.setAttribute('data-reaction', name);
        if (reaction.hold) box.setAttribute('aria-label', 'Haru drifting to sleep');
        for (const track of reaction.tracks) {
          const element = track.part === 'depth' ? depthEl : track.part === 'head' ? gestureEl : track.part === 'gaze' ? box : faces[front].querySelector(`[data-part="${track.part}"]`);
          if (element) reactionAnimations.add(animate(element, track.frames, reaction.duration, 0, reaction.hold ? 'forwards' : 'none'));
        }
        lastMotion = clock(); scheduleBlink();
        if (ANIMATION_SYMBOLS[name]) showSymbol(ANIMATION_SYMBOLS[name], { duration: reaction.duration, hold: reaction.hold, source: hairSource, rise: name === 'startle' ? 140 : undefined });
        return;
      }
      if (!['ear-twitch', 'ear-flick', 'flinch', 'recoil', 'tuft-bounce', 'sparkle', 'head-tilt', 'tilt', 'double-nod', 'nod'].includes(name)) return;
      stopReaction(!!ANIMATION_SYMBOLS[name] || reactionName !== 'sleep-transition'); scheduleBlink();
      let element: Element | null = gestureEl, frames: Keyframe[], duration: number;
      switch (name) {
        case 'ear-twitch': case 'ear-flick': case 'flinch': case 'recoil': {
          const lead = Math.random() < .5 ? 0 : 1, strength = 3.5 + Math.random() * 3;
          const single = name === 'ear-flick' && Math.random() < .7;
          for (const [index, side] of ['left', 'right'].entries()) {
            if (single && index !== lead) continue;
            const ear = faces[front].querySelector(`[data-part="ear-${side}"]`);
            if (!ear) continue;
            const sign = (index === 0 ? 1 : -1) * (index === lead ? 1 : .25 + Math.random() * .2);
            animate(ear, [0, .6, -strength, strength * .14, 0].map((angle, i) => ({
              transform: `rotate(${angle * sign}deg)`, offset: [0, .1, .25, .5, 1][i], easing: EASE_OUT_CSS,
            })), 580 + Math.random() * 160, index === lead ? 0 : 85 + Math.random() * 110);
          }
          lastMotion = clock();
          nextEarTwitch = clock() + 7000 + Math.random() * 10000;
          return;
        }
        case 'tuft-bounce': case 'sparkle':
          element = faces[front].querySelector('[data-part="tuft"]');
          frames = [0, -6, 2, -.6, 0].map(angle => ({ transform: `rotate(${angle}deg)`, easing: EASE_OUT_CSS })); duration = 820; break;
        case 'head-tilt': case 'tilt': {
          const angle = (target(clock()).x > .15 ? 1 : -1) * (3.5 + Math.random() * 1.5);
          frames = [0, angle, angle * .92, 0].map((value, i) => ({ transform: `rotate(${value}deg)`, offset: [0, .24, .62, 1][i], easing: 'cubic-bezier(.4, 0, .2, 1)' })); duration = 1800; break;
        }
        case 'double-nod': case 'nod':
          frames = [0, 4, -.6, 2.3, 0].map((y, i) => ({ transform: `translateY(${y}px) scaleY(${1 - Math.max(0, y) * .0008})`, offset: [0, .22, .46, .7, 1][i], easing: 'cubic-bezier(.4, 0, .2, 1)' })); duration = 1050; break;
        default: return;
      }
      if (!element) return;
      animate(element, frames, duration);
      lastMotion = clock();
      if (ANIMATION_SYMBOLS[name]) showSymbol(ANIMATION_SYMBOLS[name]);
    }
    const onMotionPreference = () => {
      reduced = motionPreference.matches;
      if (reduced) {
        stopReaction();
        for (const animation of animations.values()) animation.cancel(); animations.clear();
        cancelAnimationFrame(hairFrame); hairFrame = 0;
        box.style.transform = '';
        drag(null); dragEl.style.transform = '';
        depthEl.style.transform = ''; depthEl.style.setProperty('--view-yaw', '0'); depthEl.style.setProperty('--view-pitch', '0');
        depthPose.fill(0); depthSpeed.fill(0);
        dragShape.splice(0, 4, 1, 0, 1, 0); dragSpeed.fill(0);
        for (const states of hairLayers.values()) for (const strand of states) {
          strand.angle = strand.speed = strand.stretch = strand.stretchSpeed = 0;
          strand.previous = null; strand.el.style.transform = '';
        }
      } else if (!hairFrame) hairFrame = requestAnimationFrame(followHair);
      look(); scheduleBlink();
    };
    motionPreference.addEventListener('change', onMotionPreference);

    const handle: SvgAvatarHandle = {
      expression,
      play, tap, drag,
      symbol: showSymbol,
      hitTest: (x, y) => { const r = box.getBoundingClientRect(); return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; },
      notify,
      attend,
    };

    idleFor('neutral');
    show('neutral', clock());
    scheduleBlink();
    hairFrame = requestAnimationFrame(followHair);
    fit();
    const observer = new ResizeObserver(fit); observer.observe(container);
    callbacks.current.onReady(handle);

    return () => {
      request++;
      stopReaction();
      cancelAnimationFrame(hairFrame);
      for (const animation of animations.values()) animation.cancel();
      motionPreference.removeEventListener('change', onMotionPreference);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
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
