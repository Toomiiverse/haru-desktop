# The reference, frame by frame

`~/Downloads/3fjjorljvxcf1.gif` — 107 frames, 267×209, 3.57 s. Frame delays
alternate 30/40 ms (≈30 fps) and every fifth frame is a near-duplicate, so the
source was 24 fps: one pose change per ~42 ms. Numbers below are the mean
absolute pixel change from the previous frame; GIF dither puts the floor at
about 1.5–2.5, so anything under 3 is a hold.

## Timeline

| # | frames | ms | motion | what happens |
|---|---|---|---|---|
| A | 0–9 | 0–300 | 3–5 | Hands rising from waist back to clasped at the chest; head settles into its tilt. (The loop is cut — see the seam at the end.) |
| B | 10–29 | 330–970 | 1–2 | **Hold 1.** Fists together at the sternum, head tilted to her left, eyes cut hard to her right, small pout. Sway of a pixel or two. |
| C | 30–38 | 1000–1270 | 2.8→3.8 | **Lead-in.** Nine frames. Eyelids lower a step per frame, head drifts down. The body barely moves — the *face* is what leads. |
| D | 39–44 | 1300–1470 | 9.4, 7.8, 4.7, 6, 5.5 | **Dip hit.** Eyes shut on 39. Head drops and tilts further left, fists pull up tighter under the chin, hunch deepens. Six frames, energy front-loaded. |
| E | 45–65 | 1500–2170 | 1.5–3 | **Hold 2.** Eyes closed, head down. Twin-tails keep swinging 4–6 frames after the head stops. Late in the hold (60–65) a smile creeps in. |
| F | 66–71 | 2200–2370 | 4→8→6 | **Lift.** Head comes up, closed-eye smile. Six frames, peak on 69. |
| G | 72–80 | 2400–2670 | 3–4 | **Gather.** Nine frames holding the closed-eye smile with the hands clasped high. Nothing moves but the expression settles. This is the anticipation for the big hit, and it is a *pause*, not a counter-move. |
| H | 81–88 | 2700–2930 | 13, 8, 11, 7, 10, 6, 10.6, 13.5 | **Big hit.** Hands unclasp and drop to two fists at the waist while the torso and head rise — opposite directions. Eyes open on 86–88, mouth opens. Eight frames. |
| I | 89–92 | 2970–3070 | 6.5, 9.5, 11, **17** | **Accent.** The fists pump back up, head tilts to her *right*, mouth at its widest. Four frames; 92 is the most motion in the whole clip. |
| J | 93–99 | 3100–3300 | 7.5, 7, 3.8, 5, 7.5, 3.9, 8 | **Settle.** Two damped bounces (97, 99). Mouth closes to a smile, head tilt eases back toward left. |
| K | 100–105 | 3330–3500 | 1–5 | **Hold 3.** Fists at the waist, soft smile, eyes on the camera. |
| seam | 106→0 | — | 8.4 | The GIF was cut: hands jump from waist to chest across the loop. The original returns them over A. |

Three poses, three holds of 20, 21 and 6+ frames. Everything between them is
6–8 frames long except the lead-ins, which are 9.

## What the style actually is

**The face leads the body by 5–9 frames.** Before the dip, the eyes close over
nine frames while the body waits (C). Before the big hit, the smile arrives
and *holds* for nine frames (G), then the body goes. Anticipation here is not
a counter-lean; it is a facial beat and a pause. For the app that means the
`expressionMood` for an action should land roughly 200–300 ms *before* the
clip's hit, not with it — the two layers are already separate, so this is a
scheduling change, not an animation one.

**Hits are 6–8 frames and front-loaded.** The largest per-frame change is on
the first or second frame of a move (39, 81), then it decays. That is an
ease-out with almost no ease-in: reach the pose fast, arrive soft.

**The big beat is a hit, an accent, then two bounces.** H is one move; I is a
second, smaller move four frames after it in a *different* direction (fists
back up, head to the other side); J is two damped bounces. A single
overshoot-and-settle reads as one snap. This reads as a person.

**Opposing directions sell energy.** In H the hands drop while the head and
torso rise. In I the fists come up while the head goes over the other way.
Nothing moves in one direction at once.

**Holds are ~0.67 s and never dead.** One or two pixels of sway, a blink, hair
settling. Secondary motion (twin-tails) lags 4–6 frames behind every head move
and keeps going into the hold — at runtime the spring bones do this for free;
Haruhi has 73 joints.

**Head tilt alternates.** Left in hold 1, further left in the dip, right on the
accent, back to slight-left at rest. Every beat flips or deepens it.

**Hands are fists, knuckles together, not palms.** A character detail, but the
clasped-at-chest pose is *fists* touching, and the big beat ends in two fists
at the waist. VRoid's rest fingers are open; a fist needs the fifteen finger
bones per hand keyed, which a .vrma carries.

## Against `clips.py` as it stands

| in the reference | in the builder now | change |
|---|---|---|
| lead-in: 9 frames of the face moving first, body still | 3-frame 10% counter-lean | Make the counter-lean optional; add a *lead* — a partial (~15%) drift toward the pose over 8 frames, and leave the counter-move for the big hits only |
| attack 6–8 frames, front-loaded | attack 3–6, overshoot 12% | Keep. Add 8 as the default for full-body hits |
| accent 4 frames after the hit, in a new direction | none | Add an optional second pose per hit, placed `attack+4` after it, with its own small overshoot |
| two damped bounces | one settle | Settle as 12% → −4% → +1.5% → 0 over ~8 frames |
| holds ~20 frames with sway and blink | one breath key mid-hold | Keep; add a second, smaller breath so a long hold has two |
| face leads by 5–9 frames | n/a (face is the app's) | App: fire the expression 200–300 ms before the hit |
| fists | open hands | A `FIST` fragment keying the finger bones |

The timings are already in the right family. What is missing is the face
leading, the accent, and the second bounce — and those are what make it read
as a character reacting rather than a rig snapping.

*Status:* every row in the builder column is now in `clips.py` — lead, front-loaded
attack, two bounces, accent, second breath, `FISTS` — and `think` is the reference
beat for beat. The face-leads row is the app's; it is still open.
