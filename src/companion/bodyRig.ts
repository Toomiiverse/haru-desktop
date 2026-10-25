// Her whole figure's data: which lids, brows and mouth make each face, and how an arm or her head moves for a
// gesture. Pure data, no DOM, so the test can read it; the names are the groups in build/body/haru.svg.
import type { HaruEmotion } from '../../electron/emotions';

export type BodyFace = { lids: string; brows: string; mouth: string; blush?: boolean };
const face = (lids: string, brows: string, mouth: string, blush?: true): BodyFace => ({ lids, brows, mouth, blush });

/** Every face, as its parts. One drawing per part rather than one per face: 47 faces from 12 lids, 7 brows, 14 mouths. */
export const BODY_EXPRESSIONS: Record<HaruEmotion, BodyFace> = {
  neutral: face('open', 'neutral', 'line'), happy: face('smile', 'up', 'smile'), excited: face('wide', 'up', 'grin'),
  sad: face('half', 'worried', 'frown'), angry: face('narrow', 'down', 'grit'), annoyed: face('half', 'down', 'flat'),
  surprised: face('wide', 'up', 'o'), confused: face('open', 'one-up', 'wavy'), curious: face('open', 'one-up', 'o-small'),
  embarrassed: face('half', 'worried', 'wavy', true), sleepy: face('heavy', 'neutral', 'line'), thinking: face('open', 'one-up', 'pout'),
  smug: face('half', 'smug', 'smirk'), love: face('heart', 'up', 'smile', true), unimpressed: face('half', 'neutral', 'flat'),
  skeptical: face('half', 'one-up', 'flat'), determined: face('narrow', 'down', 'grit'), wink: face('wink', 'up', 'smile'),
  concerned: face('open', 'worried', 'frown'), attentive: face('wide', 'up', 'line'), shy: face('half', 'worried', 'wavy', true),
  content: face('smile', 'neutral', 'smile'), playful: face('wink', 'up', 'cat'), startled: face('wide', 'up', 'o-small'),
  disappointed: face('half', 'worried', 'frown'), relieved: face('closed', 'up', 'smile'), drowsy: face('heavy', 'neutral', 'line'),
  pain: face('pain', 'furrow', 'grit'), scared: face('wide', 'worried', 'wavy'), serious: face('narrow', 'down', 'flat'),
  silly: face('wink', 'up', 'tongue'), flirty: face('half', 'up', 'smirk', true), nervous: face('open', 'worried', 'wavy'),
  disbelief: face('wide', 'one-up', 'o'), rage: face('narrow', 'furrow', 'grimace'), disgusted: face('squint', 'down', 'grimace'),
  confident: face('open', 'smug', 'smirk'), drunk: face('half', 'up', 'wavy', true), pouty: face('half', 'down', 'pout'),
  sick: face('half', 'worried', 'wavy'), laughing: face('smile', 'up', 'grin'), snooty: face('closed', 'up', 'flat'),
  cold: face('squint', 'worried', 'grit'), crying: face('teary', 'worried', 'frown'), devious: face('narrow', 'smug', 'smirk'),
  pensive: face('half', 'neutral', 'line'), triumph: face('smile', 'up', 'grin'),
};

/** Lids that are drawn shut, or are not lids at all: a blink over them would squash a drawing that is already closed. */
export const NO_BLINK_LIDS = new Set(['closed', 'wink', 'smile', 'pain', 'heart']);

/** The talking mouths in the order mouth.ts's MOUTH numbers them; closed (0) is the face's own rest mouth. */
export const VISEMES = ['', 'slit', 'mid', 'wide', 'round', 'round-small'] as const;

export type ArmGesture = { duration: number; side: 'left' | 'right'; hand: string; shoulder: [number, number][]; elbow: [number, number][] };
/**
 * Arm gestures as rotation keyframes, degrees about the shoulder and the elbow, [offset, degrees]. Negative turns
 * the right arm outward and up. Hands are drawn fingers-down, so a raised forearm shows them up on its own. Each
 * starts and ends at rest. ponytail: right arm only; mirror the angles for a two-handed clip when one is wanted.
 */
export const ARM_GESTURES: Record<string, ArmGesture> = {
  wave: { duration: 2000, side: 'right', hand: 'wave', shoulder: [[0, 0], [.22, -15], [.82, -15], [1, 0]],
    elbow: [[0, 0], [.22, -135], [.36, -150], [.5, -118], [.64, -150], [.78, -120], [1, 0]] },
  point: { duration: 1700, side: 'right', hand: 'point', shoulder: [[0, 0], [.28, -15], [.8, -15], [1, 0]],
    elbow: [[0, 0], [.28, -150], [.8, -150], [1, 0]] },
  peace: { duration: 1900, side: 'right', hand: 'peace', shoulder: [[0, 0], [.26, -10], [.8, -10], [1, 0]],
    elbow: [[0, 0], [.26, -140], [.8, -140], [1, 0]] },
  fist: { duration: 1500, side: 'right', hand: 'fist', shoulder: [[0, 0], [.25, -30], [.42, -45], [.58, -30], [.72, -45], [1, 0]],
    elbow: [[0, 0], [.25, -130], [.8, -130], [1, 0]] },
};

/** Head gestures on the drawing's own head group: a nod is a dip, a shake a side-to-side; the body stays. */
export const HEAD_GESTURES: Record<string, { duration: number; frames: { offset: number; translate: string; rotate: string }[] }> = {
  nod: { duration: 1050, frames: [0, 10, -2, 6, 0].map((y, i) => ({ offset: [0, .22, .46, .7, 1][i], translate: `0px ${y}px`, rotate: '0deg' })) },
  shake: { duration: 900, frames: [0, -9, 9, -5, 0].map((x, i) => ({ offset: [0, .2, .5, .78, 1][i], translate: `${x}px 0px`, rotate: `${-x * .25}deg` })) },
};
