"""Build the idle clips on the imported VRM and export each as a .vrma.

Run it against the open Blender:

    python blender/bridge.py exec blender/clips.py

Poses are written in ARMATURE-space degrees about X, Y, Z and converted into each
bone's local frame through its rest orientation, so the numbers below read the
same for every bone instead of depending on how VRoid happened to roll it.
With the model facing -Y:

    +X rotation  lean forward       +Y rotation  tilt toward her left
    +Z rotation  turn to her right  arms: +Y lowers the left, -Y the right
    arms: -Z swings the left forward, +Z the right; on a forearm that's the elbow
    fingers: +Y curls the left hand closed, -Y the right

Timing follows the reference frame by frame (see reference.md). A clip is a
list of HITS she snaps into. For each: a LEAD -- eight frames drifting a
little toward the pose while, in the app, the face does the telling; an ATTACK
that is front-loaded, most of the travel in its first third, landing past the
pose; two damped BOUNCES onto it; an optional ACCENT four frames later, a
smaller move in a different direction, with its own bounce; then a MOVING HOLD
that breathes until the next lead. Attacks are a fixed few frames whatever the
clip's length -- only holds stretch. A hit with attack over 10 is a drift and
gets none of the snap machinery, which is what `doze` wants right up to the
jolt. Every clip opens and closes on BASE so it loops and crossfades without a
pop, and every clip keys the whole upper body down to the fingers: a humanoid
bone a .vrma does not mention sits at the normalized rest T-pose.
"""

import math
import os

import bpy
from mathutils import Euler, Quaternion, Vector

FPS = 30
# Haruhi's clips are the canonical set in clips/. Run against another model's
# .blend and the export lands beside it under its own name, so a rig whose
# rest pose differs can't quietly overwrite the set the desktop plays.
_stem = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
CLIPS_DIR = os.path.join(os.path.dirname(bpy.data.filepath), "clips" if _stem == "haruhi" else "clips-" + _stem)

LEAD, LEAD_FRAMES = 0.15, 8          # drift toward the pose before the attack
FRONT = 0.75                          # of the travel done by a third of the attack
OVERSHOOT = 0.12
BOUNCES = ((3, -0.04), (6, 0.015), (8, 0.0))   # frames after the hit, past-target
ACCENT_OVER = 0.08
TRAIL = {"head": 3, "neck": 2}   # frames these land after the body; the head finishes last

FINGERS = ("Index", "Middle", "Ring", "Little")
PARTS = ("Proximal", "Intermediate", "Distal")

# Arms down at her sides, elbows softened, a breath of forward lean, hands open.
# Every pose below is a deviation from this one.
BASE = {
    "spine": (2, 0, 0),
    "chest": (1, 0, 0),
    "upperChest": (1, 0, 0),
    "neck": (1, 0, 0),
    "head": (1, 0, 0),
    "leftShoulder": (0, 5, 0),
    "rightShoulder": (0, -5, 0),
    "leftUpperArm": (0, 72, 4),
    "rightUpperArm": (0, -72, -4),
    "leftLowerArm": (0, 4, -14),
    "rightLowerArm": (0, -4, 14),
    "leftHand": (0, 0, -4),
    "rightHand": (0, 0, 4),
}
for _side in ("left", "right"):
    for _finger in FINGERS + ("Thumb",):
        for _part in (("Metacarpal", "Proximal", "Distal") if _finger == "Thumb" else PARTS):
            BASE[_side + _finger + _part] = (0, 0, 0)


def fist(side):
    s = 1 if side == "left" else -1
    pose = {}
    for finger in FINGERS:
        for part, deg in zip(PARTS, (75, 85, 55)):
            pose[side + finger + part] = (0, s * deg, 0)
    # The thumb rests pointing forward-and-out. Swing it in along the fingers
    # first (about Z), then curl it like one (about Y), and it tucks over the
    # fist instead of hitching a ride. One composed rotation for the base,
    # written as the same XYZ degrees every other pose uses so mix() can lerp.
    base = Quaternion((0, 1, 0), math.radians(s * 95)) @ Quaternion((0, 0, 1), math.radians(s * 55))
    pose[side + "ThumbMetacarpal"] = tuple(math.degrees(a) for a in base.to_euler("XYZ"))
    pose[side + "ThumbProximal"] = (0, s * 60, 0)
    pose[side + "ThumbDistal"] = (0, s * 40, 0)
    return pose


FISTS = {**fist("left"), **fist("right")}

# Reusable fragments. Later ones win where they overlap.
HANDS_CHEST = {  # fists knuckle to knuckle in front of the sternum, elbows in
    **FISTS,
    "leftShoulder": (0, 6, -8), "rightShoulder": (0, -6, 8),
    "leftUpperArm": (0, 63, -38), "rightUpperArm": (0, -63, 38),
    "leftLowerArm": (0, 0, -105), "rightLowerArm": (0, 0, 105),
    "leftHand": (0, -20, -25), "rightHand": (0, 20, 25),
}
HANDS_CHIN = {  # the same, pulled up tight under the chin
    **HANDS_CHEST,
    "leftShoulder": (0, 4, -12), "rightShoulder": (0, -4, 12),
    "leftUpperArm": (0, 57, -44), "rightUpperArm": (0, -57, 44),
    "leftLowerArm": (0, 0, -120), "rightLowerArm": (0, 0, 120),
}
FISTS_WAIST = {  # elbows tucked back at her sides, forearms forward, fists at the hips
    **FISTS,
    "leftShoulder": (0, 6, 2), "rightShoulder": (0, -6, -2),
    "leftUpperArm": (0, 78, 2), "rightUpperArm": (0, -78, -2),
    "leftLowerArm": (0, 0, -100), "rightLowerArm": (0, 0, 100),
    "leftHand": (0, 0, -12), "rightHand": (0, 0, 12),
}
HUNCH = {"spine": (9, 0, 0), "chest": (7, 0, 0), "upperChest": (3, 0, 0), "neck": (-4, 0, 0)}
SHRUG = {"leftShoulder": (0, -9, -3), "rightShoulder": (0, 9, 3), "leftUpperArm": (0, 66, 2), "rightUpperArm": (0, -66, -2)}

# name -> (durationMs from ACTION_SHAPES, [hit, ...])
# hit = (frame, pose over BASE, attack frames[, accent over the pose])
# attack 3-8 is a snap, over 10 a drift. Pose {} is the return to BASE.
CLIPS = {
    # Head whips to the side, body leans the other way, hold, whip back.
    "glance": (2200, [
        (7, {"head": (2, -7, -30), "neck": (0, -2, -11), "chest": (1, 4, -7), "spine": (2, 2, -2)}, 4),
        (50, {}, 5),
    ]),
    # Head over hard, that shoulder up to meet it, a beat, then back.
    "tilt": (2400, [
        (9, {"head": (0, 24, -8), "neck": (0, 9, -3), "leftShoulder": (0, -8, 0), "leftUpperArm": (0, 64, 4)}, 5),
        (58, {}, 6),
    ]),
    # Fists come together, a twitch to one side, drop.
    "fidget": (1600, [
        (6, {**HANDS_CHEST, "spine": (4, 2, 0), "head": (2, 3, -6)}, 4),
        (26, {**HANDS_CHEST, "spine": (4, -3, 4), "head": (2, -4, 8), "chest": (2, -2, 3)}, 4),
        (42, {}, 5),
    ]),
    # A dip, then the head snaps back with the hand at her mouth; the drop
    # afterwards is heavier than the start.
    "yawn": (2600, [
        (8, {"head": (10, 0, 0), "neck": (4, 0, 0)}, 6),
        (20, {"head": (-24, 0, 0), "neck": (-9, 0, 0), "chest": (-5, 0, 0),
              "rightShoulder": (0, -12, 8), "rightUpperArm": (0, -30, 62), "rightLowerArm": (0, 0, 138), "rightHand": (0, 25, 20),
              "leftShoulder": (0, 9, 0)}, 5),
        (58, {"head": (12, 0, 0), "neck": (5, 0, 0), "spine": (5, 0, 0), "chest": (3, 0, 0),
              "leftShoulder": (0, 3, 0), "rightShoulder": (0, -3, 0)}, 7),
        (72, {}, 6),
    ]),
    # Shoulders up, then everything lets go at once.
    "sigh": (2000, [
        (8, {**SHRUG, "chest": (-4, 0, 0), "upperChest": (-2, 0, 0), "head": (-5, 0, 0)}, 5),
        (26, {"chest": (5, 0, 0), "upperChest": (2, 0, 0), "spine": (4, 0, 0), "head": (9, 0, 0), "neck": (4, 0, 0),
              "leftShoulder": (0, 3, 0), "rightShoulder": (0, -3, 0)}, 3),
        (50, {}, 6),
    ]),
    # Sinks into herself and stays there a while.
    "settle": (3000, [
        (10, {**HUNCH, "head": (6, 0, -3), "leftShoulder": (0, 5, -5), "rightShoulder": (0, -5, 5)}, 6),
        (76, {}, 7),
    ]),
    # Two long nods that drift, then the jolt awake, which does not.
    "doze": (6000, [
        (40, {"head": (18, 3, 0), "neck": (8, 1, 0), "spine": (4, 1, 0), "chest": (2, 0, 0)}, 22),
        (95, {"head": (26, 5, 2), "neck": (11, 2, 0), "spine": (6, 1, 0), "chest": (3, 0, 0)}, 28),
        (142, {"head": (-8, -2, 0), "neck": (-3, 0, 0), "chest": (-3, 0, 0), "leftShoulder": (0, -4, 0), "rightShoulder": (0, 4, 0)}, 3),
        (166, {}, 6),
    ]),
    # Arms over her head with a proper overshoot, chest open, then let it fall.
    "stretch": (2400, [
        (12, {"leftUpperArm": (0, -22, 14), "rightUpperArm": (0, 22, -14),
              "leftLowerArm": (0, 0, -12), "rightLowerArm": (0, 0, 12),
              "leftShoulder": (0, -12, 0), "rightShoulder": (0, 12, 0),
              "chest": (-9, 0, 0), "upperChest": (-4, 0, 0), "spine": (-3, 0, 0),
              "head": (-13, 0, 0), "neck": (-5, 0, 0)}, 6),
        (48, {**HUNCH, "head": (5, 0, 0), "leftShoulder": (0, 4, 0), "rightShoulder": (0, -4, 0)}, 4),
        (64, {}, 6),
    ]),
    # The reference, beat for beat: fists to the chest with the head cocked
    # left; the dip -- head down and further over, fists up under the chin,
    # hunch deeper; the lift; then the big one -- fists drop to the waist as
    # the torso and head come up, with the pump-and-flip accent -- and home.
    "think": (3000, [
        (8, {**HANDS_CHEST, **HUNCH, "head": (-2, 14, 10), "spine": (10, -2, 0), "chest": (8, 0, 0)}, 5),
        (28, {**HANDS_CHIN, "spine": (13, -2, 0), "chest": (9, 0, 0), "upperChest": (4, 0, 0),
              "neck": (2, 4, 0), "head": (14, 22, 6)}, 5),
        (46, {**HANDS_CHIN, "spine": (10, -1, 0), "chest": (7, 0, 0), "upperChest": (3, 0, 0),
              "neck": (-4, 2, 0), "head": (-6, 11, 4)}, 5),
        (60, {**FISTS_WAIST, "spine": (-3, 0, 0), "chest": (-4, 0, 0), "upperChest": (-2, 0, 0),
              "neck": (-3, 0, 0), "head": (-8, -5, -6)}, 7,
         {"leftUpperArm": (0, 64, -6), "rightUpperArm": (0, -64, 6),
          "leftLowerArm": (0, 0, -122), "rightLowerArm": (0, 0, 122),
          "leftShoulder": (0, 2, 0), "rightShoulder": (0, -2, 0),
          "head": (-5, -16, -10), "neck": (-2, -5, -2), "chest": (-6, 0, 0)}),
        (82, {}, 5),
    ]),
}


def full(pose):
    merged = dict(BASE)
    merged.update(pose)
    return merged


def mix(a, b, k):
    """Pose between a and b; k past 1 overshoots, below 0 goes the other way."""
    return {n: tuple(a[n][i] + (b[n][i] - a[n][i]) * k for i in range(3)) for n in a}


def breath(pose, k):
    lifted = dict(pose)
    for bone, lift in (("chest", 1.2), ("head", 1.6), ("neck", 0.6)):
        x, y, z = lifted[bone]
        lifted[bone] = (x - lift * k, y, z)
    return lifted


def beats(hits, last):
    """The keys that make hits read as hits. Returns [(frame, full pose)],
    strictly increasing in frame: a key that would land on or before the
    previous one is dropped, which is how overlapping leads and tails resolve."""
    keys, cursor = [], 0

    def put(frame, pose):
        nonlocal cursor
        frame = int(round(frame))
        if frame > cursor:
            keys.append((frame, pose))
            cursor = frame

    here = full({})
    put(1, here)
    for i, hit in enumerate(hits):
        frame, pose, attack = hit[:3]
        accent = hit[3] if len(hit) > 3 else None
        target = full(pose)
        snap = attack <= 10
        start = frame - attack

        put(start - LEAD_FRAMES, here)
        put(start, mix(here, target, LEAD))
        if snap:
            put(start + max(1, attack // 3), mix(here, target, FRONT))
        put(frame, mix(here, target, 1 + OVERSHOOT if snap else 1.0))
        rest = frame
        if snap:
            for after, past in BOUNCES:
                put(frame + after, mix(here, target, 1 + past))
                rest = frame + after
        if accent:
            acc = dict(target)
            acc.update(accent)
            at = rest + 4
            put(at, mix(target, acc, 1 + ACCENT_OVER))
            put(at + 3, mix(target, acc, -0.05))
            put(at + 5, mix(target, acc, 0.02))
            put(at + 8, target)
            rest = at + 8

        if i + 1 < len(hits):
            hold_end = hits[i + 1][0] - hits[i + 1][2] - LEAD_FRAMES
        else:
            hold_end = last
        span = hold_end - rest
        if span > 12:
            put(rest + span // 3, breath(target, 1.0))
            if span > 30:
                put(rest + 2 * span // 3, breath(target, 0.5))
            put(hold_end, target)
        here = target
    put(last, full({}))
    return keys


def humanoid_bones(armature):
    human_bones = armature.data.vrm_addon_extension.vrm1.humanoid.human_bones
    return {name.value: bone.node.bone_name
            for name, bone in human_bones.human_bone_name_to_human_bone().items()
            if bone.node.bone_name}


def local_rotation(armature, bone_name, degrees):
    """An armature-space XYZ rotation expressed in one bone's own rest frame."""
    rest = armature.data.bones[bone_name].matrix_local.to_quaternion()
    world = Euler([math.radians(d) for d in degrees], "XYZ").to_quaternion()
    return rest.inverted() @ world @ rest


def build(armature, bones, name, duration_ms, hits):
    last = 1 + round(duration_ms / 1000 * FPS)
    armature.animation_data_clear()

    keys = beats(hits, last)
    for frame, pose in keys:
        for humanoid_name, degrees in pose.items():
            bone_name = bones.get(humanoid_name)
            if not bone_name:
                continue
            lag = TRAIL.get(humanoid_name, 0)
            at = frame + lag if 1 < frame < last - lag else frame
            pose_bone = armature.pose.bones[bone_name]
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.rotation_quaternion = local_rotation(armature, bone_name, degrees)
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=at)

    action = armature.animation_data.action
    action.name = name
    action.use_fake_user = True
    return action, last, len(keys)


def main():
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bones = humanoid_bones(armature)
    missing = sorted(n for n in BASE if n not in bones)
    if missing:
        print("no bone for:", missing)
    os.makedirs(CLIPS_DIR, exist_ok=True)

    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0

    for name in CLIPS:
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)

    for name, (duration_ms, hits) in CLIPS.items():
        _action, last, nkeys = build(armature, bones, name, duration_ms, hits)
        scene.frame_start, scene.frame_end = 1, last
        out = os.path.join(CLIPS_DIR, name + ".vrma")
        result = bpy.ops.export_scene.vrma(filepath=out, armature_object_name=armature.name)
        size = os.path.getsize(out) if os.path.exists(out) else 0
        print("%-8s %4d frames %5.2fs  %d hits %2d keys  %-9s %7d bytes"
              % (name, last, (last - 1) / FPS, len(hits), nkeys,
                 "OK" if "FINISHED" in result else str(result), size))

    scene.frame_start, scene.frame_end = 1, 1 + round(CLIPS["think"][0] / 1000 * FPS)
    scene.frame_set(1)
    bpy.ops.wm.save_mainfile()
    print("saved", bpy.data.filepath)


main()
