import { useEffect, useMemo, useRef, useState } from 'react';
import { CLOSED, LOUD_FLOOR, LOUD_S, MOUTH, SHUT, createVoicePlayer, mouthFor } from './companion/mouth';
import type { EmotionName } from './types';
import { DEFAULT_VIEW, type Eye, type View } from './portraitRig';
import { createHairLayer, createPlateLayer, headShift, type HairLayer, type Head, type PlateLayer } from './portraitHair';
import { createTerminal, fileFromTitle, TEAR_FILTER } from './portraitTerminal';
import { createHud } from './portraitHud';
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
 * The mouth comes from the mouth sheet and opens with her voice; the voice
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
const LIDS: Partial<Record<EmotionName, number>> = { sleepy: 0.55, smug: 0.38, annoyed: 0.28, bored: 0.3, happy: 0.12, determined: 0.2, affectionate: 0.18, embarrassed: 0.15, worried: 0.08 };
const DILATE: Partial<Record<EmotionName, number>> = { surprised: 2.2, curious: 1.6, affectionate: 1.5, worried: 1.3, embarrassed: 1.2, annoyed: 0.7, determined: 0.7, sleepy: 0.9 };
const BLUSH: Partial<Record<EmotionName, number>> = { embarrassed: 1, affectionate: 0.7, happy: 0.3 };
// The eye smile (her eyes shut into upward arcs): for SMILE_HOLD_MS when she turns happy or affectionate, and again
// for SMILE_BEAT_MS on a stressed syllable while she stays so, at most once in SMILE_GAP_MS; she would be blind if it
// lasted the whole mood. It closes about as fast as a blink and opens a little slower.
const SMILING: EmotionName[] = ['happy', 'affectionate'];
const SMILE_HOLD_MS = 1600, SMILE_BEAT_MS = 900, SMILE_GAP_MS = 6000, SMILE_CLOSE_MS = 60, SMILE_OPEN_MS = 140;
// Code-terminal bursts (portraitTerminal.ts): one for each tool she uses, and while he codes, one every CODING_S
// seconds or so (the first CODING_FIRST_S after he starts), never while she talks, thinks or sleeps.
const CODING_S = [40, 90], CODING_FIRST_S = [6, 15];
// Her brow per mood, in view px: `up` raises the whole brow, `inner` drops its inner end (toward her nose) while the
// outer end stays put; a negative inner raises it, the worried slant. A stressed syllable lifts it BROW_EMPHASIS
// more, thinking BROW_THINK; it eases between them over about BROW_EASE_MS.
// Only about a fifth of the brow shows between her locks, so the amounts are bold.
const BROW: Partial<Record<EmotionName, { up: number; inner: number }>> = {
  annoyed: { up: -6, inner: 26 }, determined: { up: -5, inner: 16 }, surprised: { up: 26, inner: -6 }, curious: { up: 12, inner: -5 },
  worried: { up: 6, inner: -22 }, embarrassed: { up: 3, inner: -14 }, sleepy: { up: -6, inner: 0 }, bored: { up: -8, inner: 4 },
  smug: { up: 4, inner: 8 }, happy: { up: 6, inner: -5 }, affectionate: { up: 4, inner: -8 },
};
const BROW_EMPHASIS = 6, BROW_THINK = { up: 5, inner: -6 }, BROW_EASE_MS = 220;

// The head's swing: degrees about a pivot 30% of the screen above the top
// edge, so the face moves ~1% of the screen; period from the recording.
const SWAY_DEG = 0.5, SWAY_S = 9.2;
// The picture is drawn this much larger so the swing never shows an edge.
const OVERSCAN = 1.05;
// How far the face sits from that pivot, in picture px: turns the swing into the hair's lag.
const FACE_RADIUS = 2176;
// Her head on top of the sway, on damped springs so it settles with a little give: idle, she shifts into a new
// small pose (roll, drop, sideways) every HEAD_IDLE_S seconds; talking, she holds a slight tilt to one side while
// explaining, nods a little on a stressed syllable (her compressed voice stresses most of them, so at most one nod
// every NOD_GAP_MS), and turns a touch with her eyes when she glances aside. The roll pivots at her face (HEAD_PIVOT
// of the frame's height below the sway's pivot), not at the sway's pivot above the screen.
const HEAD_IDLE_S = [5, 11], HEAD_IDLE = { roll: 0.6, drop: 5, side: 8 };
const HEAD_TALK_ROLL = 0.2, HEAD_GLANCE = { roll: 0.2, side: 5 }, HEAD_NOD = { drop: 12, roll: 0.3 }, NOD_GAP_MS = 1800;
const HEAD_SPRING = { omega: 2.4, damping: 0.8 }, HEAD_PIVOT = 0.85;
type Spring = { x: number; v: number };
/** Moves a damped spring toward `target` over `dt` seconds. */
function spring(p: Spring, target: number, dt: number) {
  const { omega, damping } = HEAD_SPRING;
  p.v += (omega * omega * (target - p.x) - 2 * damping * omega * p.v) * dt;
  p.x += p.v * dt;
}

// The blink: the band drops fast and speeds up as it goes, rests shut a moment, and lifts slower, easing out at
// the top, like a real blink; now and then a double, the second starting 0.2 s after the first reopens.
const BLINK = { close: 120, hold: 70, open: 260 };
const BLINK_MS = BLINK.close + BLINK.hold + BLINK.open;
const DOUBLE_BLINK = 0.35, DOUBLE_GAP = 200;
// While she talks her eyes follow it: once she has been talking a while (explaining) they settle into a narrower,
// focused look, opening back up on a stressed syllable with the pupils widening; she tends to blink in the pause
// between phrases, and now and then glances aside, up and away from you, as she starts a new thought.
// A stressed syllable: the level jumps from under EMPHASIS_FROM to over EMPHASIS_TO within EMPHASIS_RISE_MS.
const TALK_LID = 0.2, TALK_SETTLE_MS = 1500, EMPHASIS_MS = 450, EMPHASIS_DILATE = 0.3;
const EMPHASIS_FROM = 0.8, EMPHASIS_TO = 0.97, EMPHASIS_RISE_MS = 220;
const PHRASE_PAUSE_MS = 150, PHRASE_BLINK = 0.55, BLINK_SPACING_MS = 1200;
const GLANCE = 0.3, GLANCE_MS = [350, 800];
// Between conversations she behaves like someone in it. While her reply is being written she thinks: eyes up and
// away from you, drifting in small saccades, lids a touch lower, head tilted toward where she looks and chin up a
// little. At a full stop she often looks off the same way for the pause. Idle, she looks around now and then
// before coming back to you. Look targets are gaze positions (-1..1 across the main monitor's direction).
const THINK = { x: 0.5, y: -0.35, lid: 0.12, chin: -4, saccade: 0.08, saccadeMs: [700, 1500] };
const STOP_THINK = 0.6, STOP_LOOK_EXTRA_MS = 250;
const LOOK_AROUND_S = [7, 16], LOOK_AROUND_MS = [800, 2200], LOOK_AROUND = { x: 0.7, up: 0.35, down: 0.3 };
// Her head turns (yaw) and nods (pitch) like a Live2D model's: the one drawing, warped as if painted on a rounded
// head (see portraitHair.ts), so the style never changes. In radians. It turns a little toward you wherever you
// are, and further toward wherever her eyes go away from you (a glance, looking around, thinking), the eyes
// leading and the head following on its spring; idle poses and the explaining tilt add a little, and a stressed
// syllable nods it. Past about 13 degrees the warp starts to crowd her far cheek, hence the limits.
const YAW = { cursor: 0.06, look: 0.1, idle: 0.05, talk: 0.02, max: 0.22 };
const PITCH = { cursor: 0.03, look: 0.06, idle: 0.03, think: -0.06, max: 0.14, nod: 0.15 };
// The hair lags the turn: its tips trail by this share of the head's movement and catch up over HAIR_LAG_MS.
// The locks are measured in the picture's own px: every view cut from the landscape drawing has 1440 of them per 922
// view px (haru-closeup.webp is 1440 wide over its 922).
const HAIR_SWING = 0.8, HAIR_LAG_MS = 350, PICTURE_SCALE = 1440 / 922;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
/** How shut a blink that started `t` ms ago has the eye, 0..1. */
function blinkShape(t: number) {
  if (t < 0 || t > BLINK_MS) return 0;
  if (t < BLINK.close) return (t / BLINK.close) ** 2;
  if (t < BLINK.close + BLINK.hold) return 1;
  return (1 - (t - BLINK.close - BLINK.hold) / BLINK.open) ** 3;
}

// The mouth sheet as clean grey sprites (scripts/portrait/build_assets.py), all on the same 269x277 canvas.
const MOUTH_FILES = import.meta.glob('../build/portrait/mouth-sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const mouthHref = (name: string) => MOUTH_FILES[`../build/portrait/mouth-sprites/${name}.png`];
const MOUTH_CANVAS = { w: 269, h: 277 };
// Speaking, after the mouth chart (closed for b/m/p and pauses; a narrow slit with the teeth showing for ee/s/sh/t/f;
// round for oh, small round for oo/w; wide for ah; between for eh/l/th), each from the sheet's fanged mouths. Those are drawn with full lips (about 2.5x the
// closed line's width on the sheet), so they are shrunk to about her mouth's width, about the closed line's centre
// (canvas 139, 81).
const SPEAK = ['M_01', 'M_30', 'M_29', 'M_27', 'M_31', 'M_39'];
const SPEAK_SIZE = [1, 0.48, 0.48, 0.5, 0.55, 0.55];
// Between words her mouth rests in her mood: a closed fanged smile, a smirk, a grimace, gritted teeth, a flat line,
// a small o, a soft smile, a wavy line, a pout, a cat mouth; neutral keeps the drawn line. Each with its size, as above.
const REST: Partial<Record<EmotionName, [string, number]>> = {
  happy: ['M_28', 0.5], smug: ['M_19', 0.5], annoyed: ['M_24', 0.5], determined: ['M_36', 0.5], bored: ['M_30', 0.5], sleepy: ['M_30', 0.5],
  surprised: ['M_09', 0.8], affectionate: ['M_14', 0.55], embarrassed: ['M_11', 0.6], worried: ['M_18', 0.6], curious: ['M_35', 0.6],
};
// Shapes the talking set already has are shared with it (bored's flat line is the talking slit).
const REST_SHAPES = [...new Map(Object.values(REST).filter(([name]) => !SPEAK.includes(name)).map(([name, size]) => [name, size]))];
const SHAPES = [...SPEAK, ...REST_SHAPES.map(([name]) => name)], SHAPE_SIZE = [...SPEAK_SIZE, ...REST_SHAPES.map(([, size]) => size)];
const MOUTH_ANCHOR = { x: 139, y: 81 };

// At rest she has one line instead of M_01's traced patches: its centreline (fitted in canvas units), tapering to
// points at the corners, `thick` times as thick in the middle.
const neutralPath = (thick: number) => {
  const x0 = 100, x1 = 178, n = 40, y = (x: number) => 0.00694 * x * x - 2.02394 * x + 222.7615;
  const top: string[] = [], bottom: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, w = (0.15 + 0.85 * Math.sin(Math.PI * i / n) ** 0.7) * thick;
    top.push(`${x.toFixed(2)},${(y(x) - w).toFixed(2)}`); bottom.unshift(`${x.toFixed(2)},${(y(x) + w).toFixed(2)}`);
  }
  return `M${top.join('L')}L${bottom.join('L')}Z`;
};
// Drawn like the talking mouths: their line grey, softened, over a blurred band of their lip grey.
const NEUTRAL_LINE = neutralPath(1.5), NEUTRAL_LIP = neutralPath(2.4);
// Soft lip shade at the corners, as the talking mouths have.
const NEUTRAL_CORNERS = [100, 178].map(x => [x, 0.00694 * x * x - 2.02394 * x + 222.7615]);
// A shape is held at least this long, so quiet consonants do not flicker between two; shapes crossfade with this
// time constant.
const MOUTH_HOLD_MS = 70, MOUTH_FADE_MS = 18;
// The voice level opens the mouth quickly and lets it close more slowly (per-frame easing at 60 fps).
const MOUTH_ATTACK = 0.5, MOUTH_RELEASE = 0.22;


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
  const thinkingSince = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const terminalHost = useRef<HTMLDivElement>(null);
  const hudHost = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hair = useRef<HairLayer | null>(null);
  const frontCanvas = useRef<HTMLCanvasElement>(null);
  const front = useRef<HairLayer | null>(null);
  const plateCanvas = useRef<HTMLCanvasElement>(null);
  const plate = useRef<PlateLayer | null>(null);
  // The plate replaces the picture only once the hair layer is drawing; until
  // then (or without WebGL) the painted-on hair stays. Her head turns only once
  // the plate is drawn by its own (warping) layer too.
  const [hairReady, setHairReady] = useState(false);
  const [plateReady, setPlateReady] = useState(false);
  // The head ellipse as fractions of the picture, which is what the layers warp in.
  const headUv = useMemo<Head | undefined>(() => {
    if (!view.head) return undefined;
    const [fx, fy, fw, fh] = view.frame, [cx, cy, rx, ry] = view.head;
    return [(cx - fx) / fw, (cy - fy) / fh, rx / fw, ry / fh];
  }, [view]);
  useEffect(() => {
    if (!view.hair || !canvas.current) return;
    let live = true;
    void createHairLayer(canvas.current, { image: view.image, mask: view.hair.mask, locks: view.hair.locks, kink: view.hair.kink, head: headUv }).then(layer => {
      if (!live) { layer?.dispose(); return; }
      hair.current = layer; setHairReady(!!layer);
    });
    // The locks in front of her headphones: the same hair layer again, masked to them, over the headphones.
    if (view.phones && frontCanvas.current) void createHairLayer(frontCanvas.current, { image: view.image, mask: view.phones.front, locks: view.hair.locks, kink: view.hair.kink, head: headUv }).then(layer => {
      if (!live) { layer?.dispose(); return; }
      front.current = layer;
    });
    if (view.head && headUv && plateCanvas.current) void createPlateLayer(plateCanvas.current, view.hair.plate, headUv).then(layer => {
      if (!live) { layer?.dispose(); return; }
      plate.current = layer; setPlateReady(!!layer);
    });
    return () => {
      live = false;
      hair.current?.dispose(); hair.current = null; setHairReady(false);
      front.current?.dispose(); front.current = null;
      plate.current?.dispose(); plate.current = null; setPlateReady(false);
    };
  }, [view, headUv]);

  useEffect(() => {
    const player = createVoicePlayer();
    const terminal = terminalHost.current ? createTerminal(terminalHost.current) : null;
    // Spin on her screen (portraitHud.ts), called up and worked by her music tool; she sings along to what it plays.
    const hud = hudHost.current ? createHud(hudHost.current) : null;
    const drift = { x: 0, y: 0 };
    const coding = { on: false, label: '', next: 0, hunk: null as { file: string; lines: string[] } | null };
    const between = ([lo, hi]: number[]) => 1000 * (lo + Math.random() * (hi - lo));
    const off = [
      // Called optionally: a build running against an older preload has neither, and the portrait must still come up.
      window.haru?.companion.onTerminal?.(line => terminal?.burst({ line, kind: 'tool' })),
      window.haru?.companion.onCoding?.(({ on, label }) => {
        if (on && !coding.on) coding.next = performance.now() + between(CODING_FIRST_S);
        Object.assign(coding, { on, label });
      }),
      // What he just wrote, shown as soon as she is free to; it waits for her to finish talking or thinking.
      window.haru?.companion.onCode?.(hunk => { coding.hunk = hunk; }),
      window.haru?.companion.onMusic?.(event => hud?.event(event)),
      window.haru?.voice.onClip(clip => player.play(clip)),
      window.haru?.voice.onStop(() => player.stop()),
      window.haru?.companion.onSay(setCaption),
      window.haru?.companion.onThinking(on => { thinkingSince.current = on ? performance.now() : 0; }),
      window.haru?.companion.onCursor(({ x, y }) => { cursor.current = { x: clamp((x - window.innerWidth / 2) / LOOK_RANGE), y: clamp((y - window.innerHeight / 2) / LOOK_RANGE) }; }),
      window.haru?.life.onEmotion(({ emotion }) => {
        if (SMILING.includes(emotion.emotion) && !SMILING.includes(mood.current)) smileUntil = performance.now() + SMILE_HOLD_MS;
        mood.current = emotion.emotion;
      }),
      window.haru?.life.onTick(({ vitals, action, night }) => { sleeping.current = action === 'doze' || (night && vitals.sleepiness > 0.85); }),
    ];
    const gaze = { x: 0, y: 0 };
    let lid = 0, restLid = 0, blinks: number[] = [], nextBlink = performance.now() + 3000, mouth = 0, dilate = 1;
    let mouthShown = 0, mouthAt = 0, last = performance.now(), loud = LOUD_FLOOR;
    let talkingSince = 0, pausedSince = 0, pauseHandled = false, emphasis = 0, rel = 0, lowAt = 0, lastNod = 0;
    // Where her eyes go instead of to you, and until when: an offset from you, or (absolute) a place of its own.
    const glance = { x: 0, y: 0, until: 0, absolute: false };
    let nextLook = performance.now() + 6000, nextSaccade = 0, lastPause: string | undefined;
    const lookAt = (x: number, y: number, until: number) => Object.assign(glance, { x, y, until, absolute: true });
    // Up and away from where you are: the side her thinking goes to.
    const awaySide = () => (cursor.current.x > 0 ? -1 : 1);
    const head = { roll: { x: 0, v: 0 }, drop: { x: 0, v: 0 }, side: { x: 0, v: 0 }, yaw: { x: 0, v: 0 }, pitch: { x: 0, v: 0 } };
    const idlePose = { roll: 0, drop: 0, side: 0, yaw: 0, pitch: 0, next: performance.now() + 4000 };
    let talkSide = 1, hairRoll = 0, hairYaw = 0, smileUntil = 0, smile = 0;
    const brow = { up: 0, inner: 0 };
    const mouthAlpha: number[] = SHAPES.map((_, k) => (k === 0 ? 1 : 0));
    let raf = 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const swing = (s: number) => Math.sin(2 * Math.PI * s / SWAY_S) + 0.25 * Math.sin(2 * Math.PI * s / 13.7 + 1);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now(), dt = Math.min(100, now - last), motion = still.matches ? 0 : 1;
      last = now;
      const root = svg.current;
      if (!root) return;
      const reading = player.read();
      // Her own voice first; while she is quiet and Spin plays, the song's singing track drives her mouth instead.
      const song = reading.weight > 0.05 ? null : hud?.sing.read() ?? null;
      const heard = song ?? reading;
      const hudBeat = hud?.tick(now, motion, drift);
      const voice = heard.open * heard.weight;
      mouth += (voice - mouth) * (1 - (1 - (voice > mouth ? MOUTH_ATTACK : MOUTH_RELEASE)) ** (dt / 16.7));
      loud = Math.max(mouth, loud * Math.exp(-dt / (LOUD_S * 1000)), LOUD_FLOOR);
      rel = mouth / loud;
      if (rel < EMPHASIS_FROM) lowAt = now;
      // How she talks, for the eyes: how long she has been at it, the pauses between phrases, stressed syllables.
      const talking = reading.weight > 0.5, shut = mouth < SHUT || rel < CLOSED;
      if (!talking) talkingSince = pausedSince = 0;
      else {
        if (!talkingSince) { talkingSince = now; talkSide = Math.random() < 0.5 ? -1 : 1; }
        if (shut) {
          pausedSince ||= now;
          if (!pauseHandled && now - pausedSince > PHRASE_PAUSE_MS) {
            pauseHandled = true;
            if (Math.random() < PHRASE_BLINK && now - (blinks[blinks.length - 1] ?? 0) > BLINK_SPACING_MS + BLINK_MS) {
              blinks = [now];
              nextBlink = now + BLINK_MS + 2500 + Math.random() * 3000;
            }
          }
        } else {
          if (pauseHandled && Math.random() < GLANCE) {
            const away = cursor.current.x > 0 ? -1 : 1;
            Object.assign(glance, { x: away * (0.3 + 0.2 * Math.random()), y: -(0.1 + 0.15 * Math.random()), absolute: false });
            glance.until = now + GLANCE_MS[0] + Math.random() * (GLANCE_MS[1] - GLANCE_MS[0]);
          }
          pausedSince = 0; pauseHandled = false;
        }
      }
      if (talking && rel > EMPHASIS_TO && lowAt && now - lowAt < EMPHASIS_RISE_MS) {
        emphasis = 1; lowAt = 0;
        if (SMILING.includes(mood.current) && now - (smileUntil - SMILE_BEAT_MS) > SMILE_GAP_MS) smileUntil = now + SMILE_BEAT_MS;
        if (now - lastNod >= NOD_GAP_MS) {
          lastNod = now;
          head.drop.v += HEAD_NOD.drop * motion;
          head.roll.v += HEAD_NOD.roll * talkSide * motion;
          head.pitch.v += PITCH.nod * motion;
        }
      }
      emphasis = Math.max(0, emphasis - dt / EMPHASIS_MS);
      const talkLid = talkingSince ? TALK_LID * smooth((now - talkingSince) / TALK_SETTLE_MS) * (1 - emphasis) : 0;
      // Thinking (her reply being written), the pause at a full stop, looking around while idle.
      if (talking) thinkingSince.current = 0;
      const thinking = thinkingSince.current > 0 && now - thinkingSince.current < 60_000;
      if (thinking) {
        if (now >= nextSaccade || glance.until < now) {
          const side = glance.until > now && glance.absolute ? Math.sign(glance.x) || awaySide() : awaySide();
          const jitter = () => (Math.random() * 2 - 1) * THINK.saccade;
          lookAt(side * THINK.x + jitter(), THINK.y + jitter(), now + 60_000);
          nextSaccade = now + THINK.saccadeMs[0] + Math.random() * (THINK.saccadeMs[1] - THINK.saccadeMs[0]);
        }
      } else if (glance.absolute && glance.until - now > 30_000) glance.until = now;
      if (reading.pause === 'stop' && lastPause !== 'stop' && Math.random() < STOP_THINK)
        lookAt(awaySide() * THINK.x * (0.7 + 0.3 * Math.random()), THINK.y * (0.6 + 0.4 * Math.random()), now + 380 + STOP_LOOK_EXTRA_MS);
      lastPause = reading.pause;
      if (!talking && !thinking && !sleeping.current && now >= nextLook && now >= glance.until) {
        const up = Math.random() < 0.5;
        lookAt((Math.random() * 2 - 1) * LOOK_AROUND.x, up ? -Math.random() * LOOK_AROUND.up : Math.random() * LOOK_AROUND.down,
          now + LOOK_AROUND_MS[0] + Math.random() * (LOOK_AROUND_MS[1] - LOOK_AROUND_MS[0]));
        nextLook = glance.until + 1000 * (LOOK_AROUND_S[0] + Math.random() * (LOOK_AROUND_S[1] - LOOK_AROUND_S[0]));
      }
      // Working the music: she looks at its panel when it opens or acts, and now and then while it plays (re-asserted
      // every frame, so thinking, pauses and glances do not take her eyes off it). A command gets a small nod; the
      // song's beat a gentle bob while she is not talking.
      if (hudBeat?.look) lookAt(hudBeat.look.x, hudBeat.look.y, now + 200);
      if (hudBeat?.nod && now - lastNod >= 600) { lastNod = now; head.drop.v += HEAD_NOD.drop * 0.7 * motion; head.pitch.v += PITCH.nod * 0.7 * motion; }
      if (hudBeat?.beat && !talking) head.drop.v += 3.5 * motion;
      // Eyes lead the cursor by a beat; the lag is what makes it a glance.
      const glancing = now < glance.until;
      const target = !glancing ? cursor.current : glance.absolute ? glance : { x: cursor.current.x + glance.x, y: cursor.current.y + glance.y };
      gaze.x += (clamp(target.x) - gaze.x) * 0.08;
      gaze.y += (clamp(target.y) - gaze.y) * 0.08;
      if (now >= nextBlink) {
        blinks = Math.random() < DOUBLE_BLINK ? [now, now + BLINK_MS + DOUBLE_GAP] : [now];
        nextBlink = blinks[blinks.length - 1] + BLINK_MS + 3000 + Math.random() * 4000;
      }
      const rest = sleeping.current ? 1 : Math.max(LIDS[mood.current] ?? 0, talkLid, thinking ? THINK.lid : 0);
      restLid += (rest - restLid) * 0.08;
      lid = Math.max(restLid, ...blinks.map(start => blinkShape(now - start)));
      dilate += ((DILATE[mood.current] ?? 1) + EMPHASIS_DILATE * emphasis - dilate) * 0.05;
      const breath = Math.sin(now / 2200);
      const dx = (gaze.x * view.travel.x).toFixed(1), dy = (gaze.y * view.travel.y).toFixed(1);
      root.querySelectorAll<SVGGElement>('[data-gaze]').forEach(el => el.setAttribute('transform', `translate(${dx} ${dy})`));
      // The pupil stays through a blink: the lid's skin and shadow in the blink frames cover it as they come down.
      root.querySelectorAll<SVGGElement>('[data-pupil]').forEach(el => {
        el.setAttribute('transform', `translate(${el.dataset.pupil}) scale(${dilate.toFixed(3)} 1)`);
      });
      // The eye smile: while it is closing or shut its frames take over from the blink's (both start from the same
      // open frame, so the swap does not show); a blink during it closes the arc the rest of the way.
      const smileWant = now < smileUntil && !sleeping.current ? 1 : 0;
      smile = motion ? smile + (smileWant - smile) * (1 - Math.exp(-dt / (smileWant > smile ? SMILE_CLOSE_MS : SMILE_OPEN_MS))) : smileWant;
      const smiling = smile > 0.02;
      // The pre-rendered blink (or smile): show the frame for this much shut (blending two would show the band twice).
      const showFrame = (el: SVGGElement, amount: number) => {
        const shown = Number(el.dataset.shown ?? 0), next = Math.round(amount * (el.children.length - 1));
        if (next === shown) return;
        (el.children[shown] as SVGElement).style.display = 'none';
        (el.children[next] as SVGElement).style.display = '';
        el.dataset.shown = String(next);
      };
      // Hidden with display, not visibility: a child's own visibility="visible" shows through a hidden parent, and
      // the smile sheet's open frame stayed drawn over every blink. Inline, because portrait.css sets display on svg.
      root.querySelectorAll<SVGGElement>('[data-blink]').forEach(el => { el.style.display = smiling ? 'none' : ''; showFrame(el, smiling ? 0 : lid); });
      root.querySelectorAll<SVGGElement>('[data-smile]').forEach(el => { el.style.display = smiling ? '' : 'none'; showFrame(el, smiling ? Math.max(smile, lid) : 0); });
      root.querySelectorAll<SVGGElement>('[data-lid]').forEach(el => {
        const eye = view.eyes[Number(el.dataset.lid)];
        const drop = eye.bottom - eye.top + 24;
        el.setAttribute('transform', `translate(0 ${(drop * lid - drop).toFixed(1)})`);
      });
      // The mouth shape for her voice level right now.
      const shapes = root.querySelector('[data-mouth]')?.children;
      let want: number = mouthFor(mouth, rel, heard.bands);
      // Within a sung line her mouth stays parted, the slit the least it goes, so the shapes flow into each other.
      if (want === MOUTH.closed && song?.sung) want = MOUTH.slit;
      if (want === MOUTH.closed && !sleeping.current && REST[mood.current]) want = SHAPES.indexOf(REST[mood.current]![0]);
      if (want !== mouthShown && now - mouthAt >= MOUTH_HOLD_MS) { mouthShown = want; mouthAt = now; }
      const fade = 1 - Math.exp(-dt / MOUTH_FADE_MS);
      if (shapes) mouthAlpha.forEach((a, k) => {
        const next = a + ((k === mouthShown ? 1 : 0) - a) * fade;
        mouthAlpha[k] = next < 0.01 ? 0 : next > 0.99 ? 1 : next;
        if (mouthAlpha[k] !== a) shapes[k].setAttribute('opacity', mouthAlpha[k].toFixed(2));
      });
      root.querySelectorAll<SVGElement>('[data-blush]').forEach(el => el.setAttribute('opacity', String(BLUSH[mood.current] ?? 0)));
      // The brow: raised or lowered whole, its inner end turned about the outer.
      const browEl = root.querySelector<SVGGElement>('[data-brow]');
      if (browEl && view.brow) {
        const want = BROW[mood.current] ?? { up: 0, inner: 0 }, k = 1 - Math.exp(-dt / BROW_EASE_MS);
        brow.up += (want.up + BROW_EMPHASIS * emphasis + (thinking ? BROW_THINK.up : 0) - brow.up) * k;
        brow.inner += (want.inner + (thinking ? BROW_THINK.inner : 0) - brow.inner) * k;
        const [ox, oy] = view.brow.outer, length = Math.hypot(view.brow.inner[0] - ox, view.brow.inner[1] - oy);
        browEl.setAttribute('transform', `translate(0 ${(-brow.up).toFixed(1)}) rotate(${(-Math.atan2(brow.inner, length) * 180 / Math.PI).toFixed(2)} ${ox} ${oy})`);
      }
      const s = now / 1000;
      const angle = SWAY_DEG * swing(s) * motion;
      // Her head: a new idle pose now and then, the explaining tilt, turning with a glance.
      if (now >= idlePose.next) {
        const r = () => Math.random() * 2 - 1;
        Object.assign(idlePose, { roll: HEAD_IDLE.roll * r(), drop: HEAD_IDLE.drop * r(), side: HEAD_IDLE.side * r(), yaw: YAW.idle * r(), pitch: PITCH.idle * r() });
        idlePose.next = now + 1000 * (HEAD_IDLE_S[0] + Math.random() * (HEAD_IDLE_S[1] - HEAD_IDLE_S[0]));
      }
      const explaining = talkingSince ? smooth((now - talkingSince) / TALK_SETTLE_MS) : 0;
      // The head turns a little with where her eyes go, by how far that is from you.
      const turn = glancing ? clamp((clamp(target.x) - cursor.current.x) / 0.5) : 0;
      spring(head.roll, motion * (idlePose.roll * (1 - explaining) + HEAD_TALK_ROLL * talkSide * explaining + HEAD_GLANCE.roll * turn), dt / 1000);
      spring(head.drop, motion * (idlePose.drop + (thinking ? THINK.chin : 0)), dt / 1000);
      spring(head.side, motion * (idlePose.side + HEAD_GLANCE.side * turn), dt / 1000);
      hairRoll += (head.roll.x - hairRoll) * (1 - Math.exp(-dt / 500));
      // Turning and nodding: toward you a little, toward where her eyes go away from you more.
      const lim = (v: number, max: number) => Math.max(-max, Math.min(max, v));
      spring(head.yaw, motion * lim(YAW.cursor * cursor.current.x + YAW.look * (clamp(target.x) - cursor.current.x)
        + idlePose.yaw * (1 - explaining) + YAW.talk * talkSide * explaining, YAW.max), dt / 1000);
      spring(head.pitch, motion * lim(PITCH.cursor * cursor.current.y + PITCH.look * (clamp(target.y) - cursor.current.y)
        + idlePose.pitch + (thinking ? PITCH.think : 0), PITCH.max), dt / 1000);
      hairYaw += (head.yaw.x - hairYaw) * (1 - Math.exp(-dt / HAIR_LAG_MS));
      const turnBy: [number, number] = plateReady && view.head ? [Math.sin(head.yaw.x), Math.sin(head.pitch.x)] : [0, 0];
      plate.current?.draw(turnBy);
      // What is drawn over the picture (eyes, mouth, blush) moves with the face under it.
      if (view.head) root.querySelectorAll<SVGElement>('[data-warp]').forEach(el => {
        const [x, y] = el.dataset.warp!.split(' ').map(Number), [dx, dy] = headShift(view.head!, turnBy, x, y);
        el.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
      });
      // The hair's tips trail the turn: the face's shift since the hair last caught up, in the picture's own px.
      const trail = view.head ? HAIR_SWING * (Math.sin(head.yaw.x) - Math.sin(hairYaw)) * view.head[2] * PICTURE_SCALE : 0;
      // The hair trails the head: its tips hang nearly still while the face swings
      // beneath, then catch up. Gusts come and go on slow, unrelated clocks.
      const lag = -0.8 * (SWAY_DEG * swing(s - 0.7) + hairRoll) * Math.PI / 180 * FACE_RADIUS;
      const gust = Math.max(0, Math.sin(2 * Math.PI * s / 9) * Math.sin(2 * Math.PI * s / 14 + 0.7));
      // Each piece flutters on a fast clock of its own phase.
      const angles = view.hair?.locks.map((lock, i) => {
        const px = lag + trail + 12 * gust + (5 + 7 * gust + 4 * mouth) * Math.sin(2 * Math.PI * s / 1.6 + i * 1.7);
        return -motion * px / lock.reach;
      });
      if (angles) { hair.current?.draw(angles, turnBy); front.current?.draw(angles, turnBy); }
      if (frame.current) {
        // Scaling about the pivot (30% above the frame) pushes the picture down by
        // 1.5% and leaves a gap at the top; 4% up splits the overscan evenly.
        const bob = motion * (6 * Math.sin(2 * Math.PI * s / SWAY_S + 1.2) + breath * 2) + head.drop.x;
        drift.x = head.side.x; drift.y = bob;
        const pivot = `${HEAD_PIVOT * 100}%`;
        frame.current.style.transform = `translateY(-4%) translate(${head.side.x.toFixed(1)}px, ${bob.toFixed(1)}px) rotate(${angle.toFixed(3)}deg) translateY(${pivot}) rotate(${head.roll.x.toFixed(3)}deg) translateY(-${pivot}) scale(${OVERSCAN})`;
      }
      if (terminal && coding.hunk && !talking && !thinking && !sleeping.current) {
        terminal.burst({ line: coding.hunk.file, lines: coding.hunk.lines, kind: 'coding' });
        coding.hunk = null; coding.next = now + between(CODING_S);
      }
      if (terminal && coding.on && now >= coding.next && !talking && !thinking && !sleeping.current && !terminal.active) {
        terminal.burst({ line: fileFromTitle(coding.label), kind: 'coding' });
        coding.next = now + between(CODING_S);
      }
      const tearing = terminal?.tick(now, motion) ?? false;
      if (frame.current) frame.current.style.filter = [sleeping.current ? 'brightness(0.55)' : '', tearing ? `url(#${TEAR_FILTER})` : ''].join(' ').trim();
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); off.forEach(fn => fn?.()); player.dispose(); terminal?.dispose(); hud?.dispose(); };
  }, [view, plateReady]);

  const [fx, fy, fw, fh] = view.frame;
  // Drawn by the plate layer (under this SVG) once it is up; until then, here.
  const picture = plateReady ? null : <image href={hairReady && view.hair ? view.hair.plate : view.image} x={fx} y={fy} width={fw} height={fh}/>;
  return (
    <div className="portrait">
      <div className="portrait-frame" ref={frame}>
        {view.head && <canvas ref={plateCanvas} className="portrait-layer"/>}
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
          {view.brow && (
            <g data-warp={`${(view.brow.inner[0] + view.brow.outer[0]) / 2} ${(view.brow.inner[1] + view.brow.outer[1]) / 2}`}>
              <g data-brow=""><image href={view.brow.href} x={view.brow.x} y={view.brow.y} width={view.brow.w} height={view.brow.h} preserveAspectRatio="none"/></g>
            </g>
          )}
          {view.eyes.map((eye, i) => (
            <g key={i} data-warp={`${eye.iris.cx} ${eye.iris.cy}`}>
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
            {([['blink', eye.blink], ['smile', eye.smile]] as const).map(([kind, sheet]) => sheet && (
              <g key={kind} {...{ [`data-${kind}`]: i }} style={{ display: kind === 'blink' ? undefined : 'none' }}>
                {Array.from({ length: sheet.frames }, (_, k) => (
                  <svg key={k} x={sheet.x} y={sheet.y} width={sheet.w} height={sheet.h} viewBox={`0 ${k * sheet.frameH} ${sheet.frameW} ${sheet.frameH}`} preserveAspectRatio="none" style={{ display: k === 0 ? undefined : 'none' }}>
                    <image href={sheet.href} width={sheet.frameW} height={sheet.frameH * sheet.frames}/>
                  </svg>
                ))}
              </g>
            ))}
            </g>
          ))}
          <g data-mouth="" data-warp={`${view.mouth.x + MOUTH_ANCHOR.x * view.mouth.scale} ${view.mouth.y + MOUTH_ANCHOR.y * view.mouth.scale}`}>
            {SHAPES.map((name, k) => {
              if (k === 0) return (
                <g key={name} transform={`translate(${view.mouth.x} ${view.mouth.y}) scale(${view.mouth.scale})`} opacity={1}>
                  <filter id="neutral-lip" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="1.4"/></filter>
                  {/* The talking mouths' traced line is a little rough: the same wobble, small. */}
                  <filter id="neutral-line" x="-10%" y="-100%" width="120%" height="300%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves={2} seed={3} result="n"/>
                    <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" xChannelSelector="R" yChannelSelector="G" result="d"/>
                    <feGaussianBlur in="d" stdDeviation="0.12"/>
                  </filter>
                  <path d={NEUTRAL_LIP} fill="#9a9a9a" opacity={0.4} filter="url(#neutral-lip)" transform="translate(0 3.5)"/>
                  <path d={NEUTRAL_LINE} fill="#545454" filter="url(#neutral-line)"/>
                  {NEUTRAL_CORNERS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.6} fill="#9a9a9a" opacity={0.7} filter="url(#neutral-lip)"/>)}
                </g>
              );
              const s = view.mouth.scale * SHAPE_SIZE[k], d = view.mouth.scale - s;
              return <image key={name} href={mouthHref(name)} x={view.mouth.x + MOUTH_ANCHOR.x * d} y={view.mouth.y + MOUTH_ANCHOR.y * d} width={MOUTH_CANVAS.w * s} height={MOUTH_CANVAS.h * s} opacity={0}/>;
            })}
          </g>
          {view.blush.map((b, i) => <ellipse key={i} data-blush="" data-warp={`${b.cx} ${b.cy}`} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill="url(#blush)" opacity={0}/>)}
        </svg>
        {view.hair && <canvas ref={canvas} className="portrait-layer"/>}
        {view.phones && (
          <>
            <svg className="portrait-layer" viewBox={view.viewBox.join(' ')} preserveAspectRatio="xMidYMid slice">
              <image href={view.phones.href} x={view.phones.x} y={view.phones.y} width={view.phones.w} height={view.phones.h} preserveAspectRatio="none"/>
            </svg>
            <canvas ref={frontCanvas} className="portrait-layer"/>
          </>
        )}
        {view.shadow && (
          // Only where the picture is: past a see-through edge there is nothing of hers to shade.
          <svg className="portrait-layer portrait-shadow" viewBox={view.viewBox.join(' ')} preserveAspectRatio="xMidYMid slice"
            style={{ maskImage: `url(${view.image})`, maskSize: '100% 100%', WebkitMaskImage: `url(${view.image})`, WebkitMaskSize: '100% 100%' }}>
            <defs><filter id="shadow-edge" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter></defs>
            <polygon points={view.shadow} fill={SHADE} filter="url(#shadow-edge)"/>
          </svg>
        )}
      </div>
      {/* On the glass, not on her: it stays put while her head sways. */}
      <div ref={terminalHost} className="portrait-terminal"/>
      {/* Spin, Jarvis-style, on the glass above her eyes; the panels and caption stay over it. */}
      <div ref={hudHost} className="portrait-hud"/>
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
