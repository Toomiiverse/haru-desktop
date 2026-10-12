# Claude in Blender

`claude_addon.py` adds a **Claude** tab to the 3D viewport sidebar (N). Type a
prompt, hit Ask; the request goes to `claude-fable-5-1` on a background thread
with a summary of the open scene (mode, active object, bones, actions,
selection, frame range) so the script it writes fits what is actually loaded.
The reply lands in a `claude.py` text datablock. Read it, then Run.

## Install (already done on this machine, Blender 5.2)

```bash
# SDK into Blender's user modules dir (no admin, survives Blender updates)
"/c/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe" -m pip install anthropic \
  -t "$APPDATA/Blender Foundation/Blender/5.2/scripts/modules"
```

`claude_addon.py` is hardlinked into `…/Blender/5.2/scripts/addons/`, so editing
it here edits the installed copy. Re-enable the add-on in Preferences (or
restart Blender) to pick up changes.

## The key

Blender launched from the Start menu does not see a shell-session variable, so
set it at user level once, then restart Blender:

```powershell
setx ANTHROPIC_API_KEY "sk-ant-..."
```

## Check

```bash
"/c/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe" blender/test_claude_addon.py
```

---

# bridge.py — driving Blender from outside

The 3D Agent extension you already have installed (`extensions/user_default/
agent_3d`, from the Drexfy app) listens on `127.0.0.1:9875` and speaks
newline-delimited JSON. `bridge.py` is a stdlib-only client for it, so Claude
Code — or you, or a script — can read and change the scene in the Blender window
that is already open. No API key involved; this half is just a socket.

```bash
python blender/bridge.py handshake
python blender/bridge.py get_scene_info
python blender/bridge.py get_object_info '{"name": "Armature"}'
echo 'print([a.name for a in bpy.data.actions])' | python blender/bridge.py exec
python blender/bridge.py exec retarget.py
python blender/bridge.py shot            # viewport PNG, path on the last line
```

Every command in the extension's table works by name: `handshake`,
`get_blender_info`, `get_installed_addons`, `get_scene_info`, `get_scene_graph`,
`get_object_info`, `get_mesh_stats`, `get_viewport_screenshot`,
`get_scene_thumbnail`, `execute_code`, `save_mainfile`, `save_as_mainfile`,
`revert_mainfile`, `plugin_call`. Exit status is 1 on an error envelope, so it
composes in a shell. `shot` needs a real 3D viewport, so Blender must be open
with its UI — headless has no screen to capture.

Two things to know. The contract belongs to a third-party product, so a 3D Agent
update can change it under you; `handshake` reports `protocol`, currently
`1.0.0`. And `exec` runs whatever you send on Blender's main thread with no
sandbox and no undo push — `save_mainfile` first when the scene matters.

## Check

Open Blender, then:

```bash
python blender/bridge.py handshake
```

---

# haruhi.blend — the clip project

`blender/haruhi.blend` (gitignored; the clips beside it are not) is Haruhi.vrm
imported from `%APPDATA%\haru-desktop\vrm-models\586a41f2a5392895\`, set up to
export **.vrma** at 30fps. Two scripts fill `clips/` from it: `clips.py`
hand-keys the idles from pose tables, `retarget.py` brings real motion in off a
Mixamo FBX. Neither needs the .blend open in front of you — both run through
`bridge.py`.

## Why .vrma and not .glb

c3ad4e8 established that a .glb of Blender animation cannot drive the VRM: its
tracks name Blender's bones, and nothing by those names exists on the loaded
model, so the clip plays perfectly and moves nothing. A .vrma names *humanoid*
bones (`hips`, `spine`, `leftUpperArm`), and `createVRMAnimationClip` retargets
those onto the normalized rig at load. Same authored motion, addressable.

## Getting a rig that can export one

VRM Animation is a VRM 1.0 format and the exporter refuses a 0.x armature
outright — Haruhi is 0.x, so the .blend converts hers on import:

```python
ext = armature.data.vrm_addon_extension
ext.spec_version = "1.0"
bpy.ops.vrm.assign_vrm1_humanoid_human_bones_automatically(armature_object_name=armature.name)
```

That touches only the .blend; the .vrm on disk is untouched, and the runtime
model stays 0.x. 54 humanoid bones map straight across from the VRoid `J_Bip_*`
naming, and her rest pose is already a true T-pose.

## The clips

`clips.py` is the source of every .vrma in `clips/`, so the animation lives in a
text file rather than only inside the .blend. Rebuild them all with:

```bash
python blender/bridge.py exec blender/clips.py
```

The nine idles are there — `glance`, `tilt`, `fidget`, `yawn`, `sigh`, `settle`,
`doze`, `stretch`, `think` — each running exactly the `durationMs` its
`ACTION_SHAPES` entry already asks for. The other four entries (`blink`,
`smile`, `sparkle`, `lean-in`) get no clip on purpose: the source marks them as
reading on the face rather than in the eyes, and the face is the expression
layer's.

Poses are written in armature-space degrees and converted into each bone's own
rest frame, which is what makes the numbers legible — with her facing -Y, `+X`
leans forward, `+Y` tilts toward her left, `+Z` turns toward her right, and on
the arms `+Y` lowers the left one and `-Z` swings it forward. Every clip opens
and closes on the same `BASE` pose so it loops and crossfades without a pop.

### Timing: the Zenless idiom

The model comes from [reference.md](reference.md), the frame-by-frame read of
the clip you sent. A clip is a list of **hits** — `(frame, pose, attack[,
accent])` — not a spread of keyframes. For each hit the builder emits:

- a **lead** — eight frames drifting 15% toward the pose. In the reference the
  face moves first and the body waits; the drift is the body's half of that,
  the face's half is the app's (fire the expression 200–300 ms before the hit);
- a **front-loaded attack** — 75% of the travel in the first third of it,
  landing 12% past the pose. Biggest change on frame one, then decay;
- **two damped bounces** onto the pose: −4%, +1.5%, home, over eight frames;
- an optional **accent** four frames later — a smaller move in a *different*
  direction (the reference's fist-pump-and-head-flip) with its own bounce;
- a **moving hold** that breathes until the next lead; long holds get two.

Head and neck keys land a few frames after the rest of the pose (`TRAIL`), so
the body snaps and the head arrives on top of it — the second reference,
[reference-faces.md](reference-faces.md), has the head finishing last in every
transition. Attacks stay a fixed few frames whatever the clip's length; only
holds stretch to fill the `durationMs`. Anything with an attack over 10 is a drift and gets
none of the snap machinery — `doze` nods that way until the jolt awake, which
snaps in 3. Keys are generated in order and any that would land on or before
the previous one are dropped, which is how overlapping leads and tails resolve.

Fragments: `HANDS_CHEST` (fists knuckle to knuckle at the sternum), `HANDS_CHIN`
(the same, pulled up tight), `FISTS_WAIST` (elbows back, two fists at the hips),
`HUNCH`, `SHRUG`. `FISTS` keys all thirty finger bones — the reference's hands
are fists, not palms, and VRoid's rest hand is open. `think` is the reference
beat for beat: clasp, dip, lift, the big drop-to-fists with the accent, home.

Still hand-keyed, so still the fallback. **Retargeting real motion in**, below,
is how a clip gets replaced by a performance; the timing model here is what
keeps the fallback from reading as floaty in the meantime.

Three things that bite. **A .vrma carries no clip name** — three-vrm calls it
`Clip` regardless, so identity has to come from the filename; one file per
action. **A clip only drives the bones it contains**: every humanoid bone left
unkeyed sits at the normalized rest T-pose, arms straight out, which is why
`BASE` keys the whole upper body and not just what moves. And **body only** —
gaze and expressions are layers the app drives per frame, so a clip that
animates them fights them.

## Sit her on the desktop

The whole pipeline, live: the 1.0 model with its faces, every .vrma in
`clips/` cycling at its own length under crossfades, the face layer changing
her mind every couple of seconds, docked bottom-right where the companion
lives. Escape closes her (she has no frame and no taskbar entry).

```bash
SPIKE_DOCK=1 SPIKE_FPS=30 SPIKE_VRM="$(pwd -W)/blender/Haruhi.vrm" SPIKE_CLIP="$(pwd -W)/blender/clips" ./node_modules/.bin/electron spike/vrm/main.cjs
```

`SPIKE_CLIP` takes one file, several joined with `|`, or a folder. `?face=name`
and `?action=name` still pin one of each.

## Check

```bash
SPIKE_CLIP="$(pwd -W)/blender/clips/stretch.vrma" ./node_modules/.bin/electron spike/vrm/main.cjs
```

Electron buffers stdout, so the report lands when the window closes. What
proves it worked:

```
[spike] loaded from file: Clip (35 tracks)
[spike] right upper arm moved: raw 34.3deg, normalized 34.3deg
```

`0 tracks`, or an arm that moved `0deg`, means the clip bound to nothing.
`stretch` is the one to test with — it has the most arm travel, so a binding
failure shows up as a number instead of a judgement call.

## Retargeting real motion in

`retarget.py` takes a Mixamo FBX, puts its motion on Haruhi through Rokoko
Studio Live's retargeter, and exports the result as a .vrma. Add a line to
`SOURCES` per animation and run:

```bash
python blender/bridge.py exec blender/retarget.py
```

Mixamo is the source worth using: fixed `mixamorig:` bone names and a T-pose
rest, which is the same shape the VRM humanoid rig is in, so Rokoko's name
matcher pairs them with no hand-built bone list — 52 of Haruhi's bones on the
first try, including legs and hips the hand-keyed clips never touch. Download
"without skin"; the mesh is deleted after the retarget either way.

Name a clip after an `ACTION_SHAPES` entry and it lands in `clips/` beside the
hand-keyed ones, same filename, same loader path — `clips.py` and `retarget.py`
are two ways to fill the same directory and whichever ran last wins. Mixamo's
idles are the ones to grab: *Breathing Idle*, *Standing Idle*, *Yawn*,
*Stretching*, *Thinking*, *Looking Around*.

Two things to watch when picking animations. **Take the in-place variants** —
anything with root motion walks her out of a 420px window. And **Mixamo clips
do not start and end on the same pose** the way `clips.py` guarantees, so a clip
that isn't authored to loop will pop on repeat; Mixamo's looping idles are fine,
one-shots need their ends trimmed to match.

Proof it works, from `wave-hiphop.vrma` (retargeted from the Mixamo dance in
Downloads, kept only as a test artifact — it is not an `ACTION_SHAPES` name):

```
wave-hiphop    52 bones  frames 1-480  15.97s  OK   548416 bytes
[spike] loaded from file: Clip (53 tracks)
[spike] right upper arm moved: raw 122.3deg, normalized 122.3deg
```

53 tracks against the hand-keyed clips' 35, and 122 degrees of arm travel where
`stretch` managed 34.

---

# expressions.py — the faces

`behaviour.ts` already knows how to pick a face per emotion: it matches regexes
against whatever expression names the model ships. Haruhi shipped VRoid's four
plus `Surprised`, so `sleepy`, `smug`, `bored` and `embarrassed` resolved to
nothing and `curious` fell through to full Surprised. `expressions.py` adds
eight custom VRM 1.0 expressions, each named so the existing pattern for its
emotion hits it first — no app code moves:

| emotion | expression | built from |
|---|---|---|
| sleepy | `sleepy` | eyes ¾ shut, soft brows, small mouth — blink blocked |
| smug | `smug` | half-lidded, pleased mouth |
| bored | `bored` | heavy lids, highlights dimmed, flat mouth |
| embarrassed | `embarrassed` | sorrow eyes and brows, mouth shrinking |
| curious | `curious` | eyes a touch wider, brows up — Surprised's little sibling |
| determined | `determined` | brows down, eyes narrowed, mouth shut |
| worried | `worried` | Sorrow at half strength |
| affectionate | `fond` | closed happy eyes, soft smile — blink blocked |

Each is a weighted blend of the `Fcl_*` shape keys the Face mesh already has;
the table in the script is the source, the .blend is where it was last applied.
Rebuild and re-export with:

```bash
python blender/bridge.py exec blender/expressions.py
```

That writes `blender/Haruhi.vrm` (gitignored), a **VRM 1.0** export of the
converted rig. The 0.x file the app loads from `%APPDATA%\haru-desktop\
vrm-models\` is untouched — try the new one with `SPIKE_VRM` first, then point
the app at it when it looks right. three-vrm handles 1.0 with no change on the
loader side; the spike reports `spec 1` and lists all eight.

### In three moves

Every face — the eight above and the five VRoid presets — is also exported as
`<name>.eyes`, `<name>.brows`, `<name>.mouth`, split by which region its shape
keys touch (39 parts on Haruhi). That is for `src/companion/face.ts`, the face
layer written off [reference-faces.md](reference-faces.md): a change of
expression there is not a crossfade but eyes, then brows two frames later, then
mouth, each moving in two-frame pulses; between two real faces she blinks and
the swap happens under the lids; the head turn rides on top and finishes last.
`face.ts` asks the model whether the parts exist and falls back to the whole
face if not, so a model without them still works, just flatter.
`behaviour.ts` never selects a part — `PART` filters them out — so the emotion
regexes keep matching the whole names. The spike imports a built copy:

```bash
npm run build:face      # -> spike/vrm/gen/face.js (gitignored)
```

Things to know. Emotion mouths are set to `overrideMouth: blend`, so visemes
fade the expression's mouth rather than stacking on it, and the closed-eye
faces (and their `.eyes` parts) block the blink layer. There is no blush: VRoid does it in the texture,
not a morph, so `embarrassed` is all brows and mouth. And `annoyed` gets no
custom face on purpose — its pattern matches the preset `angry` first and
`find` takes the first hit, so a milder custom would never be reached without
an app-side change.

One number that looks like a regression and isn't: the spike reports 48 spring
joints on the 1.0 file against 73 on the 0.x one. The .blend carries all 73
chain bones across (25 springs, every root migrated), so that's three-vrm
counting 1.0 joints differently, not physics gone missing — but it's a still
frame that says so, so watch her hair move on the 1.0 file before it replaces
the 0.x one.

---

# anby.blend — the ZZZ rig as a desktop model

`anby_to_vrm.py` turns the Anby fan rig (`RIG - Anby_SoldierZero_1.0.blend`,
Downloads) into `blender/Anby.vrm`. It works on `blender/anby.blend`, a copy —
the original is never opened for writing.

```bash
python blender/bridge.py exec blender/anby_to_vrm.py     # with anby.blend open
python blender/bridge.py exec blender/clips.py           # the nine idles on her rig -> clips-anby/
```

What it does, in order: drops the 316 widget, weapon and helper objects and the
444 control bones (everything that doesn't deform); hangs the thighs under the
hips and re-hangs the 100-odd deform bones that used to hang off control bones
— cloth on the torso, everything on the head to the head, hand parts to the
hand, never on an arm, which is how the cloak ends up flapping sideways;
names the 52 humanoid bones by hand (the add-on's guesser mapped skirts as
arms in a rig this size); tells the exporter to stand her in a T-pose from her
A-pose rest; rebuilds each material as its `_D` diffuse on a Principled BSDF;
drops the FaceShadow shell (a game-shader gradient that renders as a grey mask
without its shader); and builds the presets, the eight faces and their
`.eyes`/`.mouth` parts from her 31 `Fac_*` keys — no `.brows`, her brows are
bone-driven, and `face.ts` falls back on its own.

The .vrma clips are humanoid-generic, so Haruhi's `clips/` drive her unchanged
(`right upper arm moved: 105.7deg` on the first run). `clips-anby/` is the same
motion exported off her own rig, kept apart so a rest-pose difference can never
overwrite the canonical set.

```bash
SPIKE_DOCK=1 SPIKE_FPS=30 SPIKE_VRM="$(pwd -W)/blender/Anby.vrm" SPIKE_CLIP="$(pwd -W)/blender/clips" ./node_modules/.bin/electron spike/vrm/main.cjs
```

Not done yet: her materials export as PBR, not MToon (the converter ran but the
exporter didn't keep it), so she's lit rather than cel-shaded; no spring bones,
so hair and cloak don't swing; no eye bones mapped, so look-at is off.
