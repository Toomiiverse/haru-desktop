// Original vector marks, positioned in Haru's 1254-square artwork coordinates.
// Only these local, allowlisted fragments are inserted into the avatar.
const pink = '#fec4cc', dark = '#24212a';
const group = (shape: string, transform = '') => `<g transform="${transform}"><g data-symbol-part="" stroke-linecap="round" stroke-linejoin="round">${shape}</g></g>`;
const ink = (d: string, colour = pink, width = 13) => `<path d="${d}" fill="none" stroke="${dark}" stroke-width="${width + 9}"/><path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}"/>`;
const question = 'M -24 -31 C -24 -67 33 -67 33 -31 C 33 -8 4 -7 4 16 M 4 43 L 4 45';
const bang = 'M 0 -55 L 0 12 M 0 40 L 0 43';
const star = '<path d="M 0 -37 Q 7 -7 28 0 Q 7 7 0 37 Q -7 7 -28 0 Q -7 -7 0 -37 Z" fill="#ffdeb0" stroke="#24212a" stroke-width="6"/>';
type SymbolMark = { label: string; markup: string; motion: 'drop' | 'pulse' | 'float' | 'shake' | 'fade' | 'spin'; duration: number; eyeOverlay?: boolean };
export const REACTION_SYMBOLS: Record<string, SymbolMark> = {
  sweatdrop: { label: 'Sweat drop', motion: 'drop', duration: 2600, markup: group('<path d="M 0 -55 C -8 -31 -36 -5 -36 20 A 36 36 0 0 0 36 20 C 36 -5 8 -31 0 -55 Z" fill="#a7d8f0" stroke="#24212a" stroke-width="8"/><path d="M -20 10 Q -28 32 -10 40" fill="none" stroke="#effaff" stroke-width="7"/>', 'translate(1000 480)') },
  anger: { label: 'Anger mark', motion: 'pulse', duration: 2300, markup: group(ink('M -40 -10 Q -9 -9 -10 -40 M 10 -40 Q 9 -9 40 -10 M 40 10 Q 9 9 10 40 M -10 40 Q -9 9 -40 10', '#ff9cae', 17), 'translate(950 495)') },
  blush: { label: 'Blush', motion: 'fade', duration: 3200, markup: [425, 810].map(x => group('<ellipse rx="47" ry="23" fill="#fec4cc" opacity=".18"/>' + '<path d="M -30 9 L -17 -10 M -10 12 L 3 -9 M 10 12 L 23 -9" fill="none" stroke="#fec4cc" stroke-width="7"/>', `translate(${x} 906)`)).join('') },
  'sparkle-eyes': { label: 'Sparkle eyes', motion: 'pulse', duration: 2200, eyeOverlay: true, markup: [484, 755].map(x => group(star, `translate(${x} 851)`)).join('') + group(star, 'translate(1080 690) scale(.55)') },
  question: { label: 'Curious ?', motion: 'float', duration: 2700, markup: group(ink(question), 'translate(1090 285) rotate(12)') },
  surprise: { label: 'Surprise !', motion: 'pulse', duration: 1700, markup: group(ink(bang, '#ffdeb0', 17), 'translate(1080 280) rotate(9)') + group(ink('M -20 -16 L -34 -30 M -28 4 L -49 2', '#ffdeb0', 9), 'translate(1080 280)') },
  disbelief: { label: 'Disbelief ?!', motion: 'shake', duration: 2700, markup: group(ink(question), 'translate(1060 272) rotate(-9) scale(.85)') + group(ink(bang, '#ffdeb0'), 'translate(1150 300) rotate(13) scale(.85)') },
  gloom: { label: 'Gloom lines', motion: 'drop', duration: 2800, markup: group(ink('M -40 -25 L -40 26 M -13 -30 L -13 55 M 14 -22 L 14 42 M 41 -12 L 41 24', '#b2add9', 10), 'translate(918 690)') },
  dizzy: { label: 'Dizzy swirls', motion: 'spin', duration: 2700, eyeOverlay: true, markup: [484, 755].map(x => group(ink('M 0 0 C 15 -13 28 7 15 20 C -8 43 -42 11 -28 -15 C -10 -50 43 -35 45 4 C 48 52 -18 70 -49 30', pink, 9), `translate(${x} 846) scale(.78)`)).join('') },
  hearts: { label: 'Little hearts', motion: 'float', duration: 3000, markup: [[1080, 420, 1], [1135, 295, .6]].map(([x, y, s]) => group('<path d="M 0 30 C -63 -9 -26 -61 0 -30 C 26 -61 63 -9 0 30 Z" fill="#fec4cc" stroke="#24212a" stroke-width="7"/>', `translate(${x} ${y}) scale(${s})`)).join('') },
  sleep: { label: 'Sleep Zzz', motion: 'float', duration: 3800, markup: [[1050, 470, .6], [1115, 365, .8], [1170, 245, 1]].map(([x, y, s]) => group(ink('M -23 -22 L 23 -22 L -23 22 L 23 22', '#c7c2e8', 11), `translate(${x} ${y}) scale(${s})`)).join('') },
  nosebleed: { label: 'Anime nosebleed', motion: 'drop', duration: 2100, markup: group('<path d="M 0 -14 Q 5 13 1 31 C -17 47 -6 64 7 56 C 21 47 12 33 10 25 L 10 -14 Z" fill="#ee849c" stroke="#24212a" stroke-width="5"/>', 'translate(621 874)') },
  sigh: { label: 'Relief puff', motion: 'float', duration: 2600, markup: group('<path d="M -43 11 Q -36 -7 -21 -4 C -27 -44 28 -51 32 -16 C 66 -27 76 21 44 29 C 15 40 -5 20 -20 21 Z" fill="#d5d5e9" opacity=".85" stroke="#24212a" stroke-width="6"/>', 'translate(1060 910)') },
};

export const EXPRESSION_SYMBOLS: Record<string, string> = {
  happy: 'hair-heart', excited: 'hair-surprise', angry: 'anger', annoyed: 'anger', sad: 'hair-droop',
  surprised: 'hair-surprise', confused: 'hair-spiral', curious: 'hair-question', embarrassed: 'hair-heart',
  sleepy: 'hair-droop', thinking: 'hair-question', love: 'hair-heart', skeptical: 'hair-question', concerned: 'hair-question',
  attentive: 'hair-surprise', shy: 'hair-heart', content: 'hair-heart', playful: 'hair-heart',
  startled: 'hair-surprise', disappointed: 'hair-droop', relieved: 'hair-droop', drowsy: 'hair-droop',
  determined: 'hair-surprise', wink: 'hair-heart', unimpressed: 'hair-droop',
  pain: 'hair-surprise', scared: 'hair-surprise', serious: 'hair-surprise', silly: 'hair-spiral', flirty: 'hair-heart', nervous: 'hair-question', disbelief: 'hair-surprise', rage: 'hair-surprise', disgusted: 'hair-question', confident: 'hair-heart', drunk: 'hair-spiral', pouty: 'hair-droop', sick: 'hair-droop', laughing: 'hair-heart', snooty: 'hair-heart', cold: 'hair-droop', crying: 'hair-droop', devious: 'hair-question', pensive: 'hair-question', triumph: 'hair-surprise',
};
export const ANIMATION_SYMBOLS: Record<string, string> = {
  'tap-zoom': 'hair-surprise', 'tap-retreat': 'hair-heart', 'tap-orbit': 'hair-spiral',
  'tap-corkscrew': 'hair-spiral', 'tap-peek-left': 'hair-question', 'tap-peek-right': 'hair-question',
  'tap-bow': 'hair-droop', 'tap-float': 'hair-heart', 'tap-ricochet': 'hair-surprise', 'tap-pop-through': 'hair-surprise',
  'tap-pancake': 'hair-droop', 'tap-boing': 'hair-surprise', 'tap-jelly': 'hair-spiral',
  'tap-left': 'hair-question', 'tap-right': 'hair-question', 'tap-peek': 'hair-surprise',
  'tap-tumble': 'hair-spiral', 'tap-squeeze': 'hair-surprise', 'tap-ripple': 'hair-heart', 'tap-hop': 'hair-heart',
  listening: 'hair-surprise', 'head-pat': 'hair-heart', curiosity: 'hair-question',
  'sleep-transition': 'hair-droop', 'shy-glance': 'hair-heart', 'slow-blink': 'hair-heart',
  'playful-wink': 'hair-heart', startle: 'hair-surprise', droop: 'hair-droop',
  relief: 'hair-droop', 'sleepy-nod': 'hair-droop', sparkle: 'hair-surprise',
  'flinch': 'hair-surprise', 'tremble': 'hair-surprise', 'focus': 'hair-surprise', 'goofy-bob': 'hair-spiral', 'fidget': 'hair-question', 'double-take': 'hair-surprise', 'huff': 'hair-surprise', 'ew-recoil': 'hair-question', 'proud': 'hair-heart', 'wobble': 'hair-spiral', 'sulk': 'hair-droop', 'queasy': 'hair-droop', 'giggle': 'hair-heart', 'shiver': 'hair-droop', 'sob': 'hair-droop', 'scheming': 'hair-question', 'ponder': 'hair-question', 'celebrate': 'hair-surprise',
};

export function symbolSvg(name: string): string {
  return Object.hasOwn(REACTION_SYMBOLS, name) ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254">${REACTION_SYMBOLS[name].markup}</svg>` : '';
}

export function symbolFrames(motion: SymbolMark['motion']): Keyframe[] {
  const travel = motion === 'drop' ? ['translateY(-25px)', 'translateY(0)', 'translateY(18px)', 'translateY(50px)']
    : motion === 'float' ? ['translateY(12px)', 'translateY(0)', 'translateY(-27px)', 'translateY(-50px)']
    : motion === 'spin' ? ['rotate(-20deg)', 'rotate(0deg)', 'rotate(200deg)', 'rotate(240deg)']
    : motion === 'shake' ? ['rotate(-10deg)', 'rotate(7deg)', 'rotate(-4deg)', 'rotate(0deg)']
    : motion === 'pulse' ? ['scale(.8)', 'scale(1.08)', 'scale(1)', 'scale(.95)'] : ['none', 'none', 'none', 'none'];
  return travel.map((transform, i) => ({ transform, opacity: [0, 1, 1, 0][i], offset: [0, .14, .73, 1][i], easing: 'ease-in-out' }));
}

export const HAIR_SYMBOLS: Record<string, { label: string; d: string; duration: number; rise: number; fallback: string }> = {
  'hair-surprise': { label: 'Hair → !', duration: 2300, rise: 220, fallback: 'surprise', d: 'M 623 384 C 598 380 598 351 617 347 L 620 303 C 615 280 598 220 602 168 C 604 140 640 137 646 162 C 651 192 635 272 628 303 L 625 347 C 647 351 646 379 623 384 Z' },
  'hair-question': { label: 'Hair → ?', duration: 3000, rise: 380, fallback: 'question', d: 'M 623 384 C 599 381 599 351 617 347 L 618 326 C 618 300 640 291 655 276 C 686 247 693 203 662 179 C 632 155 594 168 581 197 C 572 217 574 238 580 251 L 550 247 C 540 226 547 193 562 174 C 587 141 634 127 670 147 C 711 167 726 213 709 250 C 695 281 660 300 636 319 L 627 347 C 647 355 643 381 623 384 Z' },
  'hair-heart': { label: 'Hair → heart', duration: 2800, rise: 420, fallback: 'hearts', d: 'M 623 384 C 615 341 540 308 537 240 C 533 169 599 151 625 205 C 653 150 720 174 715 235 C 710 302 638 345 623 384 L 624 353 C 646 313 686 278 688 238 C 692 208 657 195 625 232 C 599 198 564 208 565 242 C 565 285 610 323 623 384 Z' },
  'hair-droop': { label: 'Hair → soft droop', duration: 3200, rise: 760, fallback: 'sigh', d: 'M 623 384 C 594 351 565 315 576 279 C 590 235 648 225 692 249 C 730 270 745 310 720 337 C 703 352 683 340 689 326 C 705 335 718 318 707 296 C 690 264 639 255 610 274 C 575 298 599 348 623 384 Z' },
  'hair-spiral': { label: 'Hair → swirl', duration: 3000, rise: 460, fallback: 'dizzy', d: 'M 623 384 C 562 350 532 299 548 244 C 569 172 678 160 714 216 C 754 278 688 346 627 314 C 574 288 585 225 631 216 C 667 208 692 245 667 263 C 653 274 636 265 641 251 C 646 260 659 257 658 247 C 655 230 626 228 614 245 C 593 277 634 311 668 295 C 714 272 710 219 673 198 C 627 173 568 203 565 254 C 562 302 590 346 623 384 Z' },
};

type Outline = Pick<SVGGeometryElement, 'getTotalLength' | 'getPointAtLength'>;
type Point = { x: number; y: number };
function sampleOutline(path: Outline): Point[] {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) throw Error('Invalid hair outline');
  const points = Array.from({ length: 128 }, (_, i) => {
    const p = path.getPointAtLength(length * i / 128);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('Invalid hair point');
    return { x: p.x, y: p.y };
  });
  // Authored and animated contours start at the scalp. Preserve a moving root
  // when interrupted; only older contours need their start point realigned.
  const root = Math.hypot(points[0].x - 623, points[0].y - 384) < 48 ? 0
    : points.reduce((best, p, i) => Math.hypot(p.x - 623, p.y - 384) < Math.hypot(points[best].x - 623, points[best].y - 384) ? i : best, 0);
  const anchored = [...points.slice(root), ...points.slice(0, root)];
  const area = anchored.reduce((sum, p, i) => { const q = anchored[(i + 1) % anchored.length]; return sum + p.x * q.y - q.x * p.y; }, 0);
  if (area < 0) anchored.splice(1, anchored.length - 1, ...anchored.slice(1).reverse());
  return anchored;
}

/** Equal-length contours give native SVG path interpolation compatible control points. */
export function hairSymbolFrames(source: Outline, target: Outline, rest: Outline = source, duration = 2800, rise = 320, hold = false, motion = 1): Keyframe[] {
  const from = sampleOutline(source), to = sampleOutline(target), home = sampleOutline(rest);
  const pathAt = (amount: number, returning: boolean, sx: number, sy: number, bend: number, rootX: number, rootY: number) => {
    const points = (returning ? home : from).map((p, i) => {
      const x = p.x + (to[i].x - p.x) * amount, y = p.y + (to[i].y - p.y) * amount;
      const height = 384 - y;
      // Deform the actual outline, including the base, so a replacement samples
      // the entire visible pose. Keep root travel inside the crown of her hair.
      return { x: 623 + (x - 623) * (1 + (sx - 1) * motion) + (rootX + bend * height * (1 + height / 250)) * motion,
        y: 384 - height * (1 + (sy - 1) * motion) + rootY * motion };
    });
    const n = (v: number) => v.toFixed(2);
    let d = `M ${n(points[0].x)} ${n(points[0].y)}`;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length], next = points[(i + 2) % points.length];
      d += ` C ${n(b.x + (c.x - a.x) / 6)} ${n(b.y + (c.y - a.y) / 6)} ${n(c.x - (next.x - b.x) / 6)} ${n(c.y - (next.y - b.y) / 6)} ${n(c.x)} ${n(c.y)}`;
    }
    return `path("${d} Z")`;
  };
  // Compress, spring tall, wobble through the base, then soften back. The cue
  // keeps changing size during its readable beat instead of freezing in place.
  const peak = Math.min(rise / duration, .3);
  const settle = Math.min(160 / duration, .06);
  // offset, morph amount, width, height, bend, root x, root y
  const beats = hold ? [[0, 0, 1, 1, 0, 0, 0], [.72, 1, 1.08, .92, .05, 5, 6], [1, 1, 1, 1, 0, 0, 0]]
    : [[0, 0, 1, 1, 0, 0, 0], [Math.min(70 / duration, peak / 3), -.018, 1.2, .76, -.08, -9, 10],
       [peak, 1.035, .82, 1.24, .08, 9, 3], [peak + settle, .99, 1.16, .89, -.075, -7, 8],
       [peak + settle * 2, 1, .96, 1.09, .045, 4, 2], [.52, 1, 1.07, .98, -.035, -5, 6],
       [.65, 1, .95, 1.1, .04, 5, 3], [.78, .72, 1.05, .96, -.025, -3, 5],
       [.94, -.008, 1.02, .98, .008, 1, 2], [1, 0, 1, 1, 0, 0, 0]];
  return beats.map(([offset, amount, sx, sy, bend, rootX, rootY]) => ({
    d: pathAt(amount, !hold && offset >= .65, sx, sy, bend, rootX, rootY), offset, easing: 'cubic-bezier(.35, 0, .25, 1)',
  }));
}
