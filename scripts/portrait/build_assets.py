"""Rebuild the close-up's assets from the untouched base, toned after the reference wallpaper.

Run from the repo root: python -I scripts/portrait/build_assets.py scripts/portrait/inputs [preview-folder]
Inputs: the untouched upscaled close-up, its painted-out plate, the hair mask, the brow shape and the two eye
openings (all 1440x2560), plus build/portrait/reference/eye-parts.jpg (the eye sheet). Writes
build/portrait/haru-closeup.webp, closeup-plate.webp, closeup-hair.png, closeup-eye-right.png and closeup-eyes.json.

Values are BEFORE the screen's diagonal shade (a multiply of SHADE drawn live by the window), chosen so that
after it the hair reads like the reference: ~95 at the crown, ~120 at the tips, shaded forehead ~140, lit face
~210. Lines are soft and drawn once: the jaw is one stroke on a smoothed face edge, the brow one fitted stroke
behind the hair, other face lines thinned, blurred and fading along their length."""
import sys, json, numpy as np, cv2
from PIL import Image
H = sys.argv[1]
OUT = 'build/portrait/'
SHADE = 0.67           # must match SHADE in PortraitWindow (#ababab)
LIT_SKIN = 210.0
JAW_TONE, BROW_TONE = 150.0, 150.0
base0 = np.asarray(Image.open(f'{H}/base_orig.webp').convert('RGB')).astype(np.float32)
plate0 = np.asarray(Image.open(f'{H}/plate-region/plate.png').convert('RGB')).astype(np.float32)
mask = np.asarray(Image.open(f'{H}/seg-final/hair_mask.png').convert('L')).astype(np.float32) / 255
h, w = mask.shape
ys = np.arange(h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
ss = lambda a, b, x: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
L0 = cv2.cvtColor(base0.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
EYES = [(820, 760, 1440, 1200), (0, 1000, 260, 1400)]
eyes = np.zeros((h, w), bool)
for x0, y0, x1, y1 in EYES: eyes[y0:y1, x0:x1] = True
rng = np.random.default_rng(7)
fade = cv2.resize(rng.random((h // 90 + 2, w // 90 + 2)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
fade = np.clip(0.45 + 0.55 * fade, 0, 1)        # lines come and go along their length
SUPER = 4
def aa_fill(polys):
    """Anti-aliased polygon fill, 0..1."""
    big = np.zeros((h * SUPER, w * SUPER), np.uint8)
    cv2.fillPoly(big, [np.round(p * SUPER).astype(np.int32) for p in polys], 255, lineType=cv2.LINE_AA)
    return cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
def smooth_curve(pts, sigma):
    """Resample an open curve at ~1 px and smooth it along its length."""
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    t = np.arange(0, d[-1], 1.0)
    p = np.stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])], 1).astype(np.float32)
    return np.stack([cv2.GaussianBlur(p[:, i:i + 1].T, (0, 0), sigma, borderType=cv2.BORDER_REPLICATE)[0] for i in (0, 1)], 1)
def normals(p):
    t = np.gradient(p, axis=0); t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-6)
    return np.stack([t[:, 1], -t[:, 0]], 1)
def stroke(center, width, alpha):
    """A soft stroke: a ribbon of the given widths, alpha per point, blurred a little."""
    n = normals(center)
    up, dn = center + n * width[:, None] / 2, center - n * width[:, None] / 2
    acc = np.zeros((h, w), np.float32)
    for i in range(0, len(center) - 1, 6):    # short quads so alpha can vary along the length
        j = min(i + 7, len(center) - 1)
        quad = np.concatenate([up[i:j + 1], dn[i:j + 1][::-1]])
        acc = np.maximum(acc, aa_fill([quad]) * float(alpha[i]))
    return cv2.GaussianBlur(acc, (0, 0), 1.0)

def bridge(img, hole, guide):
    """Fill `hole` (a band crossed by lines) column by column, joining the row above it to the row below it
    along the local line direction, read from `guide` just outside the band: lock edges and lock lines carry
    straight across instead of stepping where the band was."""
    gx = cv2.Sobel(guide, cv2.CV_32F, 1, 0, ksize=5); gy = cv2.Sobel(guide, cv2.CV_32F, 0, 1, ksize=5)
    known = (~hole).astype(np.float32)
    sm = lambda a: cv2.GaussianBlur(a * known, (0, 0), 14) / np.maximum(cv2.GaussianBlur(known, (0, 0), 14), 1e-4)
    jxx, jyy, jxy = sm(gx * gx), sm(gy * gy), sm(gx * gy)
    slope = np.clip(-np.tan(0.5 * np.arctan2(2 * jxy, jxx - jyy)), -2, 2)   # dx/dy along the lines
    out, cols = img.copy(), np.arange(img.shape[1])
    for x in np.where(hole.any(0))[0]:
        col = np.where(hole[:, x])[0]
        top, bot = col.min() - 1, col.max() + 1
        dx = 0.5 * (slope[top, x] + slope[bot, x]) * (bot - top)
        t = (col - top) / (bot - top)
        out[col, x] = (1 - t) * np.interp(x - t * dx, cols, img[top]) + t * np.interp(x + (1 - t) * dx, cols, img[bot])
    return out

# --- The hair mask, with the brow hole closed: hair is drawn over the brow, as in the reference.
brow_band = (np.asarray(Image.open(f'{H}/brow_band.png')) > 0)
brow_zone = cv2.dilate(brow_band.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
# The segmentation cut the brow out of the hair, and the drawn brow crosses the lock lines. Carry the lock
# edges and lines straight across it, so the brow sits wholly behind the hair with no bump or step there.
brow_hole = cv2.dilate(brow_band.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
ink_raw = np.clip((40 - L0) / 25, 0, 1)
guide = mask + ink_raw
filled = bridge(mask, brow_hole, guide)
mask = np.where(brow_hole, cv2.GaussianBlur((filled > 0.5).astype(np.float32), (0, 0), 1.0), mask)
ink_bridged = bridge(ink_raw, brow_hole, guide)

# --- The jaw: the lower edge of the face's skin, smoothed into one curve.
skin = ((L0 > 180) & (mask < 0.5)).astype(np.uint8)
n_, lab = cv2.connectedComponents(skin, connectivity=4)
F = (lab == lab[1500, 700]).astype(np.uint8)
c = max(cv2.findContours(F, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea)[:, 0, :].astype(np.float32)
sel = (c[:, 1] > 1480) & (c[:, 0] > 3) & (c[:, 0] < w - 4)
start = int(np.argmin(sel)); c, sel = np.roll(c, -start, 0), np.roll(sel, -start)
runs, i = [], 0
while i < len(sel):
    if sel[i]:
        j = i
        while j < len(sel) and sel[j]: j += 1
        runs.append((i, j)); i = j
    else: i += 1
a_, b_ = max(runs, key=lambda r: r[1] - r[0])
jaw = smooth_curve(c[a_:b_], 10)
if jaw[0, 0] < jaw[-1, 0]: jaw = jaw[::-1]                 # right to left
nrm = normals(jaw)
probe = np.round(jaw + nrm * 8).astype(int)
if F[np.clip(probe[:, 1], 0, h - 1), np.clip(probe[:, 0], 0, w - 1)].mean() > 0.5: nrm = -nrm   # point away from the face
print('jaw points', len(jaw), 'from', jaw[0].round(), 'to', jaw[-1].round())
def above(offset):
    edge = jaw + nrm * offset
    return np.concatenate([edge, [[-8, edge[-1, 1]], [-8, -8], [w + 8, -8], [w + 8, edge[0, 1]]]]).astype(np.float32)
above_soft = aa_fill([above(4.0)])                         # face side of the jaw, edge under the stroke
below = 1 - above_soft
bg_hard = (below > 0.5).astype(np.float32)

# --- Hair: a deep grey gradient (pre-shade 142 at the crown to 188 at the tips), the streak lighter,
#     lock lines soft and only slightly darker; no lines in the brow zone (the brow lives behind).
G = np.interp(ys, [0, 1100], [142, 188])
G = G * (1 - bg_hard) + 82 * bg_hard
# Lock lines after the reference: thin and blended. The drawn outlines are 6-8 px wide after the upscale;
# keep their 2-3 px core (fine tips at half strength), blur lightly, darken the hair only ~10% there.
core = cv2.erode(ink_bridged, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
ink_h = np.maximum(core, 0.5 * ink_bridged * (cv2.dilate(core, np.ones((9, 9), np.uint8)) == 0))
soft_h = np.clip(cv2.GaussianBlur(ink_h * fade, (0, 0), 1.3) * 1.2, 0, 1)
streak = np.clip((L0 - 90) / 50, 0, 1)
hairL = G * (1 + 0.22 * streak) * (1 - 0.10 * soft_h)
# Solid hair colour right out to the mask's soft edge: blending the drawing in there brought its light
# halos with it, which read as a glow around every lock.
base = np.where((mask > 0.004)[..., None], np.repeat(hairL[..., None], 3, 2), base0)

# --- Face plate: skin lifted to the reference's lit tone and evened out.
hsv = cv2.cvtColor(plate0.astype(np.uint8), cv2.COLOR_RGB2HSV)
grey = hsv[..., 1] < 40                                    # everything but the coloured eyes
plate = plate0.copy()
plate[grey] = np.clip(plate0[grey] * (LIT_SKIN / 193.0), 0, 255)
skinL = LIT_SKIN - 6 + 14 * ss(900, 2400, ys)
Lpl = cv2.cvtColor(np.clip(plate, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
flat = grey & (np.abs(Lpl - LIT_SKIN) < 14)
flat &= cv2.erode(flat.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
edge = cv2.GaussianBlur(flat.astype(np.float32), (0, 0), 3)
plate = plate * (1 - edge[..., None]) + np.repeat(skinL[..., None], 3, 2) * edge[..., None]

# The right eye is redrawn from the eye sheet (outline, lashes and opening fitted onto it), so the drawn one
# goes: its ink, white and iris become skin. A box around it keeps the rest of the face as drawn.
REYE = (760, 690, 1440, 1220)
Lp0 = cv2.cvtColor(plate0.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
drawn_eye = (Lp0 < 150) | (Lp0 > 212) | (hsv[..., 1] > 40)
drawn_eye |= np.asarray(Image.open(f'{H}/eye_right_fill.png')) > 0
reye_box = np.zeros((h, w), bool); reye_box[REYE[1]:REYE[3], REYE[0]:REYE[2]] = True
reye_erase = cv2.dilate((drawn_eye & reye_box).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
reye_erase &= reye_box
plate = np.where(reye_erase[..., None], np.repeat(skinL[..., None], 3, 2), plate)
# The left eye (mostly past the picture's left edge) goes the same way; it is drawn as the right one mirrored.
LEYE = (0, 950, 260, 1330)
leye_box = np.zeros((h, w), bool); leye_box[LEYE[1]:LEYE[3], LEYE[0]:LEYE[2]] = True
leye_erase = (cv2.dilate((drawn_eye & leye_box).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & leye_box
plate = np.where(leye_erase[..., None], np.repeat(skinL[..., None], 3, 2), plate)

# Erase the drawn brow and the drawn jaw line: both are redrawn below as single strokes.
jaw_band = np.zeros((h, w), np.uint8)
cv2.polylines(jaw_band, [np.round(jaw + nrm * 2).astype(np.int32)], False, 1, thickness=16)
erase = (cv2.dilate(brow_band.astype(np.uint8), np.ones((11, 11), np.uint8)) > 0) | (jaw_band > 0)
plate = np.where((erase & (above_soft > 0.01))[..., None], np.repeat(skinL[..., None], 3, 2), plate)

# Other face lines (nose, mouth, cheek marks): thinned, faded, blurred, light grey.
def soften(img, exclude):
    L = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    inky = ((L < LIT_SKIN - 35) & (below < 0.5)).astype(np.uint8)
    solid = cv2.morphologyEx(inky, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
    zone = (inky > 0) & (cv2.dilate(solid, np.ones((7, 7), np.uint8)) == 0) & ~exclude & ~eyes
    zone = cv2.dilate(zone.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    ink = np.clip((LIT_SKIN - L) / LIT_SKIN, 0, 1) * zone
    ink = cv2.GaussianBlur(cv2.erode(ink, np.ones((3, 3), np.uint8)) * fade, (0, 0), 1.6)
    newL = LIT_SKIN - ink * LIT_SKIN * 0.38
    out = np.clip(img, 0, 255).copy()
    out[zone] = np.repeat(newL[..., None], 3, 2)[zone]
    return out
plate = soften(plate, erase | reye_erase | leye_erase)
# Inside the eye openings the rig draws the eye; the plate there is skin, so the lid's soft edge blends into
# skin rather than into the drawing's eye outline.
inside_eye = np.asarray(Image.open(f'{H}/eye_left_fill.png')) > 0
plate[inside_eye] = np.repeat(skinL[..., None], 3, 2)[inside_eye]
# Nothing on the face is brighter than the skin: the drawing's light halos around lines and lock edges go.
plate = np.where((grey & (above_soft > 0.5) & (plate.mean(2) > skinL + 2))[..., None], np.repeat(skinL[..., None], 3, 2), plate)
# Skin within 2 levels of its tone is the tone: the erased eyes and lifted lines left 1-level ghosts of their
# old strokes, faint outlines that show on a large monitor.
near_skin = grey & (above_soft > 0.5) & (np.abs(plate.mean(2) - skinL) <= 2)
plate = np.where(near_skin[..., None], np.repeat(skinL[..., None], 3, 2), plate)
# The drawn mouth goes: the mouth sheet's shapes (build/portrait/mouths) are drawn over this spot instead.
MOUTH_BOX = (400, 1790, 810, 1895)
mouth_box = np.zeros((h, w), bool); mouth_box[MOUTH_BOX[1]:MOUTH_BOX[3], MOUTH_BOX[0]:MOUTH_BOX[2]] = True
mouth_ink = (cv2.dilate((mouth_box & (plate.mean(2) < skinL - 3)).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & mouth_box
plate = np.where(mouth_ink[..., None], np.repeat(skinL[..., None], 3, 2), plate)

# The nose: the reference's flat shadow (its outline, relative to its nose tick, in reference px; the
# reference and this screen share a scale of 1.28 base px per reference px), placed on her own nose tick and
# multiplied in, so the tick inside it darkens as the reference's does.
NOSE_REF = [[-38, -178], [-48, -176], [-68, -162], [-96, -132], [-112, -108], [-126, -80], [-134, -48], [-132, -24],
            [-128, -4], [-116, 28], [-102, 52], [-92, 64], [-78, 76], [-72, 78], [-58, 76], [-34, 60], [-18, 40], [-4, 12],
            [0, 26], [4, 24], [4, -22], [2, -26], [4, -72], [-2, -110], [-16, -152], [-26, -168]]
NOSE_TICK = (493.1, 1484.3)
nose = cv2.GaussianBlur(aa_fill([np.array(NOSE_REF, np.float32) * 1.28 + NOSE_TICK]), (0, 0), 1.2)
plate = plate * (1 - 0.30 * nose[..., None])

# The jaw's edge catches a little light (the reference brightens to ~225 there).
jaw_img = np.ones((h, w), np.uint8)
cv2.polylines(jaw_img, [np.round(jaw + nrm * 4).astype(np.int32)], False, 0, thickness=1)
jaw_dist = cv2.distanceTransform(jaw_img, cv2.DIST_L2, 5)
plate = plate + (9 * (1 - ss(0, 110, jaw_dist)) * (above_soft > 0.5))[..., None]

# Below the jaw: still and out of focus, blurred only from what is below it.
blurred = cv2.GaussianBlur(base * bg_hard[..., None], (0, 0), 14) / np.maximum(cv2.GaussianBlur(bg_hard, (0, 0), 14), 1e-3)[..., None]
plate = plate * (1 - below[..., None]) + blurred * below[..., None]
hair_mask = mask * above_soft
# The head's shadow on the neck: darkest right under the jaw (~170 in the reference), gone ~190 px below.
plate = plate * (1 - (0.12 * (1 - ss(0, 190, jaw_dist)) * below)[..., None])

# The jaw line: one soft stroke on the face edge, fading gently along its length.
jaw_fade = 0.75 + 0.25 * fade[np.clip(jaw[:, 1].astype(int), 0, h - 1), np.clip(jaw[:, 0].astype(int), 0, w - 1)]
ends = np.minimum(np.arange(len(jaw)), np.arange(len(jaw))[::-1])
jl = stroke(jaw + nrm * 3, np.full(len(jaw), 4.5), jaw_fade * np.clip(ends / 40, 0.6, 1))
plate = plate * (1 - jl[..., None]) + JAW_TONE * jl[..., None]

# The brow: its drawn shape (brow_band) refitted as one smooth curve at ~55% of its width, tapered at both
# ends, drawn on the skin behind the hair so it shows between the locks as the reference's brows do.
bx, by, bw = [], [], []
for x in range(w):
    col = np.where(brow_band[:, x])[0]
    if len(col): bx.append(x); by.append((col.min() + col.max()) / 2); bw.append(col.max() - col.min() + 1)
bx, by, bw = (np.array(v, np.float32) for v in (bx, by, bw))
xs = np.arange(bx.min(), bx.max() + 1, 1.0, dtype=np.float32)
brow = np.stack([xs, np.polyval(np.polyfit(bx, by, 4), xs)], 1).astype(np.float32)
brow_w = np.maximum(np.polyval(np.polyfit(bx, bw, 4), xs) * 0.55, 1.5)
brow_a = 0.9 * (0.8 + 0.2 * fade[np.clip(brow[:, 1].astype(int), 0, h - 1), brow[:, 0].astype(int)])
bl = stroke(brow, brow_w, brow_a)
plate = plate * (1 - bl[..., None]) + BROW_TONE * bl[..., None]
print('brow from', brow[0].round(), 'to', brow[-1].round(), 'max width', brow_w.max().round(1))

# --- The right eye from the sheet: fit the sheet's sclera onto her eye opening (affine, ECC), then carry the
#     sheet's outline and lashes across with the same transform, in her own lash colour.
sheet = np.asarray(Image.open('build/portrait/reference/eye-parts.jpg').convert('RGB')).astype(np.float32)
Ls = cv2.cvtColor(sheet.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
sbox = np.zeros(Ls.shape, bool); sbox[100:530, 1200:1960] = True        # the OUTLINE & LASHES drawing
s_ink = (Ls < 140) & sbox
s_scl = (Ls > 236) & (sheet[..., 2] > sheet[..., 1] + 4) & sbox
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(s_scl.astype(np.uint8), 8)
s_scl = cv2.morphologyEx((lab_ == 1 + int(np.argmax(st_[1:, 4]))).astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
s_scl = (cv2.GaussianBlur(s_scl.astype(np.float32), (0, 0), 2.5) > 0.5).astype(np.float32)
s_alpha = np.clip((236 - Ls) / 190, 0, 1) * (cv2.dilate(s_ink.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
ours = (np.asarray(Image.open(f'{H}/eye_right.png')) > 0).astype(np.float32)
oy, ox = np.where(ours > 0); sy_, sx_ = np.where(s_scl > 0)
k = (oy.max() - oy.min()) / (sy_.max() - sy_.min())
A = np.array([[1 / k, 0, sx_.min() - ox.min() / k], [0, 1 / k, sy_.min() - oy.min() / k]], np.float32)   # ours -> sheet
q = 0.5
Aq = A.copy(); Aq[:, 2] *= q
cc, Aq = cv2.findTransformECC(cv2.GaussianBlur(cv2.resize(ours, None, fx=q, fy=q), (0, 0), 2), cv2.GaussianBlur(cv2.resize(s_scl, None, fx=q, fy=q), (0, 0), 2),
                              Aq, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7), None, 5)
A = Aq.copy(); A[:, 2] /= q
print('right eye fit: ECC', round(cc, 3))
# Narrower, like the reference's heavy-lidded eye: squash the sheet's eye toward its lower lid, so the upper
# lid and its lashes come down over the iris. (Sheet y measured from the sclera's lowest point.)
EYE_NARROW = 0.75
y_low = float(np.where(s_scl > 0)[0].max())
U = np.array([[1, 0, 0], [0, 1 / EYE_NARROW, y_low * (1 - 1 / EYE_NARROW)], [0, 0, 1]], np.float32)
A = (U @ np.vstack([A, [0, 0, 1]]))[:2]
warp = lambda img: cv2.warpAffine(img, A, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
opening = warp(s_scl) > 0.5
outline = warp(s_alpha.astype(np.float32))
LASH_RGB = np.median(base0[reye_box & (L0 < 60) & (mask < 0.5)], axis=0)

# The blink, after the old wallpaper's recording: the thick upper lash band itself drops, the lid's skin
# following above it, until the band lies along the lower lid as one dark crescent. The outline is split by
# stroke: the lower lid line (with its lashes) stays put as a still sprite; the band, every flick and the
# outer-corner stroke move together, so no stroke is ever cut in two. The band drops along one smooth cubic
# curve (full eye height at the middle), so it flexes as one piece rather than following every lump of the
# eye's outline; where the curve falls short of the eye's height the lid's skin closes the rest. That is
# pre-rendered as BLINK_FRAMES frames stacked in one image, frame 0 open and the last shut.
cols_o = np.where(opening.any(0))[0]
tops = np.array([np.argmax(opening[:, x]) for x in cols_o], np.float32)
bots = np.array([h - 1 - np.argmax(opening[::-1, x]) for x in cols_o], np.float32)
# Strokes from the solid ink; each soft edge pixel then goes to the stroke whose ink is nearest.
n_s, strokes = cv2.connectedComponents((outline > 0.3).astype(np.uint8), connectivity=8)
_, near = cv2.distanceTransformWithLabels((strokes == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
seed = np.zeros(near.max() + 1, np.int32); zy, zx = np.where(strokes > 0)
seed[near[zy, zx]] = strokes[zy, zx]
strokes = np.where(outline > 0.005, seed[near], 0)
under_lid = np.zeros((h, w), bool)
for x, b_ in zip(cols_o, bots): under_lid[int(b_) - 2:int(b_) + 20, x] = True
lower_id = int(np.argmax(np.bincount(strokes[under_lid & (strokes > 0)], minlength=n_s)))
lower_a = (outline * (strokes == lower_id)).astype(np.float32)
upper_a = (outline * ((strokes > 0) & (strokes != lower_id))).astype(np.float32)
ux_min = int(np.where(upper_a.any(0))[0].min())
fit = np.polyval(np.polyfit(cols_o, bots - tops + 3, 3), np.arange(ux_min, w))
drop = np.zeros(w, np.float32)
drop[ux_min:] = np.clip(fit, 0, float((bots - tops).max()) + 3)   # remap needs float32 maps
print('strokes', n_s - 1, '| drop at inner corner / middle / edge', [round(float(drop[x])) for x in (cols_o.min(), (cols_o.min() + cols_o.max()) // 2, cols_o.max())])
LID_SHADOW = np.array([58, 34, 54], np.float32)
BLINK_FRAMES = 33
SC = 1440 / 922
geom = lambda x0, y0, x1, y1: {'x': round(690 + float(x0) / SC, 2), 'y': round(float(y0) / SC, 2), 'w': round(float(x1 - x0) / SC, 2), 'h': round(float(y1 - y0) / SC, 2)}


def save_lower(lower_a, name):
    """The still lower lid line as a sprite; its place in the view."""
    ys_, xs_ = np.where(lower_a > 0.02)
    x0, y0, x1, y1 = xs_.min(), ys_.min(), xs_.max() + 1, ys_.max() + 1
    sprite = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    sprite[..., :3] = LASH_RGB.astype(np.uint8)
    sprite[..., 3] = (lower_a[y0:y1, x0:x1] * 255).astype(np.uint8)
    Image.fromarray(sprite).save(OUT + name, optimize=True)
    return geom(x0, y0, x1, y1)


def save_blink(upper_a, opening, drop, name):
    """The band dropping, BLINK_FRAMES frames stacked in one image (open to shut); its place in the view."""
    cols = np.where(opening.any(0))[0]
    tops = np.full(w, -1e6, np.float32); height = np.zeros(w, np.float32)
    for x in cols:
        yy = np.where(opening[:, x])[0]; tops[x] = yy.min(); height[x] = yy.max() - yy.min()
    uy, ux = np.where(upper_a > 0.02)
    fy0, fx0 = max(0, int(uy.min()) - 2), max(0, int(min(ux.min(), cols.min())) - 2)
    fy1 = min(h, int(max(uy.max() + drop.max(), np.where(opening)[0].max())) + 4)
    fx1 = min(w, int(max(ux.max(), cols.max())) + 3)       # an eye may run off the picture's edge
    fh_, fw_ = fy1 - fy0, fx1 - fx0
    gx, gy = np.meshgrid(np.arange(fx0, fx1, dtype=np.float32), np.arange(fy0, fy1, dtype=np.float32))
    dcol = drop[fx0:fx1][None, :]
    # The lid's skin reaches 2 px past the opening all round and 4 px above it, so no anti-aliased edge of the
    # sclera, lid shade or iris peeks out around it (the lower line it overlaps is ~9 px thick).
    opening_up = cv2.dilate(opening.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(bool)
    opening_up |= np.roll(opening, -4, axis=0)
    open_soft = cv2.GaussianBlur(opening_up.astype(np.float32), (0, 0), 0.8)[fy0:fy1, fx0:fx1]
    lid_rgb = np.clip(plate, 0, 255)[fy0:fy1, fx0:fx1]          # the lid is the face's own skin there
    tp, hg = tops[fx0:fx1][None, :], height[fx0:fx1][None, :]
    sheet = np.zeros((fh_ * BLINK_FRAMES, fw_, 4), np.uint8)
    for k in range(BLINK_FRAMES):
        t = k / (BLINK_FRAMES - 1)
        band = cv2.remap(upper_a, gx, gy - t * dcol, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        # Measured from the eye's true top: shut, the skin runs 3 px past the bottom even where the band stops short.
        skin_a = np.clip(tp + t * np.maximum(dcol, hg + 3) + 1 - gy, 0, 1) * open_soft * (t > 0)
        # The lid's shadow on the eye just under the band (dark in the recording as the band comes down): it also
        # keeps the slit pupil's tip from reading as a spike in the band's edge.
        edge = tp + t * dcol
        shade_a = 0.55 * np.clip(1 - (gy - edge) / 34, 0, 1) ** 1.5 * (gy > edge - 3) * open_soft * min(1.0, t * 5)
        under = shade_a * (1 - skin_a)
        a1 = skin_a + under                                     # skin and shadow do not overlap
        rgb1 = (lid_rgb * skin_a[..., None] + LID_SHADOW * under[..., None]) / np.maximum(a1, 1e-4)[..., None]
        a = band + a1 * (1 - band)
        rgb = (LASH_RGB * band[..., None] + rgb1 * (a1 * (1 - band))[..., None]) / np.maximum(a, 1e-4)[..., None]
        sheet[k * fh_:(k + 1) * fh_, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
        sheet[k * fh_:(k + 1) * fh_, :, 3] = (np.clip(a, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(sheet).save(OUT + name, optimize=True)
    return {**geom(fx0, fy0, fx1, fy1), 'frames': BLINK_FRAMES, 'frameW': int(fw_), 'frameH': int(fh_)}


def outline_of(m):
    """The mask's outline, smoothed around the loop so pixel stairs do not show at 2.3x on screen."""
    c = max(cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea)[:, 0, :].astype(np.float32)
    pad = np.vstack([c[-12:], c, c[:12]])
    c = np.stack([cv2.GaussianBlur(pad[:, i:i + 1].T, (0, 0), 2.0, borderType=cv2.BORDER_REPLICATE)[0] for i in (0, 1)], 1)[12:-12]
    c = cv2.approxPolyDP(c.reshape(-1, 1, 2), 0.3, True)[:, 0, :]
    return ' '.join(f'{690 + x / SC:.1f},{y / SC:.1f}' for x, y in c), round(float(c[:, 1].min()) / SC, 1), round(float(c[:, 1].max()) / SC, 1)


# The right eye's iris, pupil and main reflection, in view (source) px: the iris rests on the lower lid and the
# upper lid crosses its top, heavy-lidded like the reference.
R_IRIS, R_PUPIL, R_SHINE = (1404, 651, 109), (1398, 664, 15, 52), (1347, 627, 20)
eyes = {}
r_open, r_top, r_bot = outline_of(opening)
eyes['right'] = {'open': r_open, 'top': r_top, 'bottom': r_bot,
                 'outline': save_lower(lower_a, 'closeup-eye-right.png'), 'blink': save_blink(upper_a, opening, drop, 'closeup-blink-right.png'),
                 'iris': dict(zip(('cx', 'cy', 'r'), R_IRIS)), 'pupil': dict(zip(('cx', 'cy', 'rx', 'ry'), R_PUPIL)), 'shine': dict(zip(('cx', 'cy', 'r'), R_SHINE))}

# The left eye: the right one mirrored, its inner corner set on the drawn left eye's inner corner (the only part of
# it on screen), so both eyes have the same shape and close the same way.
left_drawn = np.asarray(Image.open(f'{H}/eye_left.png')) > 0
xl = int(np.where(left_drawn.any(0))[0].max()); yl = float(np.where(left_drawn[:, xl])[0].mean())
xr = int(cols_o.min()); yr = float((tops[0] + bots[0]) / 2)
cx, dy = xl + xr, yl - yr
M = np.array([[-1, 0, cx], [0, 1, dy]], np.float32)
mirror = lambda img: cv2.warpAffine(img.astype(np.float32), M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
src_x = cx - np.arange(w)
drop_l = np.where((src_x >= 0) & (src_x < w), drop[np.clip(src_x, 0, w - 1)], 0).astype(np.float32)
opening_l = mirror(opening) > 0.5
mx = lambda x: round(690 + (cx - (x - 690) * SC) / SC, 1)
my = lambda y: round(y + dy / SC, 1)
l_open, l_top, l_bot = outline_of(opening_l)
eyes['left'] = {'open': l_open, 'top': l_top, 'bottom': l_bot,
                'outline': save_lower(mirror(lower_a), 'closeup-eye-left.png'), 'blink': save_blink(mirror(upper_a), opening_l, drop_l, 'closeup-blink-left.png'),
                'iris': {'cx': mx(R_IRIS[0]), 'cy': my(R_IRIS[1]), 'r': R_IRIS[2]},
                'pupil': {'cx': mx(R_PUPIL[0]), 'cy': my(R_PUPIL[1]), 'rx': R_PUPIL[2], 'ry': R_PUPIL[3]},
                'shine': {'cx': mx(R_SHINE[0]), 'cy': my(R_SHINE[1]), 'r': R_SHINE[2]}}
print('left eye: mirror about x', cx, 'shift', round(dy, 1), '| inner corner', (xl, round(yl)), '| iris', eyes['left']['iris'])
json.dump(eyes, open(OUT + 'closeup-eyes.json', 'w'), indent=1)
print('lash colour', LASH_RGB.round())

# --- Write.
# Dithered: the skin's brightening toward the chin is 14 levels over ~1500 px, and stored as whole levels it
# steps once every ~100 px, each step a straight line across the face. +-1 level of noise breaks the steps up;
# the plate is saved lossless so compression cannot put them back.
dither = lambda img: np.clip(img + (rng.random(img.shape[:2]) - rng.random(img.shape[:2]))[..., None], 0, 255).astype(np.uint8)
base_out = dither(base)
plate_out = dither(plate)
r = cv2.GaussianBlur((hair_mask * 255).astype(np.uint8), (0, 0), 1.2)
g = cv2.GaussianBlur(cv2.erode((hair_mask > 0.5).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (51, 51))), (0, 0), 1.0)
Image.fromarray(base_out).save(OUT + 'haru-closeup.webp', quality=94, method=6)
Image.fromarray(plate_out).save(OUT + 'closeup-plate.webp', lossless=True, quality=100, method=6)
Image.fromarray(np.dstack([r, g, np.zeros_like(r)])).save(OUT + 'closeup-hair.png', optimize=True)

# --- The mouth sheet (build/portrait/mouths, traced SVGs on one 269x277 canvas, viewBox 538x554) as clean grey
#     sprites: each traced path's outline is smoothed (the trace's wobble and stair-steps go), the paths are painted in
#     order, supersampled, in their own grey; the dark line paths are shaved so the line is thinner.
import re, glob, os, time
MOUTH_PX = 6                    # final px per canvas unit: about what the screen shows (2.5 view px x 2.34)
MOUTH_SS = 4
MOUTH_SMOOTH = 1.6              # viewBox units of smoothing along each path's outline
MOUTH_LINE = 80                 # paths darker than this grey are the line
MOUTH_THIN = 0.45               # canvas units shaved off each side of the line
MOUTH_BLEND = 22                # grey difference below which neighbouring patches blend
os.makedirs(OUT + 'mouth-sprites', exist_ok=True)


def cubic(p0, p1, p2, p3, n=12):
    t = np.linspace(0, 1, n + 1)[1:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def smooth_loop(pts, step=0.4):
    """The closed outline resampled every `step` units and blurred along itself."""
    seg = np.linalg.norm(np.diff(np.vstack([pts, pts[:1]]), axis=0), axis=1)
    t = np.concatenate([[0], np.cumsum(seg)]); n = max(8, int(t[-1] / step))
    u = np.linspace(0, t[-1], n, endpoint=False)
    loop = np.vstack([pts, pts[:1]])
    q = np.stack([np.interp(u, t, loop[:, i]) for i in (0, 1)], 1).astype(np.float32)
    sig = min(MOUTH_SMOOTH / step, n / 6)
    pad = int(3 * sig) + 1
    w_ = np.vstack([q[-pad:], q, q[:pad]]) if pad < n else np.vstack([q, q, q])[n - pad:2 * n + pad]
    return np.stack([cv2.GaussianBlur(w_[:, i:i + 1].T, (0, 0), sig, borderType=cv2.BORDER_REPLICATE)[0] for i in (0, 1)], 1)[pad:pad + n]


def raster_mouth(svg_path):
    s = open(svg_path).read()
    k = MOUTH_PX * MOUTH_SS / 2                          # px per viewBox unit
    W_, H_ = int(269 * MOUTH_PX * MOUTH_SS), int(277 * MOUTH_PX * MOUTH_SS)
    paths = []
    for d, fill, tx, ty in re.findall(r'<path d="([^"]*)" fill="#([0-9A-Fa-f]{6})" transform="translate\(([-\d.]+),([-\d.]+)\)"', s):
        r_, g_, b_ = (int(fill[j:j + 2], 16) for j in (0, 2, 4))
        polys, cur = [], []
        toks = re.findall(r'[MCZ]|-?[\d.]+(?:e-?\d+)?', d)
        j = 0
        while j < len(toks):
            c = toks[j]; j += 1
            if c == 'M':
                if len(cur) > 2: polys.append(np.array(cur))
                cur = [np.array([float(toks[j]), float(toks[j + 1])])]; j += 2
            elif c == 'C':
                while j < len(toks) and toks[j] not in 'MCZ':
                    p_ = [np.array([float(toks[j + 2 * m]), float(toks[j + 2 * m + 1])]) for m in range(3)]; j += 6
                    cur.extend(cubic(cur[-1], *p_))
            elif c == 'Z':
                if len(cur) > 2: polys.append(np.array(cur))
                cur = []
        if len(cur) > 2: polys.append(np.array(cur))
        polys = [np.round((smooth_loop(pp) + [float(tx), float(ty)]) * k * 8).astype(np.int32) for pp in polys]
        paths.append((0.299 * r_ + 0.587 * g_ + 0.114 * b_, polys))
    # The line: every dark path together, shaved on both sides.
    line = np.zeros((H_, W_), np.uint8)
    cv2.fillPoly(line, [pp for g_, ps in paths if g_ < MOUTH_LINE for pp in ps], 1, cv2.LINE_8, 3)
    shave = int(round(MOUTH_THIN * MOUTH_PX * MOUTH_SS))
    line_keep = cv2.erode(line, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * shave + 1, 2 * shave + 1)))
    grey = np.zeros((H_, W_), np.float32); alpha = np.zeros((H_, W_), np.float32)
    for g_, ps in paths:
        m = np.zeros((H_, W_), np.uint8)
        cv2.fillPoly(m, ps, 1, cv2.LINE_8, 3)
        if g_ < MOUTH_LINE: m &= line_keep
        on = m > 0
        grey[on] = g_; alpha[on] = 1
    small = (W_ // MOUTH_SS, H_ // MOUTH_SS)
    a = cv2.resize(alpha, small, interpolation=cv2.INTER_AREA)
    g = cv2.resize(grey * alpha, small, interpolation=cv2.INTER_AREA) / np.maximum(a, 1e-4)
    # The trace's shading is posterized into patches: close tones blend (the line and teeth edges stay), and the lip
    # shading's own outer edge goes soft, like the sheet's airbrushed lips.
    g = np.where(a > 0.5, g, cv2.dilate(g, np.ones((5, 5), np.uint8)))
    for _ in range(3): g = cv2.bilateralFilter(g.astype(np.float32), 0, MOUTH_BLEND, MOUTH_PX * 1.5)
    a = np.where(g > MOUTH_LINE + 40, np.minimum(a, cv2.GaussianBlur(a, (0, 0), MOUTH_PX * 0.8) * 1.15), a)
    return np.dstack([g, g, g, a * 255]).clip(0, 255).astype(np.uint8)


t0 = time.time()
for svg in sorted(glob.glob('build/portrait/mouths/M_*.svg')):
    name = os.path.basename(svg)[:-4]
    Image.fromarray(raster_mouth(svg)).save(OUT + f'mouth-sprites/{name}.png', optimize=True)
print('mouth sprites', len(glob.glob(OUT + 'mouth-sprites/*.png')), 'in', round(time.time() - t0, 1), 's')

# Preview with the live shade, only when a preview folder is given (the eye sprite on the plate; the rig's sclera and iris are not drawn).
if len(sys.argv) < 3: sys.exit()
P = sys.argv[2]
comp = plate_out * (1 - r[..., None] / 255) + base_out * (r[..., None] / 255)
comp = comp * (1 - outline[..., None]) + LASH_RGB * outline[..., None]
xs2 = np.arange(w, dtype=np.float32)[None, :]
line_y = 1250 + (700 - 1250) * xs2 / 1440
shadow = cv2.GaussianBlur((ys < line_y).astype(np.float32), (0, 0), 12)
comp = np.clip(comp * (1 - shadow[..., None] * (1 - SHADE)), 0, 255).astype(np.uint8)
Image.fromarray(comp).save(f'{P}/tone_full.png')
Image.fromarray(comp).resize((540, 960)).save(f'{P}/tone_preview.png')
print('ok')

