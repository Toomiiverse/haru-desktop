import { useEffect, useRef, useState } from 'react';
import { createVoicePlayer } from './companion/mouth';
import type { EmotionName } from './types';
import portrait from '../build/portrait/haru-portrait.webp';
import './portrait.css';

/**
 * Her screen: the vertical monitor, with a close-up of her face filling it.
 *
 * The picture is a still; the life is three overlays drawn in its own pixel
 * space on top of it. Each eye is repainted over the original — a flat white
 * where the opening is, then the iris cut from the picture and slid toward
 * whatever the cursor is doing on the main monitor — so the artwork never has
 * to be edited. A skin-coloured lid drops over each opening for blinks and half-
 * lidded moods, and an open mouth is drawn over the drawn-on one while her voice
 * plays. The voice plays here too, muted at the window level by main, so the
 * mouth reads real amplitude rather than a guess timed against the text.
 */
const W = 1440, H = 2560;
// Eye openings, traced just inside the lashes. The lid hangs from `top`.
const EYES = [
  { open: '290,1062 320,1025 370,1008 430,1003 500,1006 548,1024 578,1052 560,1095 525,1135 470,1158 410,1160 350,1140 305,1105', top: 1000, bottom: 1162, iris: { cx: 452, cy: 1080, r: 92 } },
  { open: '900,985 915,935 960,908 1030,903 1100,910 1150,935 1178,975 1160,1020 1120,1055 1050,1072 980,1070 930,1045 908,1015', top: 900, bottom: 1074, iris: { cx: 993, cy: 987, r: 90 } },
];
const MOUTH = { cx: 748, cy: 1390 };
const EYE_WHITE = '#f9efee';
const LID = '#f8e3dc';
// How far the iris may slide. More than this and it leaves the opening.
const IRIS_TRAVEL = { x: 17, y: 11 };
// Cursor distance, in window pixels from her centre, that reads as "all the way
// over". The main monitor's centre sits about 2000px to her right, so the eyes
// reach the corner as the cursor crosses onto it.
const LOOK_RANGE = 1900;
// Half-lid per mood; everything else is wide open. Held until the next beat.
const LIDS: Partial<Record<EmotionName, number>> = { sleepy: 0.55, smug: 0.38, annoyed: 0.25, happy: 0.15, bored: 0.3 };
const BLUSH: Partial<Record<EmotionName, number>> = { embarrassed: 1, affectionate: 0.7, happy: 0.3 };

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

type Panel = { id: number; title: string; body: string; image: string; seconds: number };

export function PortraitWindow() {
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
    let lid = 0, blinkUntil = 0, nextBlink = performance.now() + 3000, mouth = 0;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const root = svg.current;
      if (!root) return;
      // Eyes lead the cursor by a beat; the lag is what makes it a glance.
      gaze.x += (cursor.current.x - gaze.x) * 0.08;
      gaze.y += (cursor.current.y - gaze.y) * 0.08;
      if (now >= nextBlink) { blinkUntil = now + 150; nextBlink = now + 2500 + Math.random() * 4500; }
      const rest = sleeping.current ? 1 : LIDS[mood.current] ?? 0;
      const lidTarget = now < blinkUntil ? 1 : rest;
      lid += (lidTarget - lid) * (lidTarget > lid ? 0.5 : 0.3);
      const reading = player.read();
      mouth += (reading.open * reading.weight - mouth) * 0.6;
      const breath = Math.sin(now / 2200) * 0.5 + 0.5;
      root.querySelectorAll<SVGGElement>('[data-iris]').forEach(el => el.setAttribute('transform', `translate(${(gaze.x * IRIS_TRAVEL.x).toFixed(1)} ${(gaze.y * IRIS_TRAVEL.y).toFixed(1)})`));
      root.querySelectorAll<SVGRectElement>('[data-lid]').forEach(el => {
        const eye = EYES[Number(el.dataset.lid)];
        el.setAttribute('height', String(Math.round((eye.bottom - eye.top + 20) * lid)));
      });
      const open = root.querySelector<SVGEllipseElement>('[data-mouth]');
      // Nothing drawn at rest: the picture's own mouth is the closed one.
      open?.setAttribute('rx', (34 + mouth * 14).toFixed(1));
      open?.setAttribute('ry', (mouth * 38).toFixed(1));
      open?.setAttribute('opacity', Math.min(1, mouth * 5).toFixed(2));
      root.querySelectorAll<SVGElement>('[data-blush]').forEach(el => el.setAttribute('opacity', String(BLUSH[mood.current] ?? 0)));
      if (frame.current) {
        frame.current.style.transform = `translateY(${(breath * 3 + mouth * 2).toFixed(1)}px) scale(${(1 + breath * 0.004).toFixed(4)})`;
        frame.current.style.filter = sleeping.current ? 'brightness(0.55)' : '';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); off.forEach(fn => fn?.()); player.dispose(); };
  }, []);

  return (
    <div className="portrait">
      <div className="portrait-frame" ref={frame}>
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          <defs>
            {EYES.map((eye, i) => <clipPath key={i} id={`eye-${i}`}><polygon points={eye.open}/></clipPath>)}
            {EYES.map((eye, i) => <clipPath key={i} id={`iris-${i}`}><circle cx={eye.iris.cx} cy={eye.iris.cy} r={eye.iris.r}/></clipPath>)}
            <radialGradient id="blush"><stop offset="0" stopColor="#f6a3b0" stopOpacity="0.55"/><stop offset="1" stopColor="#f6a3b0" stopOpacity="0"/></radialGradient>
          </defs>
          <image href={portrait} width={W} height={H}/>
          {EYES.map((eye, i) => (
            <g key={i} clipPath={`url(#eye-${i})`}>
              <polygon points={eye.open} fill={EYE_WHITE}/>
              <g data-iris="" clipPath={`url(#iris-${i})`}><image href={portrait} width={W} height={H}/></g>
              <g data-lid={i}>
                <rect x={eye.iris.cx - 200} y={eye.top - 20} width={400} height={0} fill={LID}/>
              </g>
            </g>
          ))}
          <ellipse data-mouth="" cx={MOUTH.cx} cy={MOUTH.cy} rx={34} ry={0} opacity={0} fill="#5a1f2b"/>
          <ellipse data-blush="" cx={340} cy={1250} rx={120} ry={70} fill="url(#blush)" opacity={0}/>
          <ellipse data-blush="" cx={1130} cy={1160} rx={120} ry={70} fill="url(#blush)" opacity={0}/>
        </svg>
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
