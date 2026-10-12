# The second reference, frame by frame: faces and the moves between them

`twitter.com/i/status/1865377884107673781` — dani's "facial expression test"
on a free ZZZ rig (Anby), Blender, 5.32 s, 800×800, **24 fps, 128 frames**.
Bust shot, no body motion to speak of; the head and the face are the whole
performance. Numbers are ffmpeg's per-frame scene score ×1000 — how much of
the picture changed since the previous frame. Below 5 is a hold.

## Five faces, four transitions

| # | frames | what she holds | head |
|---|---|---|---|
| hold 1 | 0–12 | content: closed-mouth smile, eyes open, brows neutral | ¾ to her right, level |
| **T1** | 13–26 | → | |
| hold 2 | 27–41 | happy, talking: open smile with teeth, eyes wide and bright, brows up | turned further right, almost profile, chin up a touch |
| **T2** | 42–53 | → | |
| hold 3 | 54–68 | laughing: eyes squeezed shut in arcs, big grin, cheeks up, blush | swung all the way to her *left* and tilted — a ~60° turn |
| **T3** | 69–83 | → | |
| hold 4 | 84–98 | annoyed: half-lidded side-eye, brows down, small closed pout | facing camera, chin down |
| **T4** | 99–112 | → | |
| hold 5 | 113–127 | serious: eyes open and narrowed, brows drawn, flat mouth — a glare | ¾ to her right again, chin down, eyes on the lens |

Holds are 13–15 frames (0.55–0.65 s) and the face is *dead still* in them
(scores 0–1) — a deliberate choice in an expression test, and different from the
body reference, whose holds breathe. Transitions are 12–14 frames (0.5–0.6 s).

## Inside the transitions

Every transition is made of **pulses**: two frames that move, one that doesn't,
again. Read the scores — `75 59 2 34 48 2 39 49 8` — and you're reading
animation on twos with a still between beats. That cadence is a large part of
why it reads as anime rather than as a blend.

**T1, content → talking (13–26).** Head first: 13–14 is the head starting to
turn, face still neutral. Beat. 16–17: brows lift, eyes widen, mouth still
closed. Beat. 19–20: the **mouth opens** into the smile. 21–26 a small settle.
Order: *head → eyes/brows → mouth.*

**T2, talking → laughing (42–53).** The **eyes close first** (42–43) while the
mouth is still the open smile. Then the head swings across — 44 through 48,
peaking at 85, the biggest change in the clip — with the grin widening under
it and the whole head tilting. 49–50 still. 51–53 a settle bounce the other way.
Order: *eyes → head + mouth → bounce.*

**T3, laughing → annoyed (69–83).** The **eyes snap open** into half-lids at
69–70 while the grin is still on the mouth. 71–72 the mouth closes down to a
pout and the brows drop. Beat. 74–76 the head turns to face the camera and
drops. Then a long quiet tail, 77–81, of near-nothing — an eye dart, a
micro-adjust. Order: *eyes → mouth/brows → head → tail.*

**T4, annoyed → glare (99–112).** A **blink cut**: eyes close over 99–100,
stay shut 101–102 while the head starts turning and the expression is swapped
underneath, then open at 103–104 already wearing the glare. What follows is a
six-frame decaying tail (106–111) as the head finishes its turn to ¾ and the
eyes find the lens. Order: *blink → swap → open → head trails out.*

## The rules it keeps

1. **Channels are staggered, never simultaneous.** Eyes move first in three of
   four transitions; brows and mouth follow two to four frames later; the head
   is the slowest layer and either starts first (T1) or starts after the face
   has landed (T2, T3) — but it always *finishes last.*
2. **Pulses on twos.** Two frames of motion, one frame still. The stillness
   between pulses is what makes each one read as a decision.
3. **A blink cuts between opposites.** Annoyed to serious is too small a
   distance to morph well, so she blinks and comes up already changed. Big
   jumps hide under closed lids.
4. **The head carries the emotion as much as the face.** Every hold has its own
   angle — profile for talking, swung away and tilted for laughing, straight on
   and down for the pout, ¾ and lowered for the glare. The face without the
   head turn would read at half strength.
5. **Settle tails outlast the hit.** T2's bounce, T3's dart, T4's six-frame ease
   — the move is over, and then something keeps arriving.

## What this changes here

The face is the app's layer and the body is the .vrma's, so this reference
splits across both.

| in the reference | for this project |
|---|---|
| eyes → brows → mouth, staggered 2–4 frames | **App.** A VRM expression is one weight for the whole face, so staging needs the expression's eyes, brows and mouth as separate blends fired 60–130 ms apart — or, cheaper, keep whole-face expressions and stage only the blink. |
| blink cut between distant expressions | **App.** On an emotion change: drive `blink` to 1 over 2 frames, swap the expression weight under it, release over 2 frames. Costs nothing, hides every crossfade. This is the one to do first. |
| pulses on twos | **App**, for the face: step expression weights in two-frame increments instead of lerping per frame. Not for the body — a 3D body on twos at 30 fps looks broken without motion blur. |
| head finishes last, by 3–8 frames | **clips.py.** Head and neck keys land a few frames after the rest of the pose (`TRAIL`), so every hit's body snaps and the head arrives on top of it. In. |
| each expression has its own head angle | **clips.py** already keys head per hit; the app side should pair each `expressionMood` with a head-turn target as well as a gaze — the gaze layer moves eyes, not the head. Open. |
| holds dead still on the face | **App.** Don't animate the expression during a hold; let the body clip breathe and the eyes blink. Already the case. |
