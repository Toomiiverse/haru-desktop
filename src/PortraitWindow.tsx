import { useEffect, useRef, useState } from 'react';
import { createVoicePlayer } from './companion/mouth';
import type { EmotionName } from './types';
import { DEFAULT_VIEW, type View } from './portraitRig';
import irisSprite from '../build/portrait/iris.png';
import pupilSprite from '../build/portrait/pupil.png';
import shineSprite from '../build/portrait/shine.png';
import './portrait.css';

/**
 * Her screen: the vertical monitor, with her portrait filling it.
 *
 * The picture is a still and the life is a rig drawn over it in the picture's
 * own pixels (portraitRig.ts says where everything is). Each eye is redrawn
 * from the part sheet — sclera, the sheet's iris and slit pupil sliding with
 * the gaze and narrowing with the mood, its reflections fixed, and a
 * skin-coloured lid with a lash edge that drops for blinks and half-lidded
 * moods — so the artwork's own eyes are never edited, only covered. The hair is
 * cut into strand groups: a copy of the picture clipped to a region and masked
 * to hair pixels, each turning a fraction of a degree about its root with the
 * breath, so the fringe and side locks drift the way the old wallpaper's did.
 * An open mouth is drawn over the drawn-on one while her voice plays; the voice
 * plays here too, muted at the window level by main, so the mouth reads real
 * amplitude rather than a guess timed against the text.
 */
// The picture is grey apart from her eyes; these are the only colours drawn.
const SCLERA = '#f4eef4', LID = '#c4c4c4', LASH = '#1a1216';
// The reflection sprite is 272x218 with its large spot centred about (55,55)
// at radius 48; these place that spot on the traced one and size the rest.
const SHINE_SCALE = 272 / 48, SHINE_BIG = 55 / 48;
// Cursor distance, in window pixels from her centre, that reads as "all the way
// over". The main monitor's centre sits about 2000px to her right.
const LOOK_RANGE = 1900;
// Half-lid and pupil width per mood; everything else is open and round.
const LIDS: Partial<Record<EmotionName, number>> = { sleepy: 0.55, smug: 0.38, annoyed: 0.28, bored: 0.3, happy: 0.12 };
const DILATE: Partial<Record<EmotionName, number>> = { surprised: 2.2, curious: 1.6, affectionate: 1.5, annoyed: 0.7, determined: 0.7, sleepy: 0.9 };
const BLUSH: Partial<Record<EmotionName, number>> = { embarrassed: 1, affectionate: 0.7, happy: 0.3 };

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
    let lid = 0, blinkUntil = 0, nextBlink = performance.now() + 3000, mouth = 0, dilate = 1;
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
      dilate += ((DILATE[mood.current] ?? 1) - dilate) * 0.05;
      const reading = player.read();
      mouth += (reading.open * reading.weight - mouth) * 0.6;
      const breath = Math.sin(now / 2200);
      const dx = (gaze.x * view.travel.x).toFixed(1), dy = (gaze.y * view.travel.y).toFixed(1);
      root.querySelectorAll<SVGGElement>('[data-gaze]').forEach(el => el.setAttribute('transform', `translate(${dx} ${dy})`));
      root.querySelectorAll<SVGGElement>('[data-pupil]').forEach(el => el.setAttribute('transform', `translate(${el.dataset.pupil}) scale(${dilate.toFixed(3)} 1)`));
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
      // Strands drift with a slow swell, a little with the breath, a little with speech.
      root.querySelectorAll<SVGGElement>('[data-strand]').forEach(el => {
        const strand = view.strands[Number(el.dataset.strand)];
        const angle = strand.amp * (Math.sin(now / 2600 + strand.phase) * 0.7 + breath * 0.3 + mouth * 0.4);
        el.setAttribute('transform', `rotate(${angle.toFixed(3)} ${strand.pivot[0]} ${strand.pivot[1]})`);
      });
      if (frame.current) {
        frame.current.style.transform = `translateY(${(breath * 2 + 2 + mouth * 2).toFixed(1)}px) scale(${(1.003 + breath * 0.002).toFixed(4)})`;
        frame.current.style.filter = sleeping.current ? 'brightness(0.55)' : '';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); off.forEach(fn => fn?.()); player.dispose(); };
  }, [view]);

  const [fx, fy, fw, fh] = view.frame;
  const picture = <image href={view.image} x={fx} y={fy} width={fw} height={fh}/>;
  return (
    <div className="portrait">
      <div className="portrait-frame" ref={frame}>
        <svg ref={svg} viewBox={view.viewBox.join(' ')} preserveAspectRatio="xMidYMid slice">
          <defs>
            {view.eyes.map((eye, i) => <clipPath key={i} id={`eye-${i}`}><polygon points={eye.open}/></clipPath>)}
            {view.strands.map((strand, i) => <clipPath key={i} id={`strand-${i}`}><polygon points={strand.points}/></clipPath>)}
            <mask id="hair" maskUnits="userSpaceOnUse" x={fx} y={fy} width={fw} height={fh}><image href={view.mask} x={fx} y={fy} width={fw} height={fh}/></mask>
            <radialGradient id="blush"><stop offset="0" stopColor="#f6a3b0" stopOpacity="0.5"/><stop offset="1" stopColor="#f6a3b0" stopOpacity="0"/></radialGradient>
          </defs>
          {picture}
          {view.eyes.map((eye, i) => (
            <g key={i} clipPath={`url(#eye-${i})`}>
              <polygon points={eye.open} fill={SCLERA}/>
              <g data-gaze="">
                {/* The sheet's own iris and pupil, placed by the traced centre and radius. */}
                <image href={irisSprite} x={eye.iris.cx - eye.iris.r} y={eye.iris.cy - eye.iris.r} width={eye.iris.r * 2} height={eye.iris.r * 2}/>
                <g data-pupil={`${eye.pupil.cx} ${eye.pupil.cy}`} transform={`translate(${eye.pupil.cx} ${eye.pupil.cy})`}>
                  <image href={pupilSprite} x={-eye.pupil.rx} y={-eye.pupil.ry} width={eye.pupil.rx * 2} height={eye.pupil.ry * 2} preserveAspectRatio="none"/>
                </g>
              </g>
              {/* The sheet's reflections, scaled so the large one sits where the picture's did. */}
              <image href={shineSprite} x={eye.shine.cx - eye.shine.r * SHINE_BIG} y={eye.shine.cy - eye.shine.r * SHINE_BIG} width={eye.shine.r * SHINE_SCALE} height={eye.shine.r * SHINE_SCALE * 218 / 272}/>
              {/* The lid: skin that drops from above the opening, with a lash line along its edge. */}
              <g data-lid={i}>
                <rect x={eye.iris.cx - 400} y={eye.top - 400} width={800} height={eye.bottom - eye.top + 400 + 24} fill={LID}/>
                <rect x={eye.iris.cx - 400} y={eye.bottom + 16} width={800} height={10} fill={LASH}/>
              </g>
            </g>
          ))}
          {view.strands.map((_, i) => (
            <g key={i} data-strand={i}>
              <g mask="url(#hair)"><g clipPath={`url(#strand-${i})`}>{picture}</g></g>
            </g>
          ))}
          <ellipse data-mouth="" cx={view.mouth.cx} cy={view.mouth.cy} rx={view.mouth.rx} ry={0} opacity={0} fill="#3a1a24"/>
          {view.blush.map((b, i) => <ellipse key={i} data-blush="" cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill="url(#blush)" opacity={0}/>)}
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
