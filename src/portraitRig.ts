/**
 * The rig data for her screen: where the eyes, mouth and hair are in each
 * picture, in that picture's own pixels. The renderer (PortraitWindow) never
 * knows which picture it has; it draws whatever a view describes.
 *
 * A view's `viewBox` is the 9:16 window onto the picture; `image` is drawn
 * into `frame`, the picture's rectangle in those pixels. The close-up
 * is the whole landscape drawing with a 922x1640 window over her right eye,
 * framed like the old wallpaper; the bust is a 9:16 picture shown whole.
 */
import closeupImage from '../build/portrait/haru-closeup.webp';
import closeupPlate from '../build/portrait/closeup-plate.webp';
import closeupHair from '../build/portrait/closeup-hair.png';
import closeupEyeRight from '../build/portrait/closeup-eye-right.png';
import closeupBlinkRight from '../build/portrait/closeup-blink-right.png';
import closeupEyeLeft from '../build/portrait/closeup-eye-left.png';
import closeupBlinkLeft from '../build/portrait/closeup-blink-left.png';
// Written by scripts/portrait/build_assets.py: the eye openings and where the right eye's outline sprite sits.
import closeupEyes from '../build/portrait/closeup-eyes.json';
import type { Lock } from './portraitHair';
import bustImage from '../build/portrait/haru-portrait.webp';

export type Eye = {
  /** The eye opening, traced just inside the lashes; sclera and lid live in it. */
  open: string;
  iris: { cx: number; cy: number; r: number };
  pupil: { cx: number; cy: number; rx: number; ry: number };
  /** Where the sheet's large reflection sits and how big it is. */
  shine: { cx: number; cy: number; r: number };
  /** Where the lid hangs from and how far it has to fall to close the eye. */
  top: number; bottom: number;
  /** Outline and lashes drawn over the opening's edge (the eye sheet's, fitted to this eye). */
  outline?: { href: string; x: number; y: number; w: number; h: number };
  /**
   * The blink as the upper lash band dropping, pre-rendered: `frames` frames of frameW x frameH stacked in one
   * image, open to shut, drawn at x, y, w, h. Without it the eye closes with a skin lid.
   */
  blink?: { href: string; x: number; y: number; w: number; h: number; frames: number; frameW: number; frameH: number };
};
/**
 * The moving hair, all at the picture's own size: `plate` is the picture with
 * the hair painted out and everything behind the face blurred, `mask` the hair
 * (red moves, green is the still interior under it), and `locks` the rigid
 * pieces it moves as. `reach` is a lock's pivot-to-tip length, which turns px
 * into an angle. The brow is on the plate, behind the hair, as in the reference.
 */
export type Hair = { plate: string; mask: string; locks: (Lock & { reach: number })[]; kink: number };
export type View = {
  image: string;
  /** Absent: the hair stays painted on and only the head sways. */
  hair?: Hair;
  /**
   * The shadow across the upper face, in view pixels: multiplied over every
   * layer, so the hair swings through it rather than carrying it. The close-up's
   * assets are toned for it (the hair reads ~95 at the crown under it).
   */
  shadow?: string;
  viewBox: [number, number, number, number];
  /** The picture's rectangle in view pixels; the image and its layers are drawn into it. */
  frame: [number, number, number, number];
  eyes: Eye[];
  /**
   * Where the mouth sheet's canvas (build/portrait/mouths, 269x277, every shape on the same canvas) sits: its
   * top-left corner in view px, and its scale.
   */
  mouth: { x: number; y: number; scale: number };
  blush: { cx: number; cy: number; rx: number; ry: number }[];
  /** How far the pupil may slide before it leaves the iris. */
  travel: { x: number; y: number };
};

/** An eye written by scripts/portrait/build_assets.py, with its two sprites. */
const eyeFrom = (eye: typeof closeupEyes.right, outline: string, blink: string): Eye =>
  ({ ...eye, outline: { href: outline, ...eye.outline }, blink: { href: blink, ...eye.blink } });

export const VIEWS: Record<'closeup' | 'bust', View> = {
  closeup: {
    image: closeupImage,
    // Cut from haru-closeup.webp (1440x2560). Below the jaw — neck, collar, back
    // hair — is out of focus and still, as in the old wallpaper.
    // Two rigid pieces, split only where skin separates them: the fringe and
    // top-right hair are one mass from the crown down (its locks part only at
    // the tips, so turning them separately tears seams through solid hair), and
    // the locks curling in beside the eye are clear of it below y 1150.
    hair: {
      plate: closeupPlate, mask: closeupHair, kink: 0,
      locks: [
        { pivot: [720, -500], left: [-10, 0], right: [1441, 0], top: 0, bottom: 1150, reach: 1500 },
        // These hang from the frame's right edge.
        { pivot: [1650, 1300], left: [1100, 0], right: [1441, 0], top: 1150, bottom: 1700, reach: 490 },
      ],
    },
    viewBox: [690, 0, 922, 1640], frame: [690, 0, 922, 1640],
    // After the reference: everything above a line from her left cheek up past her right eye is in shade.
    shadow: '600,-200 1700,-200 1700,414.6 600,834.8',
    eyes: [
      // Her right eye: the eye sheet's sclera and outline, fitted onto the drawn eye (which the plate paints out).
      eyeFrom(closeupEyes.right, closeupEyeRight, closeupBlinkRight),
      // Her left eye, mostly past the window's edge: the right one mirrored onto its inner corner.
      eyeFrom(closeupEyes.left, closeupEyeLeft, closeupBlinkLeft),
    ],
    // The closed shape's line (canvas 139, 81) centred on her drawn mouth (view 1077, 1175), which the plate
    // paints out; at 2.5x the open shapes stay well clear of her chin.
    mouth: { x: 1077 - 139 * 2.5, y: 1175 - 81 * 2.5, scale: 2.5 },
    blush: [{ cx: 1380, cy: 880, rx: 130, ry: 70 }, { cx: 800, cy: 960, rx: 130, ry: 70 }],
    travel: { x: 30, y: 16 },
  },
  bust: {
    image: bustImage,
    viewBox: [0, 0, 1440, 2560], frame: [0, 0, 1440, 2560],
    eyes: [
      { open: '348,1000 400,985 450,981 500,980 555,988 592,1000 612,1025 608,1050 585,1058 548,1070 480,1083 420,1077 365,1060 325,1040 305,1022',
        iris: { cx: 500, cy: 1012, r: 74 }, pupil: { cx: 500, cy: 1022, rx: 7, ry: 44 }, shine: { cx: 467, cy: 1003, r: 15 }, top: 978, bottom: 1086 },
      { open: '907,940 953,903 1000,888 1053,885 1095,890 1120,912 1118,932 1100,950 1060,978 1020,997 970,1003 928,1000 897,990 884,970',
        iris: { cx: 985, cy: 932, r: 70 }, pupil: { cx: 982, cy: 940, rx: 7, ry: 44 }, shine: { cx: 948, cy: 937, r: 15 }, top: 883, bottom: 1006 },
    ],
    mouth: { x: 778 - 139, y: 1310 - 81, scale: 1 },
    blush: [{ cx: 380, cy: 1190, rx: 110, ry: 60 }, { cx: 1060, cy: 1110, rx: 110, ry: 60 }],
    travel: { x: 22, y: 12 },
  },
};

/** What the screen shows unless told otherwise: the close-up, like the old wallpaper. */
export const DEFAULT_VIEW = VIEWS.closeup;
