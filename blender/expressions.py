"""Give Haruhi the faces the app already knows how to ask for.

Run it against the open Blender:

    python blender/bridge.py exec blender/expressions.py

behaviour.ts picks an expression per emotion by matching regexes against
whatever names the model ships. Haruhi ships VRoid's four -- happy, angry, sad,
relaxed -- plus Surprised, so sleepy, smug, bored and embarrassed had no face at
all and curious fell through to Surprised. Each entry below is named so the
existing pattern for that emotion hits it first, which means no app code moves.

Each face is a blend of the VRoid `Fcl_*` shape keys the Face mesh already
carries: brows (BRW), eyes (EYE), mouth (MTH). Weights are 0..1. The script
wipes every custom expression and rebuilds from this table, so this file is the
source and the .blend is just where it was last applied.

Exports a VRM 1.0 next to this file as Haruhi.vrm. The one in
%APPDATA%\\haru-desktop\\vrm-models\\ is untouched; point the app at the new one
when it looks right.
"""

import os

import bpy

FACE = "Face"
OUT = os.path.join(os.path.dirname(bpy.data.filepath), "Haruhi.vrm")

CUSTOM = {
    # Eyes mostly gone, brows soft, mouth small. Blink is blocked so the auto
    # blink can't pop them open mid-doze.
    "sleepy": {"Fcl_EYE_Close": 0.75, "Fcl_BRW_Sorrow": 0.35, "Fcl_MTH_Small": 0.30},
    # Half-lidded and pleased with herself.
    "smug": {"Fcl_EYE_Fun": 0.70, "Fcl_MTH_Fun": 0.60, "Fcl_BRW_Fun": 0.40},
    # Lids heavy, highlights dimmed, mouth flat. The VRoid "dead eyes".
    "bored": {"Fcl_EYE_Close": 0.45, "Fcl_EYE_Highlight_Hide": 0.40, "Fcl_MTH_Neutral": 0.50, "Fcl_BRW_Sorrow": 0.20},
    # No blush morph on a VRoid face -- blush is texture -- so this is all in
    # the brows and the mouth trying to disappear.
    "embarrassed": {"Fcl_EYE_Sorrow": 0.50, "Fcl_BRW_Sorrow": 0.50, "Fcl_MTH_Small": 0.50, "Fcl_MTH_Close": 0.30},
    # Surprised, but only a little: eyes a touch wider, brows up.
    "curious": {"Fcl_EYE_Spread": 0.50, "Fcl_BRW_Surprised": 0.40, "Fcl_MTH_Small": 0.30},
    # Set, not angry: brows down, eyes narrowed, mouth shut.
    "determined": {"Fcl_BRW_Angry": 0.55, "Fcl_EYE_Angry": 0.35, "Fcl_MTH_Close": 0.60},
    # Sad's little sibling, so worried stops resolving to full Sorrow.
    "worried": {"Fcl_BRW_Sorrow": 0.60, "Fcl_EYE_Sorrow": 0.40, "Fcl_MTH_Sorrow": 0.30},
    # Closed happy eyes and a soft smile. Matches /fond/ for affectionate.
    "fond": {"Fcl_EYE_Joy": 0.80, "Fcl_MTH_Fun": 0.50, "Fcl_BRW_Joy": 0.50},
}

# Eyes are shut in these, so the blink layer is told to stay out.
BLINK_BLOCKED = {"sleepy", "fond", "happy"}

# The face layer (src/companion/face.ts) moves a face in three moves -- eyes,
# then brows, then mouth -- if the model ships it in three. So every face above
# is exported whole AND as `<name>.eyes` / `.brows` / `.mouth`, split by which
# region its shape keys touch. The five VRoid presets get the same treatment
# from their own per-region keys.
PART_PREFIX = {"eyes": "Fcl_EYE_", "brows": "Fcl_BRW_", "mouth": "Fcl_MTH_"}
PRESET_KEY = {"happy": "Joy", "angry": "Angry", "sad": "Sorrow", "relaxed": "Fun", "surprised": "Surprised"}


def parts_of(name, blend):
    for part, prefix in PART_PREFIX.items():
        sub = {k: w for k, w in blend.items() if k.startswith(prefix)}
        if sub:
            yield "%s.%s" % (name, part), part, sub


def add_expression(armature, expressions, keys, name, blend, blink, mouth):
    bpy.ops.vrm.add_vrm1_expressions_custom_expression(
        armature_object_name=armature.name, custom_expression_name=name
    )
    expression = expressions.custom[name]
    for key, weight in blend.items():
        if key not in keys:
            raise KeyError("%s: no shape key %s on %s" % (name, key, FACE))
        bpy.ops.vrm.add_vrm1_expression_morph_target_bind(
            armature_object_name=armature.name, expression_name=name
        )
        bind = expression.morph_target_binds[-1]
        bind.node.mesh_object_name = FACE
        bind.index = key
        bind.weight = weight
    expression.override_blink = blink
    expression.override_mouth = mouth


def rebuild(armature):
    expressions = armature.data.vrm_addon_extension.vrm1.expressions
    while expressions.custom:
        bpy.ops.vrm.remove_vrm1_expressions_custom_expression(
            armature_object_name=armature.name,
            custom_expression_name=expressions.custom[0].custom_name,
        )

    keys = {k.name for k in bpy.data.objects[FACE].data.shape_keys.key_blocks}
    faces = dict(CUSTOM)
    for preset, suffix in PRESET_KEY.items():
        faces[preset] = {prefix + suffix: 1.0 for prefix in PART_PREFIX.values()}

    for name, blend in faces.items():
        blink = "block" if name in BLINK_BLOCKED else "none"
        if name in CUSTOM:
            # Emotions sit under speech: visemes fade these mouths rather than
            # stacking on top of them.
            add_expression(armature, expressions, keys, name, blend, blink, "blend")
        for part_name, part, sub in parts_of(name, blend):
            add_expression(armature, expressions, keys, part_name, sub,
                           blink if part == "eyes" else "none",
                           "blend" if part == "mouth" else "none")
    return expressions


def rest_pose(armature):
    """The export bakes whatever pose is showing, so show none."""
    armature.animation_data_clear()
    for bone in armature.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def main():
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    expressions = rebuild(armature)
    print("custom expressions:", [c.custom_name for c in expressions.custom])

    rest_pose(armature)
    # The 0.x -> 1.0 switch carried the expressions and springs across but not
    # the title, and the app greets her by it.
    ext = armature.data.vrm_addon_extension
    if not ext.vrm1.meta.vrm_name:
        ext.vrm1.meta.vrm_name = ext.vrm0.meta.title or "Haruhi"
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.vrm(
        filepath=OUT, armature_object_name=armature.name, ignore_warning=True
    )
    size = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    print("export:", result, OUT, "%.1f MB" % (size / 1048576))
    bpy.ops.wm.save_mainfile()


main()
