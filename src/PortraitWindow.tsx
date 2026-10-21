import { useEffect, useRef, useState } from 'react';
import { createVoicePlayer } from './companion/mouth';
import type { EmotionName } from './types';
import { DEFAULT_VIEW, type Eye, type View } from './portraitRig';
import { createHairLayer, type HairLayer } from './portraitHair';
import irisSprite from '../build/portrait/iris.png';
import pupilSprite from '../build/portrait/pupil.png';
import './portrait.css';

/**
 * Her screen: the vertical monitor, with her portrait filling it.
 *
 * The picture is a still and the life is a rig drawn over it in the picture's
 * own pixels (portraitRig.ts says where everything is). Each eye is redrawn
 * from the part sheet — sclera, the sheet's iris and slit pupil sliding with
 * the gaze and narrowing with the mood, its reflections fixed, and a
 * skin-coloured lid with a lash edge that drops for blinks and half-lidded
 * moods — so the artwork's own eyes are never edited, only covered. Face and
 * hair are separate layers: the face is a plate with the hair painted out,
 * never warped; the hair is drawn over it by portraitHair.ts as rigid locks that
 * swing with the head's sway and a gusting wind; the brow sits on the face
 * behind them, and below the jaw everything is a still, out-of-focus background.
 * The motion follows the old wallpaper (measured from its recording): the head
 * sways about 1% of the screen on a ~9 s swing, pivoting from the crown, and
 * the locks lag it so their tips hang nearly still while the face moves under.
 * An open mouth is drawn over the drawn-on one while her voice plays; the voice
 * plays here too, muted at the window level by main, so the mouth reads real
 * amplitude rather than a guess timed against the text.
 */
// The picture is grey apart from her eyes; these are the only colours drawn.
// The lid matches her lit skin; its lash edge is soft grey like the rest of her lines.
const SCLERA = '#f4eef4', LID = '#cdcdcd';
// The sheet's complete eye shades the top of the eyeball under the lid, lilac fading to nothing.
const LID_SHADE = '#b48aa8';
// The upper face's shade, multiplied: the close-up's assets are toned for exactly this.
const SHADE = '#ababab';
// Highlights after the cel reference: shapes in iris units (centre 0,0; radius
// 1; y down), so the same drawing fits any eye. Corners are rounded by a stroke
// of the same colour.
const CATCH = [[-0.72, -0.30], [-0.42, -0.36], [-0.22, -0.18], [-0.28, 0.04], [-0.60, 0.10], [-0.74, -0.08]];
const DASHES = [[[0.44, -0.30], [0.64, -0.35], [0.62, -0.26], [0.42, -0.22]], [[0.34, -0.12], [0.54, -0.17], [0.52, -0.08], [0.32, -0.03]]];
const LOWER_GLOW = [[-0.30, 0.18], [0.0, 0.12], [0.36, 0.18], [0.52, 0.42], [0.36, 0.72], [0.0, 0.80], [-0.34, 0.70], [-0.46, 0.44]];
const CATCHLIGHT = '#fff0fb', GLOW = '#f27fe6';
const irisPoints = (eye: Eye, shape: number[][]) => shape.map(([x, y]) => `${(eye.iris.cx + x * eye.iris.r).toFixed(1)},${(eye.iris.cy + y * eye.iris.r).toFixed(1)}`).join(' ');
// Cursor distance, in window pixels from her centre, that reads as "all the way
// over". The main monitor's centre sits about 2000px to her right.
const LOOK_RANGE = 1900;
// Half-lid and pupil width per mood; everything else is open and round.
const LIDS: Partial<Record<EmotionName, number>> = { sleepy: 0.55, smug: 0.38, annoyed: 0.28, bored: 0.3, happy: 0.12 };
const DILATE: Partial<Record<EmotionName, number>> = { surprised: 2.2, curious: 1.6, affectionate: 1.5, annoyed: 0.7, determined: 0.7, sleepy: 0.9 };
const BLUSH: Partial<Record<EmotionName, number>> = { embarrassed: 1, affectionate: 0.7, happy: 0.3 };

// The head's swing: degrees about a pivot 30% of the screen above the top
// edge, so the face moves ~1% of the screen; period from the recording.
const SWAY_DEG = 0.5, SWAY_S = 9.2;
// The picture is drawn this much larger so the swing never shows an edge.
const OVERSCAN = 1.05;
// How far the face sits from that pivot, in picture px: turns the swing into the hair's lag.
const FACE_RADIUS = 2176;

// The blink, measured from the old wallpaper's recording (15 fps): shut in 0.2 s, held 0.3 s, open in 0.3 s
// with a slow settle; its first blink is a double, the second starting 0.2 s after the first reopens.
const BLINK = { close: 200, hold: 300, open: 300 };
const BLINK_MS = BLINK.close + BLINK.hold + BLINK.open;
const DOUBLE_BLINK = 0.35, DOUBLE_GAP = 200;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
/** How shut a blink that started `t` ms ago has the eye, 0..1. */
function blinkShape(t: number) {
  if (t < 0 || t > BLINK_MS) return 0;
  if (t < BLINK.close) return smooth(t / BLINK.close);
  if (t < BLINK.close + BLINK.hold) return 1;
  return 1 - smooth((t - BLINK.close - BLINK.hold) / BLINK.open);
}

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
type Panel = { id: number; title: string; body: string; image: string; seconds: number };

export function PortraitWindow({ view = DEFAULT_VIEW }: { view?: View }) {
  const [caption, setCaption] = useState<string | null>(null);
  // What she has put up: notes, reminders, pictures. Newest at the bottom,
  // each taken down on its own clock. Three at most; the screen is her face.
  const [panels, setPanels] = useState<Panel[]>([]);
  useEffect(() => window.haru?.companion.onPanel(panel => {
    setPanels(current => [...current.slice(-2), panel]);
    setTimeout(() => setPanels(current => current.filter(p => p.id !== panel.id)), panel.seconds * 1000);
  }), []);
  const cursor = useRef({ x: 0, y: 0 });
  const mood = useRef<EmotionName>('neutral');
  const sleeping = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hair = useRef<HairLayer | null>(null);
  // The plate replaces the picture only once the hair layer is drawing; until
  // then (or without WebGL) the painted-on hair stays.
  const [hairReady, setHairReady] = useState(false);
  useEffect(() => {
    if (!view.hair || !canvas.current) return;
    let live = true;
    void createHairLayer(canvas.current, { image: view.image, mask: view.hair.mask, locks: view.hair.locks, kink: view.hair.kink }).then(layer => {
      if (!live) { layer?.dispose(); return; }
      hair.current = layer; setHairReady(!!layer);
    });
    return () => { live = false; hair.current?.dispose(); hair.current = null; setHairReady(false); };
  }, [view]);

  useEffect(() => {
    const player = createVoicePlayer();
    const off = [
      window.haru?.voice.onClip(clip => player.play(clip)),
      window.haru?.voice.onStop(() => player.stop()),
      window.haru?.companion.onSay(setCaption),
      window.haru?.companion.onCursor(({ x, y }) => { cursor.current = { x: clamp((x - window.innerWidth / 2) / LOOK_RANGE), y: clamp((y - window.innerHeight / 2) / LOOK_RANGE) }; }),
      window.haru?.life.onEmotion(({ emotion }) => { mood.current = emotion.emotion; }),
      window.haru?.life.onTick(({ vitals, action, night }) => { sleeping.current = action === 'doze' || (night && vitals.sleepiness > 0.85); }),
    ];
    const gaze = { x: 0, y: 0 };
    let lid = 0, restLid = 0, blinks: number[] = [], nextBlink = performance.now() + 3000, mouth = 0, dilate = 1;
    let raf = 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const swing = (s: number) => Math.sin(2 * Math.PI * s / SWAY_S) + 0.25 * Math.sin(2 * Math.PI * s / 13.7 + 1);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const root = svg.current;
      if (!root) return;
      // Eyes lead the cursor by a beat; the lag is what makes it a glance.
      gaze.x += (cursor.current.x - gaze.x) * 0.08;
      gaze.y += (cursor.current.y - gaze.y) * 0.08;
      if (now >= nextBlink) {
        blinks = Math.random() < DOUBLE_BLINK ? [now, now + BLINK_MS + DOUBLE_GAP] : [now];
        nextBlink = blinks[blinks.length - 1] + BLINK_MS + 3000 + Math.random() * 4000;
      }
      const rest = sleeping.current ? 1 : LIDS[mood.current] ?? 0;
      restLid += (rest - restLid) * 0.08;
      const blinking = Math.max(0, ...blinks.map(start => blinkShape(now - start)));
      lid = Math.max(restLid, blinking);
      dilate += ((DILATE[mood.current] ?? 1) - dilate) * 0.05;
      const reading = player.read();
      mouth += (reading.open * reading.weight - mouth) * 0.6;
      const breath = Math.sin(now / 2200);
      const dx = (gaze.x * view.travel.x).toFixed(1), dy = (gaze.y * view.travel.y).toFixed(1);
      root.querySelectorAll<SVGGElement>('[data-gaze]').forEach(el => el.setAttribute('transform', `translate(${dx} ${dy})`));
      // The pupil fades as a blink brings the band down (its dark tip under the band read as the band
      // bending); a resting half-lid, sleepy or smug, keeps it.
      const pupilShown = (1 - smooth((blinking - 0.25) / 0.2)).toFixed(2);
      root.querySelectorAll<SVGGElement>('[data-pupil]').forEach(el => {
        el.setAttribute('transform', `translate(${el.dataset.pupil}) scale(${dilate.toFixed(3)} 1)`);
        el.setAttribute('opacity', pupilShown);
      });
      // The pre-rendered blink: show the frame for this much shut.
      root.querySelectorAll<SVGGElement>('[data-blink]').forEach(el => {
        const shown = Number(el.dataset.shown ?? 0), next = Math.round(lid * (el.children.length - 1));
        if (next === shown) return;
        el.children[shown].setAttribute('visibility', 'hidden');
        el.children[next].setAttribute('visibility', 'visible');
        el.dataset.shown = String(next);
      });
      root.querySelectorAll<SVGGElement>('[data-lid]').forEach(el => {
        const eye = view.eyes[Number(el.dataset.lid)];
        const drop = eye.bottom - eye.top + 24;
        el.setAttribute('transform', `translate(0 ${(drop * lid - drop).toFixed(1)})`);
      });
      // Nothing drawn at rest: the picture's own mouth is the closed one.
      const open = root.querySelector<SVGEllipseElement>('[data-mouth]');
      open?.setAttribute('rx', (view.mouth.rx * (1 + mouth * 0.4)).toFixed(1));
      open?.setAttribute('ry', (view.mouth.ry * mouth).toFixed(1));
      open?.setAttribute('opacity', Math.min(1, mouth * 5).toFixed(2));
      root.querySelectorAll<SVGElement>('[data-blush]').forEach(el => el.setAttribute('opacity', String(BLUSH[mood.current] ?? 0)));
      const s = now / 1000, motion = still.matches ? 0 : 1;
      const angle = SWAY_DEG * swing(s) * motion;
      // The hair trails the head: its tips hang nearly still while the face swings
      // beneath, then catch up. Gusts come and go on slow, unrelated clocks.
      const lag = -0.8 * SWAY_DEG * swing(s - 0.7) * Math.PI / 180 * FACE_RADIUS;
      const gust = Math.max(0, Math.sin(2 * Math.PI * s / 9) * Math.sin(2 * Math.PI * s / 14 + 0.7));
      // Each piece flutters on a fast clock of its own phase.
      if (hair.current && view.hair) hair.current.draw(view.hair.locks.map((lock, i) => {
        const px = lag + 12 * gust + (5 + 7 * gust + 4 * mouth) * Math.sin(2 * Math.PI * s / 1.6 + i * 1.7);
        return -motion * px / lock.reach;
      }));
      if (frame.current) {
        // Scaling about the pivot (30% above the frame) pushes the picture down by
        // 1.5% and leaves a gap at the top; 4% up splits the overscan evenly.
        frame.current.style.transform = `translateY(-4%) translateY(${(motion * (6 * Math.sin(2 * Math.PI * s / SWAY_S + 1.2) + breath * 2) + mouth * 2).toFixed(1)}px) rotate(${angle.toFixed(3)}deg) scale(${OVERSCAN})`;
        frame.current.style.filter = sleeping.current ? 'brightness(0.55)' : '';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); off.forEach(fn => fn?.()); player.dispose(); };
  }, [view]);

  const [fx, fy, fw, fh] = view.frame;
  const picture = <image href={hairReady && view.hair ? view.hair.plate : view.image} x={fx} y={fy} width={fw} height={fh}/>;
  return (
    <div className="portrait">
      <div className="portrait-frame" ref={frame}>
        <svg ref={svg} viewBox={view.viewBox.join(' ')} preserveAspectRatio="xMidYMid slice">
          <defs>
            {view.eyes.map((eye, i) => <clipPath key={i} id={`eye-${i}`}><polygon points={eye.open}/></clipPath>)}
            {/* Eased out to nothing (a smoothstep in stops): a straight ramp ends in a visible straight line. */}
            <linearGradient id="lid-shade" x1="0" y1="0" x2="0" y2="1">
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map(o => <stop key={o} offset={o} stopColor={LID_SHADE} stopOpacity={(0.6 * (1 - o * o * (3 - 2 * o))).toFixed(3)}/>)}
            </linearGradient>
            <radialGradient id="blush"><stop offset="0" stopColor="#f6a3b0" stopOpacity="0.5"/><stop offset="1" stopColor="#f6a3b0" stopOpacity="0"/></radialGradient>
          </defs>
          {picture}
          {view.eyes.map((eye, i) => (
            <g key={i}>
            <g clipPath={`url(#eye-${i})`}>
              <polygon points={eye.open} fill={SCLERA}/>
              <g data-gaze="">
                {/* The sheet's own iris and pupil, placed by the traced centre and radius. */}
                <image href={irisSprite} x={eye.iris.cx - eye.iris.r} y={eye.iris.cy - eye.iris.r} width={eye.iris.r * 2} height={eye.iris.r * 2}/>
                {/* The cel-style glow across the lower iris; it belongs to the iris, so it slides with the gaze and the pupil cuts through it. */}
                <polygon points={irisPoints(eye, LOWER_GLOW)} fill={GLOW} stroke={GLOW} strokeWidth={eye.iris.r * 0.08} strokeLinejoin="round"/>
                <g data-pupil={`${eye.pupil.cx} ${eye.pupil.cy}`} transform={`translate(${eye.pupil.cx} ${eye.pupil.cy})`}>
                  <image href={pupilSprite} x={-eye.pupil.rx} y={-eye.pupil.ry} width={eye.pupil.rx * 2} height={eye.pupil.ry * 2} preserveAspectRatio="none"/>
                </g>
              </g>
              {/* Reflections, fixed on the eye: one angular catch-light high on the left and two slanted dashes right of the pupil. */}
              <polygon points={irisPoints(eye, CATCH)} fill={CATCHLIGHT} stroke={CATCHLIGHT} strokeWidth={eye.iris.r * 0.07} strokeLinejoin="round"/>
              {DASHES.map((dash, j) => <polygon key={j} points={irisPoints(eye, dash)} fill={CATCHLIGHT} stroke={CATCHLIGHT} strokeWidth={eye.iris.r * 0.025} strokeLinejoin="round" opacity="0.9"/>)}
              <rect x={eye.iris.cx - 400} y={eye.top} width={800} height={(eye.bottom - eye.top) * 0.6} fill="url(#lid-shade)"/>
              {/* The lid: skin that drops from above the opening (eyes without a pre-rendered blink). */}
              {!eye.blink && <g data-lid={i}>
                <rect x={eye.iris.cx - 400} y={eye.top - 400} width={800} height={eye.bottom - eye.top + 400 + 24} fill={LID}/>
              </g>}
            </g>
            {/* The lower lid line and lashes from the eye sheet; the upper band is in the blink frames. */}
            {eye.outline && <image href={eye.outline.href} x={eye.outline.x} y={eye.outline.y} width={eye.outline.w} height={eye.outline.h} preserveAspectRatio="none"/>}
            {eye.blink && <g data-blink={i}>
              {Array.from({ length: eye.blink.frames }, (_, k) => (
                <svg key={k} x={eye.blink!.x} y={eye.blink!.y} width={eye.blink!.w} height={eye.blink!.h} viewBox={`0 ${k * eye.blink!.frameH} ${eye.blink!.frameW} ${eye.blink!.frameH}`} preserveAspectRatio="none" visibility={k === 0 ? 'visible' : 'hidden'}>
                  <image href={eye.blink!.href} width={eye.blink!.frameW} height={eye.blink!.frameH * eye.blink!.frames}/>
                </svg>
              ))}
            </g>}
            </g>
          ))}
          <ellipse data-mouth="" cx={view.mouth.cx} cy={view.mouth.cy} rx={view.mouth.rx} ry={0} opacity={0} fill="#3a1a24"/>
          {view.blush.map((b, i) => <ellipse key={i} data-blush="" cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill="url(#blush)" opacity={0}/>)}
        </svg>
        {view.hair && <canvas ref={canvas} className="portrait-layer"/>}
        {view.shadow && (
          <svg className="portrait-layer portrait-shadow" viewBox={view.viewBox.join(' ')} preserveAspectRatio="xMidYMid slice">
            <defs><filter id="shadow-edge" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter></defs>
            <polygon points={view.shadow} fill={SHADE} filter="url(#shadow-edge)"/>
          </svg>
        )}
      </div>
      <div className="portrait-panels">
        {panels.map(panel => (
          <section key={panel.id} className="portrait-panel">
            <h2>{panel.title}</h2>
            {panel.image && <img src={panel.image} alt=""/>}
            {panel.body && <p>{panel.body}</p>}
          </section>
        ))}
      </div>
      {caption && <p className="portrait-caption">{caption}</p>}
    </div>
  );
}
