"""The side view's inputs: the close-up's, widened to the right edge of the drawing, for a window over her left ear,
and her hair carried on past that edge so it ends in an outline of its own rather than the drawing's straight cut.

Run from the repo root: python -I scripts/portrait/side_inputs.py RIGHT_4X scripts/portrait/inputs scripts/portrait/inputs-side
RIGHT_4X is closeup-gray.jpg's x 1078..2000 upscaled 4x by RealESRGAN_x4plus_anime_6B, the way the close-up's own base
was made from its x 690..1612. At 1440 px per 922 drawing px that picture starts exactly 606 px right of the close-up's,
so the wide canvas keeps the close-up's pixel grid: x 0 is still drawing x 690 and every close-up input is reused as it
is. The new strip right of the close-up is cut by tone (it holds no eyes or brows): hair is everything darker than skin,
its ink, its fill and the inner hair and streak. Past the drawing's edge her hair goes on as the long back lock from
the user's hair sheet (build/portrait/reference/hair-layers.jpg, the right-hand dark lock with its pink inner layer),
toned into the drawing's fill, inner-hair grey and line, behind the drawn side hair, whose edge gets its outline.
Writes base_orig.webp, alpha.png (the picture's outline), plate-region/plate.png, seg-final/hair_mask.png, the brow
band and the eye openings (zero-padded), plus view.json for build_assets.py."""
import sys, os, json, numpy as np, cv2
from PIL import Image
RIGHT, SRC, DST = sys.argv[1:4]
EDGE = 2046                  # drawing x 2000 at 1440/922: the drawing's right edge on this canvas
MORE = 400                   # how far past it the picture runs
W = EDGE + MORE
OFFSET = 606                 # where RIGHT_4X's picture starts on the wide canvas
SEAM = 1438                  # the close-up's own inputs left of here (its edge), the new strip's right of it
FADE = 4                     # the two upscales agree to compression noise
# Past the close-up's edge (her eye's outer corner) the lash band ends in a wing, tip at about (1628, 728): a cel of its
# own tone (~30-38 against the hair's ~46, a crisp edge with no line) that the lock above it sits on, found by that tone
# within WING. The eye's thick outer outline runs on down beside the white to where the lock beside the eye starts
# (traced). Both are eye, not hair, as in the close-up: the rig redraws the eye from the sheet and build_assets.py
# erases the drawn one, so the lock keeps its drawn edge over skin.
WING = (SEAM - 8, 620, 1760, 900)       # from just inside the crossfade
OUTLINE = [(SEAM - 8, 850), (1505, 850), (1505, 880), (1501, 900), (1497, 920), (1497, 940), (1493, 960), (SEAM - 8, 960)]
# The sheet's lock: found from SHEET_SEED against the sheet's background; its rows SHEET_Y span the picture's height, and
# its outermost point (sheet x SHEET_OUT) sits SHEET_REACH px past EDGE. Its tones (dark hair, lines, pink) go to the
# drawing's (fill 46, ink 18, inner hair 148) by luminance.
SHEET, SHEET_BG, SHEET_SEED = 'build/portrait/reference/hair-layers.jpg', (196, 192, 193), (1150, 1200)
SHEET_Y, SHEET_OUT, SHEET_REACH = (760, 1960), 1346, 400
TONES = ([40, 78, 177], [18, 46, 148])
INK, LINE_W = 18.0, 7
CROP = 201                   # the side window starts here: drawing x 818.7
SKIN = 193.0
TIPS = 125                   # her hair's pre-shade tone low down: lit (below the shade), the streak at 1.22x stays under her skin

old = np.asarray(Image.open(f'{SRC}/base_orig.webp').convert('RGB')).astype(np.float32)
h = old.shape[0]
right = np.asarray(Image.open(RIGHT).convert('RGB').resize((1440, h), Image.LANCZOS)).astype(np.float32)
xs = np.arange(W, dtype=np.float32)[None, :, None]
t = np.clip((xs - (SEAM - FADE)) / FADE, 0, 1)
wide_old = np.zeros((h, W, 3), np.float32); wide_old[:, :old.shape[1]] = old
wide_new = np.zeros((h, W, 3), np.float32); wide_new[:, OFFSET:OFFSET + 1440] = right
base = wide_old * (1 - t) + wide_new * t

# Past the edge: the sheet's lock, toned and scaled, behind the drawn hair; the drawn side hair's edge gets an outline.
sheet = np.asarray(Image.open(SHEET).convert('RGB')).astype(np.float32)
off_bg = np.abs(sheet - np.array(SHEET_BG, np.float32)).sum(2)
lab = cv2.connectedComponents(cv2.morphologyEx((off_bg > 40).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)), connectivity=8)[1]
piece = cv2.dilate((lab == lab[SHEET_SEED[1], SHEET_SEED[0]]).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
lock_a = np.clip((off_bg - 20) / 40, 0, 1) * piece
lock_l = np.interp(sheet.mean(2), *TONES)
k = h / (SHEET_Y[1] - SHEET_Y[0])
M = np.array([[k, 0, EDGE + SHEET_REACH - SHEET_OUT * k], [0, k, -SHEET_Y[0] * k]], np.float32)   # sheet -> canvas
lock_a = cv2.warpAffine(lock_a.astype(np.float32), M, (W, h), flags=cv2.INTER_AREA)
lock_l = cv2.warpAffine(lock_l.astype(np.float32), M, (W, h), flags=cv2.INTER_AREA)
cols = np.arange(W)[None, :]
past_edge = cols >= EDGE
base[:, EDGE:] = lock_l[:, EDGE:, None]
alpha = np.where(past_edge, lock_a, 1.0)
line = np.clip(LINE_W / 2 + 0.5 - np.abs(cols - (EDGE + 2.0)), 0, 1) * (lock_a > 0.5)
base = base * (1 - line[..., None]) + INK * line[..., None]
g = cv2.cvtColor(np.clip(base + 0.5, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)

# The strip's hair: darker than skin, with the 1-2 px anti-aliased rim it leaves taken in, softened as the close-up's.
hard = ((g < 175) & (alpha > 0.5)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(1 - hard, connectivity=4)
hard[np.isin(lab, [i for i in range(1, n) if st[i, 4] < 300])] = 1            # pinholes in the hair
hard = cv2.dilate(hard, np.ones((3, 3), np.uint8))
wx0, wy0, wx1, wy1 = WING
wing = np.zeros((h, W), np.uint8)
wing[wy0:wy1, wx0:wx1] = (g[wy0:wy1, wx0:wx1] >= 24) & (g[wy0:wy1, wx0:wx1] <= 41)
lab = cv2.connectedComponents(wing, connectivity=4)[1]
eye = (lab == lab[800, SEAM + 4]).astype(np.uint8)
cv2.fillPoly(eye, [np.array(OUTLINE, np.int32)], 1)
hard[cv2.dilate(eye, np.ones((5, 5), np.uint8)) > 0] = 0
strip = (cv2.GaussianBlur(hard.astype(np.float32), (0, 0), 0.8) * 255).round() * alpha
mask_old = np.zeros((h, W), np.float32)
mask_old[:, :old.shape[1]] = np.asarray(Image.open(f'{SRC}/seg-final/hair_mask.png').convert('L'))
tm = t[..., 0]
mask = np.clip(mask_old * (1 - tm) + strip * tm, 0, 255)

# The plate: behind the hair everything is flat skin, as in the close-up's; the strip's light halos flattened too.
plate_old = np.zeros((h, W, 3), np.float32)
plate_old[:, :old.shape[1]] = np.asarray(Image.open(f'{SRC}/plate-region/plate.png').convert('RGB'))
hair = hard > 0
plate_new = base.copy()
plate_new[hair] = SKIN
ring = ~hair & (cv2.dilate(hair.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
sat = base.max(2) - base.min(2)
plate_new[ring & (np.abs(g - SKIN) < 45) & (sat < 12)] = SKIN
plate = plate_old * (1 - t) + plate_new * t

def pad(name):
    a = np.asarray(Image.open(f'{SRC}/{name}'))
    out = np.zeros((h, W), a.dtype); out[:, :a.shape[1]] = a
    Image.fromarray(out).save(f'{DST}/{name}')

os.makedirs(f'{DST}/plate-region', exist_ok=True); os.makedirs(f'{DST}/seg-final', exist_ok=True)
Image.fromarray(np.clip(base + 0.5, 0, 255).astype(np.uint8)).save(f'{DST}/base_orig.webp', lossless=True, quality=100, method=6)
Image.fromarray((alpha * 255).round().astype(np.uint8)).save(f'{DST}/alpha.png', optimize=True)
Image.fromarray(np.clip(plate + 0.5, 0, 255).astype(np.uint8)).save(f'{DST}/plate-region/plate.png', optimize=True)
Image.fromarray(mask.astype(np.uint8)).save(f'{DST}/seg-final/hair_mask.png', optimize=True)
for name in ('brow_band.png', 'eye_left.png', 'eye_left_fill.png', 'eye_right.png', 'eye_right_fill.png'): pad(name)
json.dump({'name': 'side', 'crop': CROP, 'sharp': True, 'tips': TIPS, 'edge': EDGE}, open(f'{DST}/view.json', 'w'))

# Self-check on known points (x, y) of the strip.
for x, y in [(1700, 600), (1600, 1800), (1300, 2050), (1990, 2300), (EDGE + 30, 900), (EDGE + 30, 2000)]: assert mask[y, x] > 127, ('hair', x, y)
for x, y in [(1970, 900), (1300, 1700), (W - 2, 900)]: assert mask[y, x] < 128, ('not hair', x, y)
print('ok', base.shape, 'hair share', round(float((mask > 127).mean()), 3), '| picture', W - CROP, 'px =', round((W - CROP) * 922 / 1440, 2), 'view px')
