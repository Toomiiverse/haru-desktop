"""Turn the Anby fan rig into a VRM she can wear on the desktop.

Run it against anby.blend open in Blender (a copy of RIG - Anby_SoldierZero_1.0
from Downloads; the original is never touched):

    python blender/bridge.py exec blender/anby_to_vrm.py

The rig is a 1050-bone control rig. Only its 606 DEF- bones deform anything,
and those already form a proper chain -- spine to shoulder to arm to fingers,
neck to head, thigh to foot -- so the conversion is mostly subtraction: drop
every control bone, hang the thighs under the hips, name the humanoid bones by
hand (the add-on's guesser gets lost in a rig this size and maps skirts as
arms), and let the exporter estimate a T-pose from her A-pose rest.

Materials are game-shader node trees (MatCap, LUT, lightmaps) that no exporter
reads; each gets rebuilt as its diffuse map on a Principled BSDF and converted
to MToon. Expressions come from the 31 Fac_* shape keys on the face, named
so the app's emotion patterns find them, and split into .eyes/.mouth parts for
the face layer (no brow keys: her brows are bone-driven, so .brows is absent
and face.ts falls back on its own).
"""

import os

import bpy
import bmesh

OUT = os.path.join(os.path.dirname(bpy.data.filepath), "Anby.vrm")
KEEP_MESHES = {"SilverAnby_Body", "SilverAnby_Face", "SilverAnby_Hair", "SilverAnby_Legs"}
FACE = "SilverAnby_Face"

HUMANOID = {
    "hips": "DEF-Spine01", "spine": "DEF-Spine02", "chest": "DEF-Spine03", "upperChest": "DEF-Spine04",
    "neck": "DEF-Neck", "head": "DEF-Head",
    "leftShoulder": "DEF-Shoulder.L", "leftUpperArm": "DEF-Upperarm01.L", "leftLowerArm": "DEF-Forearm01.L", "leftHand": "DEF-Hand.L",
    "rightShoulder": "DEF-Shoulder.R", "rightUpperArm": "DEF-Upperarm01.R", "rightLowerArm": "DEF-Forearm01.R", "rightHand": "DEF-Hand.R",
    "leftUpperLeg": "DEF-Thigh01.L", "leftLowerLeg": "DEF-Calf01.L", "leftFoot": "DEF-Foot.L", "leftToes": "DEF-Toe.L",
    "rightUpperLeg": "DEF-Thigh01.R", "rightLowerLeg": "DEF-Calf01.R", "rightFoot": "DEF-Foot.R", "rightToes": "DEF-Toe.R",
}
# Finger0 is the thumb; VRM's thumb has a metacarpal where the others have a proximal.
FINGERS = {"Thumb": ("0", "01", "02"), "Index": ("1", "11", "12"), "Middle": ("2", "21", "22"), "Ring": ("3", "31", "32"), "Little": ("4", "41", "42")}
for _side, _s in (("left", "L"), ("right", "R")):
    for _finger, _ids in FINGERS.items():
        _parts = ("Metacarpal", "Proximal", "Distal") if _finger == "Thumb" else ("Proximal", "Intermediate", "Distal")
        for _part, _id in zip(_parts, _ids):
            HUMANOID[_side + _finger + _part] = "DEF-Finger%s.%s" % (_id, _s)

# VRM presets and the app's faces, from what her face actually ships.
EXPRESSIONS = {
    "blink": {"Fac_Eye_Close": 1.0}, "blinkLeft": {"Fac_Eye_L_Wink": 1.0}, "blinkRight": {"Fac_Eye_R_Wink": 1.0},
    "aa": {"Fac_Mth_Aa1": 1.0}, "ih": {"Fac_Mth_Ii": 1.0}, "ee": {"Fac_Mth_Ee": 1.0}, "ou": {"Fac_Mth_Uu": 1.0}, "oh": {"Fac_Mth_Oo": 1.0},
    "happy": {"Fac_Eye_HalfClose": 0.6, "Fac_Mth_Laugh2": 0.9},
    "angry": {"Fac_Eye_Angry": 1.0, "Fac_Mth_Down": 0.5},
    "sad": {"Fac_Eye_Sad": 1.0, "Fac_Mth_Down": 0.6},
    "relaxed": {"Fac_Eye_HalfClose": 0.5, "Fac_Mth_Up": 0.5},
    "surprised": {"Fac_Eye_L_Open": 1.0, "Fac_Eye_R_Open": 1.0, "Fac_Mth_Oo": 0.7},
    "sleepy": {"Fac_Eye_HalfClose": 0.85, "Fac_Eye_LowlidUp": 0.4, "Fac_Mth_Down": 0.2},
    "smug": {"Fac_Eye_HalfClose": 0.6, "Fac_Mth_L_Up": 0.8, "Fac_Mth_R_In": 0.3},
    "bored": {"Fac_Eye_HalfClose": 0.5, "Fac_Eye_MidUp": 0.3, "Fac_Mth_Down": 0.4},
    "embarrassed": {"Fac_Eye_Sad": 0.5, "Fac_Mth_L_In": 0.5, "Fac_Mth_R_In": 0.5, "Fac_Mth_Down": 0.2},
    "curious": {"Fac_Eye_L_Open": 0.5, "Fac_Eye_R_Open": 0.5, "Fac_Mth_Up": 0.3},
    "determined": {"Fac_Eye_Angry": 0.6, "Fac_Eye_HalfClose": 0.2, "Fac_Mth_Down": 0.3},
    "worried": {"Fac_Eye_Sad": 0.6, "Fac_Mth_Down": 0.3, "Fac_Mth_L_In": 0.2},
    "fond": {"Fac_Eye_Close": 0.55, "Fac_Eye_HalfClose": 0.3, "Fac_Mth_Up": 0.6},
}
PRESETS = {"blink", "blinkLeft", "blinkRight", "aa", "ih", "ee", "ou", "oh", "happy", "angry", "sad", "relaxed", "surprised", "neutral"}
BLINK_BLOCKED = {"sleepy", "fond"}
PART_PREFIX = {"eyes": "Fac_Eye_", "mouth": "Fac_Mth_"}


def rig_object():
    return next(o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith("RIG"))


def strip_scene(rig):
    doomed = [o for o in bpy.data.objects if o is not rig and o.name not in KEEP_MESHES]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    print("removed %d objects (widgets, weapons, helpers)" % len(doomed))


def strip_rig(rig):
    rig.animation_data_clear()
    rig.data.animation_data_clear()
    for pb in rig.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.custom_shape = None
    bpy.context.view_layer.objects.active = rig
    rig.hide_set(False)
    rig.hide_viewport = False
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    # Keep what the meshes are weighted to -- every deforming bone, DEF- or
    # not (hair strands and tweak bones deform without the prefix).
    control = [b for b in eb if not (b.use_deform or b.name.startswith("DEF-"))]
    for b in control:
        eb.remove(b)   # children re-hang on the nearest surviving ancestor
    for side in ("L", "R"):
        eb["DEF-Thigh01." + side].parent = eb["DEF-Spine01"]
    orphans = rehang(eb)
    roots = [b.name for b in eb if b.parent is None]
    bpy.ops.object.mode_set(mode="OBJECT")
    print("bones: %d left after dropping %d control bones; %d orphans re-hung; roots: %s"
          % (len(rig.data.bones), len(control), len(orphans), roots))


import re

CLOTH = re.compile(r"Cloak|Skirt|Tie|Pendant|Armor|Wing|Breast|Butt|Bag", re.I)
HEADWEAR = re.compile(r"Hair|Eye|Lid|Lip|Mouth|Teeth|Tongue|Cheek|Jaw|Bounds", re.I)
HANDWEAR = re.compile(r"Palm|Finger", re.I)
LIMB = re.compile(r"Upperarm|Forearm|Hand|Finger|Palm|Thigh|Calf|Foot|Toe|Twist|Knee", re.I)


def rehang(eb):
    """Deform bones that hung off a control bone -- eyelids, palms, hair, cloak,
    armour -- are roots after the cull, and a root eyelid stays behind when the
    head turns. Nearest-bone parenting alone hangs a cloak on whichever arm is
    closest and it flaps out sideways with every gesture; so cloth goes to the
    torso, everything on the head to the head, hand parts to the hand, and
    only then the nearest of those."""
    torso = [eb[n] for n in ("DEF-Spine01", "DEF-Spine02", "DEF-Spine03", "DEF-Spine04", "DEF-Spine05", "DEF-Neck", "DEF-Shoulder.L", "DEF-Shoulder.R") if n in eb]
    head = [eb["DEF-Head"]]
    hands = [eb[n] for n in ("DEF-Hand.L", "DEF-Hand.R") if n in eb]
    everything = [eb[n] for n in HUMANOID.values() if n in eb]

    def home_for(b):
        if HANDWEAR.search(b.name):
            return hands
        if HEADWEAR.search(b.name):
            return head
        if CLOTH.search(b.name):
            return torso
        return everything

    moved = []
    for b in eb:
        wrong_limb = b.parent is not None and LIMB.search(b.parent.name) and (CLOTH.search(b.name) or HEADWEAR.search(b.name))
        if (b.parent is None and b.name != "DEF-Spine01") or wrong_limb:
            b.parent = min(home_for(b), key=lambda s: (s.head - b.head).length)
            moved.append(b.name)
    return moved


def map_humanoid(rig):
    ext = rig.data.vrm_addon_extension
    ext.spec_version = "1.0"
    hum = ext.vrm1.humanoid
    table = hum.human_bones.human_bone_name_to_human_bone()
    missing = []
    for name, bone in table.items():
        want = HUMANOID.get(name.value)
        if want and want in rig.data.bones:
            bone.node.bone_name = want
        elif want:
            missing.append(want)
        else:
            bone.node.bone_name = ""
    hum.pose = "autoPose"   # her rest is an A-pose; the exporter stands her in a T
    print("humanoid: %d bones mapped, correctly assigned = %s, missing %s"
          % (sum(1 for b in table.values() if b.node.bone_name), hum.human_bones.bones_are_correctly_assigned(), missing))


def rebuild_materials():
    convert_props = [p.identifier for p in bpy.ops.vrm.convert_material_to_mtoon1.get_rna_type().properties]
    for m in bpy.data.materials:
        if not m.name.startswith("MAT_") or not m.use_nodes:
            continue
        diffuse = next((n.image for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and "_D" in n.image.name), None)
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 1.0
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        if diffuse:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = diffuse
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        print("material %-26s <- %s" % (m.name, diffuse.name if diffuse else "flat"))
    return convert_props


def to_mtoon(convert_props):
    done = 0
    for m in bpy.data.materials:
        if not m.name.startswith("MAT_"):
            continue
        try:
            if "material_name" in convert_props:
                bpy.ops.vrm.convert_material_to_mtoon1(material_name=m.name)
            else:
                bpy.context.object.active_material = m
                bpy.ops.vrm.convert_material_to_mtoon1()
            done += 1
        except Exception as exc:
            print("mtoon skipped for %s: %s" % (m.name, exc))
    print("mtoon converted:", done)


def drop_shadow_shell(face):
    """The FaceShadow material is a game-engine gradient shell over the face;
    without that shader it renders as a grey mask, so those faces go."""
    slot = next((i for i, s in enumerate(face.material_slots) if s.material and "Shadow" in s.material.name), None)
    if slot is None:
        return
    bm = bmesh.new()
    bm.from_mesh(face.data)
    doomed = [f for f in bm.faces if f.material_index == slot]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(face.data)
    bm.free()
    print("dropped %d shadow-shell faces" % len(doomed))


def build_expressions(rig, face):
    ext = rig.data.vrm_addon_extension
    expressions = ext.vrm1.expressions
    while expressions.custom:
        bpy.ops.vrm.remove_vrm1_expressions_custom_expression(armature_object_name=rig.name, custom_expression_name=expressions.custom[0].custom_name)
    keys = {k.name for k in face.data.shape_keys.key_blocks}

    def bind(expr_name, expression, blend):
        while expression.morph_target_binds:
            expression.morph_target_binds.remove(0)
        for key, weight in blend.items():
            if key not in keys:
                raise KeyError("%s: no shape key %s" % (expr_name, key))
            bpy.ops.vrm.add_vrm1_expression_morph_target_bind(armature_object_name=rig.name, expression_name=expr_name)
            b = expression.morph_target_binds[-1]
            b.node.mesh_object_name = face.name
            b.index = key
            b.weight = weight

    def custom(name, blend, blink, mouth):
        bpy.ops.vrm.add_vrm1_expressions_custom_expression(armature_object_name=rig.name, custom_expression_name=name)
        e = expressions.custom[name]
        bind(name, e, blend)
        e.override_blink = blink
        e.override_mouth = mouth

    for name, blend in EXPRESSIONS.items():
        if name in PRESETS:
            # The add-on spells presets in snake_case; VRM and three-vrm in camelCase.
            e = getattr(expressions.preset, "".join("_" + c.lower() if c.isupper() else c for c in name))
            bind(name, e, blend)
            if name in ("happy", "angry", "sad", "relaxed", "surprised"):
                e.override_mouth = "blend"
        else:
            custom(name, blend, "block" if name in BLINK_BLOCKED else "none", "blend")
        if name in ("happy", "angry", "sad", "relaxed", "surprised") or name not in PRESETS:
            for part, prefix in PART_PREFIX.items():
                sub = {k: w for k, w in blend.items() if k.startswith(prefix)}
                if sub:
                    custom("%s.%s" % (name, part), sub,
                           "block" if (part == "eyes" and name in BLINK_BLOCKED) else "none",
                           "blend" if part == "mouth" else "none")
    print("expressions: %d custom (incl. parts)" % len(expressions.custom))


def springs(rig):
    try:
        bpy.ops.vrm.assign_spring_bone1_automatically(armature_object_name=rig.name)
        sb = rig.data.vrm_addon_extension.spring_bone1
        print("spring bones: %d springs, %d joints" % (len(sb.springs), sum(len(s.joints) for s in sb.springs)))
    except Exception as exc:
        print("spring bones skipped:", exc)


def main():
    rig = rig_object()
    face = bpy.data.objects[FACE]
    if any(not (b.use_deform or b.name.startswith("DEF-")) for b in rig.data.bones):
        strip_scene(rig)
        strip_rig(rig)
    else:
        # Already culled: still re-hang anything a control bone once held.
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        moved = rehang(rig.data.edit_bones)
        bpy.ops.object.mode_set(mode="OBJECT")
        print("re-hung %d bones: %s" % (len(moved), moved[:10]))
    map_humanoid(rig)
    props = rebuild_materials()
    to_mtoon(props)
    drop_shadow_shell(face)
    build_expressions(rig, face)
    springs(rig)
    meta = rig.data.vrm_addon_extension.vrm1.meta
    meta.vrm_name = "Anby"
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_mainfile()
    result = bpy.ops.export_scene.vrm(filepath=OUT, armature_object_name=rig.name, ignore_warning=True)
    size = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    print("export:", result, OUT, "%.1f MB" % (size / 1048576))


main()
