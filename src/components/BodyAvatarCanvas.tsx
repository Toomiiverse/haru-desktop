import { useEffect, useRef } from 'react';
import { adaptEmotion, emotionConfig, type HaruEmotion } from '../../electron/emotions';
import type { SvgAvatarHandle } from './SvgAvatarCanvas';
import { LOUD_FLOOR, LOUD_S, MOUTH, mouthFor, type MouthReading } from '../companion/mouth';
import { hairMotionTarget, idleMotion, settleSpring, speechJaw } from '../companion/idle';
import { EXPRESSION_REACTIONS, SVG_REACTIONS } from '../companion/svgReactions';
import { ARM_GESTURES, BODY_EXPRESSIONS, HEAD_GESTURES, NO_BLINK_LIDS, VISEMES } from '../companion/bodyRig';
import source from '../../build/body/haru.svg?raw';

/**
 * Haru, whole.
 *
 * One hand-drawn SVG (build/body/haru.svg) with a named group for everything that moves: her upper body about the
 * hips, her head about the neck, each arm about its shoulder, elbow and wrist, each lock of hair about its root. A
 * face is not a file here but a choice of lids, brows and mouth inside the one drawing (bodyRig.ts), so a change of
 * mood is a crossfade of three small groups and the body never flickers. The idle breathing, sway and head
 * counter-motion are the companion's own (idle.ts); the hair hangs on the same springs; the mouth picks its shape
 * the way her screen does, from the voice's loudness and band balance (mouth.ts).
 *
 * Same handle as the face-only renderer, so a window can hold either.
 */
interface Props {
  onReady(handle: SvgAvatarHandle | null): void;
  read?(): { mouth: MouthReading; gaze?: { x: number; y: number } };
}

// Where the iris can travel inside the eye, in the drawing's units.
const GAZE_X = 7, GAZE_Y = 4;
// A shape is held at least this long, so quiet consonants do not flicker between two; shapes crossfade with this time constant.
const MOUTH_HOLD_MS = 70, MOUTH_FADE_MS = 18;
// Each lock's spring: stiffness, damping, swing limit (degrees), side (for gravity), and how much of the head's roll it lags.
const HAIR: Record<string, [number, number, number, number, number]> = {
  fringe: [160, 14, 4, 0, .8], 'side-left': [90, 9, 9, -1, 2], 'side-right': [90, 9, 9, 1, 2], 'back-left': [60, 7, 11, -1, 2], 'back-right': [60, 7, 11, 1, 2],
};
const easing = 'cubic-bezier(.4, 0, .2, 1)';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function BodyAvatarCanvas({ onReady, read }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, read });
  callbacks.current = { onReady, read };

  useEffect(() => {
    const el = container.current!;
    el.innerHTML = `<div id="avatar" aria-label="Haru"><div id="avatar-pose"><div class="avatar-gesture"><div class="face on">${source}</div></div></div></div>`;
    const box = el.querySelector<HTMLElement>('#avatar')!, gestureEl = el.querySelector<HTMLElement>('.avatar-gesture')!, svg = el.querySelector('svg')!;
    const part = (name: string) => svg.querySelector<SVGGElement>(`[data-part="${name}"]`)!;
    const upper = part('upper'), chest = part('chest'), head = part('head'), blush = part('blush');
    const arms = { left: part('arm-left'), right: part('arm-right') }, forearms = { left: part('forearm-left'), right: part('forearm-right') };
    const hands = { left: [...part('hand-left').querySelectorAll<SVGGElement>('[data-hand]')], right: [...part('hand-right').querySelectorAll<SVGGElement>('[data-hand]')] };
    const lids = [...svg.querySelectorAll<SVGGElement>('[data-lids]')], brows = [...svg.querySelectorAll<SVGGElement>('[data-brows]')];
    const mouths = [...svg.querySelectorAll<SVGGElement>('[data-mouth]')];
    const hair = [...svg.querySelectorAll<SVGGElement>('[data-hair]')].map(el => ({ el, name: el.dataset.hair!, angle: 0, speed: 0 }));
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = matchMedia('(pointer: fine)').matches;
    const clock = () => performance.now();

    // One animation per element: a new one cancels what that element was doing.
    const animations = new Map<Element, Animation>();
    function animate(element: Element, frames: Keyframe[], duration: number, fill: FillMode = 'none') {
      animations.get(element)?.cancel();
      const animation = element.animate(frames, { duration, easing: 'linear', fill });
      animations.set(element, animation);
      animation.onfinish = () => { if (fill !== 'forwards' && animations.get(element) === animation) animations.delete(element); };
      return animation;
    }

    // The face: which lids, brows and mouth are up. Lids and brows crossfade in CSS; the mouth below, per frame.
    let emotion: HaruEmotion = 'neutral', face = BODY_EXPRESSIONS.neutral;
    const show = (group: SVGGElement[], attr: string, want: string) => { for (const g of group) g.style.opacity = g.getAttribute(attr) === want ? '1' : '0'; };
    function expression(name: string | null) {
      emotion = adaptEmotion(name);
      face = BODY_EXPRESSIONS[emotion] ?? BODY_EXPRESSIONS.neutral;
      show(lids, 'data-lids', face.lids); show(brows, 'data-brows', face.brows);
      blush.style.opacity = face.blush ? '1' : '0';
      box.setAttribute('aria-label', emotionConfig[emotion].label);
      scheduleBlink();
      const reaction = EXPRESSION_REACTIONS[emotion];
      if (reaction) play(reaction);
    }

    // Blinks on the face-only renderer's calendar; never over lids that are drawn shut.
    let blinkTimer: ReturnType<typeof setTimeout> | null = null, reactionUntil = 0;
    const blinks = () => emotionConfig[emotion].blink && !NO_BLINK_LIDS.has(face.lids);
    function blinkNow(second = false) {
      if (motionPreference.matches || !blinks()) return;
      if (clock() < reactionUntil) { scheduleBlink(); return; }
      const duration = emotion === 'drowsy' ? 500 + Math.random() * 200 : 220 + Math.random() * 60;
      animate(box, [{ '--lid': '1', offset: 0 }, { '--lid': '.06', offset: .2 }, { '--lid': '.06', offset: .3 }, { '--lid': '1', offset: 1 }], duration);
      blinkTimer = setTimeout(() => {
        if (!second && Math.random() < .16) blinkTimer = setTimeout(() => blinkNow(true), 150 + Math.random() * 130);
        else scheduleBlink();
      }, duration);
    }
    function scheduleBlink() {
      if (blinkTimer) clearTimeout(blinkTimer); blinkTimer = null;
      if (motionPreference.matches || !blinks()) { box.style.setProperty('--lid', '1'); return; }
      if (reactionUntil === Infinity) return;
      blinkTimer = setTimeout(blinkNow, Math.max(0, reactionUntil - clock()) + 2200 + Math.random() * 4000);
    }

    // Where she looks: the caller's gaze, else the pointer, else ahead; a claim holds her eyes forward for a while.
    let pointer: { x: number; y: number } | null = null, attendUntil = 0;
    function look() {
      const given = callbacks.current.read?.()?.gaze;
      const at = clock() < attendUntil ? { x: 0, y: .1 } : given ?? pointer ?? { x: 0, y: 0 };
      const range = emotionConfig[emotion].gaze;
      box.style.setProperty('--gaze-x', (at.x * GAZE_X * range).toFixed(1) + 'px');
      box.style.setProperty('--gaze-y', (at.y * GAZE_Y * range).toFixed(1) + 'px');
    }
    const gazeTimer = setInterval(look, 250);
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = box.getBoundingClientRect(); if (!r.width) return;
      const hw = Math.max(1, window.innerWidth / 2), hh = Math.max(1, window.innerHeight / 2);
      pointer = { x: clamp((e.clientX - (r.left + r.width / 2)) / hw, -1, 1), y: clamp((e.clientY - (r.top + r.height * .14)) / hh, -1, 1) };
    };
    const onPointerLeave = () => { pointer = null; };
    if (finePointer) { window.addEventListener('pointermove', onPointerMove); document.addEventListener('pointerleave', onPointerLeave); }

    // Gestures. Arms and head animate the individual rotate/translate properties, so the idle sway on `transform`
    // keeps going underneath and nothing jumps when a gesture ends.
    const setHand = (side: 'left' | 'right', name: string) => { for (const h of hands[side]) h.style.opacity = h.dataset.hand === name ? '1' : '0'; };
    function play(name: string) {
      if (motionPreference.matches) return;
      const arm = ARM_GESTURES[name];
      if (arm) {
        const frames = (points: [number, number][]) => points.map(([offset, deg]) => ({ offset, rotate: `${deg}deg`, easing }));
        const swing = animate(arms[arm.side], frames(arm.shoulder), arm.duration);
        animate(forearms[arm.side], frames(arm.elbow), arm.duration);
        setHand(arm.side, arm.hand);
        swing.finished.then(() => setHand(arm.side, 'rest'), () => setHand(arm.side, 'rest'));
        return;
      }
      const nod = HEAD_GESTURES[name];
      if (nod) { animate(head, nod.frames.map(f => ({ ...f, easing })), nod.duration); return; }
      const reaction = SVG_REACTIONS[name];
      if (!reaction) return;
      reactionUntil = reaction.hold ? Infinity : clock() + reaction.duration;
      for (const track of reaction.tracks) {
        const element = track.part === 'head' ? gestureEl : track.part === 'gaze' ? box : null;
        if (element) animate(element, track.frames, reaction.duration, reaction.hold ? 'forwards' : 'none');
      }
      scheduleBlink();
    }
    function attend(_why: string, ms = 1600) { attendUntil = clock() + ms; look(); }

    // The frame: breath, sway, the head's own wander, the hair's lag, and the mouth for the voice right now.
    const mouthAlpha = new Map(mouths.map(m => [m, m.dataset.mouth === 'line' ? 1 : 0]));
    let mouthShown = 'line', mouthAt = 0, jaw = 0, loud = LOUD_FLOOR, lastRoll = 0;
    let frame = 0, last = clock();
    const start = clock(), vitals = { energy: .55, sleepiness: 0, stress: 0 };
    function tick() {
      frame = requestAnimationFrame(tick);
      const now = clock(), dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
      const reading = callbacks.current.read?.()?.mouth ?? { open: 0, weight: 0 };
      jaw = speechJaw(reading.open, reading.weight, jaw, dt);
      loud = Math.max(jaw, loud * Math.exp(-dt / LOUD_S), LOUD_FLOOR);
      const want = mouthFor(jaw, jaw / loud, reading.bands);
      const shape = want === MOUTH.closed ? face.mouth : VISEMES[want];
      if (shape !== mouthShown && now - mouthAt >= MOUTH_HOLD_MS) { mouthShown = shape; mouthAt = now; }
      const fade = 1 - Math.exp(-dt * 1000 / MOUTH_FADE_MS);
      for (const m of mouths) {
        const a = mouthAlpha.get(m)!, next = a + ((m.dataset.mouth === mouthShown ? 1 : 0) - a) * fade;
        const v = next < .01 ? 0 : next > .99 ? 1 : next;
        if (v !== a) { mouthAlpha.set(m, v); m.style.opacity = v.toFixed(2); }
      }
      if (motionPreference.matches) return;
      const idle = idleMotion(now - start, vitals, reading.weight > .5 ? 1 : 0);
      const sway = idle.bodyZ * .6, roll = idle.headZ * .9;
      upper.style.transform = `rotate(${sway.toFixed(2)}deg)`;
      chest.style.transform = `scale(${(1 + idle.breath * .006).toFixed(4)}, ${(1 + idle.breath * .014).toFixed(4)})`;
      head.style.transform = `translate(${(idle.headX * 1.4).toFixed(2)}px, ${(idle.headY * 1.2).toFixed(2)}px) rotate(${roll.toFixed(2)}deg)`;
      arms.left.style.transform = arms.right.style.transform = `rotate(${(-sway * .4).toFixed(2)}deg)`;
      const speed = (roll - lastRoll) / Math.max(dt, 1e-3); lastRoll = roll;
      for (const strand of hair) {
        const [stiffness, damping, limit, side, lag] = HAIR[strand.name] ?? HAIR.fringe;
        const carried = strand.name.startsWith('back') ? sway : roll + sway;
        const target = hairMotionTarget(carried * lag, idle.headX, speed * 2, 0, false, side, limit).angle;
        [strand.angle, strand.speed] = settleSpring(strand.angle, strand.speed, target, stiffness, damping, dt);
        strand.el.style.transform = `rotate(${strand.angle.toFixed(2)}deg)`;
      }
    }

    function fit() {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      el.style.setProperty('--avatar-size', Math.max(48, Math.round(Math.min(h * .96, w * .96 / .625))) + 'px');
    }
    const observer = new ResizeObserver(fit); observer.observe(el); fit();

    const onMotionPreference = () => {
      if (motionPreference.matches) {
        for (const animation of animations.values()) animation.cancel(); animations.clear();
        reactionUntil = 0;
        for (const target of [upper, chest, head, arms.left, arms.right, gestureEl]) target.style.transform = '';
        for (const strand of hair) { strand.angle = strand.speed = 0; strand.el.style.transform = ''; }
        setHand('left', 'rest'); setHand('right', 'rest');
      }
      look(); scheduleBlink();
    };
    motionPreference.addEventListener('change', onMotionPreference);

    const handle: SvgAvatarHandle = {
      expression, play, attend,
      tap: () => play(['nod', 'wave', 'peace'][Math.floor(Math.random() * 3)]),
      notify: () => play('nod'),
      // ponytail: no drag deformation and no manga marks yet; the marks are drawn in the faces' 1254 square and
      // would need placing over her head's box here. The desk's hit test is just her box.
      drag: () => {},
      symbol: () => {},
      hitTest: (x, y) => { const r = box.getBoundingClientRect(); return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; },
    };
    expression('neutral'); look(); scheduleBlink();
    frame = requestAnimationFrame(tick);
    callbacks.current.onReady(handle);

    return () => {
      callbacks.current.onReady(null);
      cancelAnimationFrame(frame); clearInterval(gazeTimer); if (blinkTimer) clearTimeout(blinkTimer);
      for (const animation of animations.values()) animation.cancel();
      observer.disconnect(); motionPreference.removeEventListener('change', onMotionPreference);
      window.removeEventListener('pointermove', onPointerMove); document.removeEventListener('pointerleave', onPointerLeave);
      el.innerHTML = '';
    };
  }, []);

  return <div ref={container} className="svg-avatar-canvas body-rig" />;
}
