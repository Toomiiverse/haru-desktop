"""Her headphones on the side view: the right cup and its arm from the user's headphone sheet, and the locks that hang in
front of them.

Run from the repo root after build_assets.py has built the side view: python -I scripts/portrait/build_phones.py
Input: scripts/portrait/inputs-side/headphones-x4.webp, the sheet's x 740..1020, y 120..760 (Downloads/VeniceAI_6cd7ffe7...)
upscaled 4x by RealESRGAN_x4plus_anime_6B. Writes build/portrait/side-phones.png (the cup and arm, greyscale, cut from
the sheet's white) with side-phones.json (where it sits, in view px), and side-front.png: the hair mask of the locks in
front of them, picture-sized, for a second hair layer drawn over the headphones.

Worn as in the user's reference of her wearing them: the cup sits on the side of her head over her ear, behind the long
locks that frame her face, so only its outer shell shows past them; the arm rises out of the top of the picture. In this
drawing those locks end in one long ink line from (1650, 0) to (1730, 1800) (picture px); everything left of it is one
piece of hair, found by flood fill between ink lines from FRONT_SEED."""
import json, numpy as np, cv2
from PIL import Image
P = 'build/portrait/'
SHEET = 'scripts/portrait/inputs-side/headphones-x4.webp'
VIEW_X, S = 818.7, 1440 / 922          # the side view's left edge (view px) and picture px per view px
CROP = 201                             # the side picture's x 0 on side_inputs.py's wide canvas
# The cup's place: the sheet's shell (4x x 640..1068) from just behind the front locks to the picture's edge, and the
# cup's centre (4x y 1808) at her ear, a little below the eye's top.
SCALE, SHELL_X, CUP_Y = 0.55, 1600, 870
TONE = (70, 210)                       # the sheet's black..white mapped into her greys: soft lines, silver below skin
FRONT_SEED = (1300, 700)               # (x, y) in the front locks
STREAK_Y = [0, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800]
STREAK_X = [1684, 1684, 1682, 1681, 1677, 1670, 1660, 1647, 1631, 1612, 1591, 1568, 1543, 1514, 1481, 1443, 1402, 1356]
ARM_TOP = 380                          # picture y: above here nothing hangs in front of the headphones

# The cup and arm: the sheet's white cut away from its border inwards, so the highlights inside the cup stay.
im = np.asarray(Image.open(SHEET).convert('RGB')).astype(np.float32)
L = im.mean(2)
bg = ((L > 238) & (im.max(2) - im.min(2) < 14)).astype(np.uint8)
lab = cv2.connectedComponents(bg, connectivity=4)[1]
outside = np.isin(lab, list(set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}))
outside = cv2.morphologyEx(outside.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
alpha = np.clip((1 - cv2.GaussianBlur(outside.astype(np.float32), (0, 0), 1.2) - 0.1) / 0.8, 0, 1)
grey = TONE[0] + L / 255 * (TONE[1] - TONE[0])
w, h = round(im.shape[1] * SCALE), round(im.shape[0] * SCALE)
rgba = np.dstack([grey, grey, grey, alpha * 255])
rgba = cv2.resize(rgba, (w, h), interpolation=cv2.INTER_AREA)
x0, y0 = SHELL_X - 640 * SCALE, CUP_Y - 1808 * SCALE           # picture px
top = max(0, round(-y0))                                       # the arm above the picture is never seen
Image.fromarray(np.clip(rgba[top:], 0, 255).astype(np.uint8)).save(P + 'side-phones.png', optimize=True)
at = {'x': round(VIEW_X + x0 / S, 2), 'y': round((y0 + top) / S, 2), 'w': round(w / S, 2), 'h': round((h - top) / S, 2)}

# The front locks: the hair piece left of the long line, its own ink taken in, within reach of the headphones.
base = np.asarray(Image.open('scripts/portrait/inputs-side/base_orig.webp').convert('L'))[:, CROP:].astype(np.float32)
hair = np.asarray(Image.open(P + 'side-hair.png'))[..., 0]
lab = cv2.connectedComponents(((hair > 127) & (base >= 28)).astype(np.uint8), connectivity=4)[1]
front = (lab == lab[FRONT_SEED[1], FRONT_SEED[0]]).astype(np.uint8)
front = cv2.dilate(front, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
# Only the locks left of the light streak hang in front: the streak and the side lock beyond it go behind, so the cup
# shows from the streak's edge out (its ink edge measured every 100 px; straight up from its tip at y 250). From the cup's
# top up the arm is in front of all of her hair, as a headband sits on it.
edge = np.interp(np.arange(hair.shape[0]), STREAK_Y, STREAK_X)
cols = np.arange(hair.shape[1])[None, :]
near = (cols <= edge[:, None] + 1) & (cols >= x0 - 80) & (np.arange(hair.shape[0])[:, None] >= ARM_TOP)
red = (hair.astype(np.float32) * front * near).astype(np.uint8)
Image.fromarray(np.dstack([red, np.zeros_like(red), np.zeros_like(red)])).save(P + 'side-front.png', optimize=True)
json.dump(at, open(P + 'side-phones.json', 'w'))
assert front[FRONT_SEED[1], FRONT_SEED[0]] and hair[FRONT_SEED[1], FRONT_SEED[0]] > 127, 'the seed is in the front locks'
assert red[900, 1780] == 0 and red[300, 1820] == 0, 'the skin over her ear and the side lock are behind the cup'
print('phones at', at, '| front lock px', int((red > 127).sum()))
