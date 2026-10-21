/**
 * The rig data for her screen: where the eyes, mouth and hair are in each
 * picture, in that picture's own pixels. The renderer (PortraitWindow) never
 * knows which picture it has; it draws whatever a view describes.
 *
 * A view's `viewBox` is the 9:16 window onto the picture; `image` and `mask`
 * are drawn into `frame`, the picture's rectangle in those pixels. The close-up
 * is the whole landscape drawing with a 922x1640 window over her right eye,
 * framed like the old wallpaper; the bust is a 9:16 picture shown whole.
 */
import closeupImage from '../build/portrait/haru-closeup.webp';
import closeupMask from '../build/portrait/closeup-mask.png';
import bustImage from '../build/portrait/haru-portrait.webp';
import bustMask from '../build/portrait/hair-mask.png';

export type Eye = {
  /** The eye opening, traced just inside the lashes; sclera and lid live in it. */
  open: string;
  iris: { cx: number; cy: number; r: number };
  pupil: { cx: number; cy: number; rx: number; ry: number };
  /** Where the sheet's large reflection sits and how big it is. */
  shine: { cx: number; cy: number; r: number };
  /** Where the lid hangs from and how far it has to fall to close the eye. */
  top: number; bottom: number;
};
/** A region of the picture, masked to hair, that turns about `pivot` with the breath. */
export type Strand = { points: string; pivot: [number, number]; phase: number; amp: number };
export type View = {
  image: string; mask: string;
  viewBox: [number, number, number, number];
  /** The picture's rectangle in view pixels; image and mask are drawn into it. */
  frame: [number, number, number, number];
  eyes: Eye[]; mouth: { cx: number; cy: number; rx: number; ry: number };
  strands: Strand[]; blush: { cx: number; cy: number; rx: number; ry: number }[];
  /** How far the pupil may slide before it leaves the iris. */
  travel: { x: number; y: number };
};

export const VIEWS: Record<'closeup' | 'bust', View> = {
  closeup: {
    image: closeupImage, mask: closeupMask,
    viewBox: [690, 0, 922, 1640], frame: [690, 0, 922, 1640],
    eyes: [
      // Her right eye, the one in frame.
      // Traced at 3x: the opening ends on the top edge of the drawn lower lid line, so the line stays visible under the sclera.
      { open: '1250,713 1260,667 1283,637 1310,613 1340,592 1373,573 1407,560 1440,552 1473,547 1507,545 1540,547 1573,547 1600,549 1601,600 1600,653 1583,680 1550,697 1517,707 1483,715 1450,721 1417,725 1383,727 1350,728 1317,728 1287,727 1267,723',
        iris: { cx: 1404, cy: 616, r: 109 }, pupil: { cx: 1398, cy: 640, rx: 15, ry: 62 }, shine: { cx: 1347, cy: 627, r: 20 }, top: 545, bottom: 728 },
      // Her left eye, just past the window's edge; drawn so a wider window would have it.
      { open: '398,720 430,703 480,698 540,697 600,699 660,705 720,718 765,738 792,765 775,795 740,822 690,843 630,853 570,850 515,838 465,815 425,785 402,752',
        iris: { cx: 632, cy: 772, r: 118 }, pupil: { cx: 635, cy: 765, rx: 14, ry: 70 }, shine: { cx: 585, cy: 725, r: 28 }, top: 697, bottom: 853 },
    ],
    mouth: { cx: 1075, cy: 1192, rx: 60, ry: 50 },
    // Fringe locks hang from a crown well above the window, so their pivots sit
    // above the picture: the visible part mostly slides sideways, as hair does.
    strands: [
      { points: '690,0 1020,0 1020,800 690,800', pivot: [850, -300], phase: 0.0, amp: 0.16 },
      { points: '1020,0 1260,0 1260,760 1020,760', pivot: [1140, -300], phase: 0.4, amp: 0.16 },
      { points: '1260,0 1620,0 1620,560 1260,560', pivot: [1400, -300], phase: 0.8, amp: 0.14 },
      { points: '1480,560 1620,560 1620,1640 1480,1640', pivot: [1560, 250], phase: 1.6, amp: 0.3 },
      { points: '690,650 790,650 790,1640 690,1640', pivot: [700, 300], phase: 2.3, amp: 0.3 },
    ],
    blush: [{ cx: 1380, cy: 880, rx: 130, ry: 70 }, { cx: 800, cy: 960, rx: 130, ry: 70 }],
    travel: { x: 30, y: 16 },
  },
  bust: {
    image: bustImage, mask: bustMask,
    viewBox: [0, 0, 1440, 2560], frame: [0, 0, 1440, 2560],
    eyes: [
      { open: '348,1000 400,985 450,981 500,980 555,988 592,1000 612,1025 608,1050 585,1058 548,1070 480,1083 420,1077 365,1060 325,1040 305,1022',
        iris: { cx: 500, cy: 1012, r: 74 }, pupil: { cx: 500, cy: 1022, rx: 7, ry: 44 }, shine: { cx: 467, cy: 1003, r: 15 }, top: 978, bottom: 1086 },
      { open: '907,940 953,903 1000,888 1053,885 1095,890 1120,912 1118,932 1100,950 1060,978 1020,997 970,1003 928,1000 897,990 884,970',
        iris: { cx: 985, cy: 932, r: 70 }, pupil: { cx: 982, cy: 940, rx: 7, ry: 44 }, shine: { cx: 948, cy: 937, r: 15 }, top: 883, bottom: 1006 },
    ],
    mouth: { cx: 778, cy: 1310, rx: 40, ry: 40 },
    strands: [
      { points: '120,330 470,330 470,1200 120,1200', pivot: [300, 330], phase: 0.0, amp: 0.45 },
      { points: '470,280 760,280 760,1060 470,1060', pivot: [610, 260], phase: 0.6, amp: 0.4 },
      { points: '760,280 1000,280 1000,1010 760,1010', pivot: [860, 260], phase: 1.1, amp: 0.4 },
      { points: '1000,300 1360,300 1360,1150 1000,1150', pivot: [1120, 280], phase: 1.7, amp: 0.45 },
      { points: '0,1200 470,1200 470,1950 0,1950', pivot: [240, 1100], phase: 2.4, amp: 0.35 },
      { points: '1000,1150 1440,1150 1440,1950 1000,1950', pivot: [1220, 1050], phase: 3.1, amp: 0.35 },
    ],
    blush: [{ cx: 380, cy: 1190, rx: 110, ry: 60 }, { cx: 1060, cy: 1110, rx: 110, ry: 60 }],
    travel: { x: 22, y: 12 },
  },
};

/** What the screen shows unless told otherwise: the close-up, like the old wallpaper. */
export const DEFAULT_VIEW = VIEWS.closeup;
