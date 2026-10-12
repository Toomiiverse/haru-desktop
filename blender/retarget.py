"""Retarget Mixamo FBX motion onto Haruhi's rig and export each result as .vrma.

Run it against the open Blender:

    python blender/bridge.py exec blender/retarget.py

Add a line to SOURCES per animation. Name them after ACTION_SHAPES entries and
they drop straight into clips/ beside the hand-keyed ones, same filenames, same
loader path -- clips.py and this script are two ways to fill the same directory,
and whichever wrote a given .vrma last is the one the app plays.

Mixamo is the source worth using: its rig is humanoid with fixed `mixamorig:`
names and a T-pose rest, which is the same shape Haruhi's VRM humanoid rig is
in, so Rokoko's name matcher pairs them without a hand-built bone list. Download
"without skin" -- the mesh is dead weight here and gets deleted anyway.

The retarget itself is four lines of Rokoko Studio Live (already installed);
everything around them is import, cleanup and export.
"""

import os

import bpy

TARGET = "Armature"
CLIPS_DIR = os.path.join(os.path.dirname(bpy.data.filepath), "clips")
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")

# (clip name written to clips/<name>.vrma, source FBX)
SOURCES = [
    ("wave-hiphop", os.path.join(DOWNLOADS, "Wave Hip Hop Dance.fbx")),
]


def import_fbx(path):
    """Import and hand back only what the FBX added."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    added = [o for o in bpy.data.objects if o not in before]
    armature = next((o for o in added if o.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("no armature in " + os.path.basename(path))
    return armature, added


def retarget(source, target):
    scene = bpy.context.scene
    scene.rsl_retargeting_armature_source = source
    scene.rsl_retargeting_armature_target = target
    scene.rsl_retargeting_auto_scaling = True

    bpy.ops.rsl.build_bone_list()
    paired = [b for b in scene.rsl_retargeting_bone_list if b.bone_name_target]
    if not paired:
        raise RuntimeError("Rokoko matched no bones between the two rigs")

    bpy.ops.rsl.retarget_animation()
    bpy.ops.rsl.clear_bone_list()
    return len(paired)


def frame_span(action):
    start, end = action.frame_range
    return int(round(start)), int(round(end))


def main():
    target = bpy.data.objects[TARGET]
    os.makedirs(CLIPS_DIR, exist_ok=True)
    scene = bpy.context.scene

    for name, path in SOURCES:
        if not os.path.exists(path):
            print("%-14s missing: %s" % (name, path))
            continue

        source, added = import_fbx(path)
        try:
            paired = retarget(source, target)
        finally:
            # The source rig has served its purpose; leaving it in the .blend
            # means the next export has two armatures to choose between.
            for obj in added:
                bpy.data.objects.remove(obj, do_unlink=True)

        action = target.animation_data.action
        action.name = name
        action.use_fake_user = True
        scene.frame_start, scene.frame_end = frame_span(action)

        out = os.path.join(CLIPS_DIR, name + ".vrma")
        result = bpy.ops.export_scene.vrma(filepath=out, armature_object_name=target.name)
        size = os.path.getsize(out) if os.path.exists(out) else 0
        print("%-14s %2d bones  frames %d-%d  %5.2fs  %-9s %7d bytes"
              % (name, paired, scene.frame_start, scene.frame_end,
                 (scene.frame_end - scene.frame_start) / scene.render.fps,
                 "OK" if "FINISHED" in result else str(result), size))

    bpy.ops.wm.save_mainfile()
    print("saved", bpy.data.filepath)


main()
