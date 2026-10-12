"""Run with Blender's Python (or any 3.11+): bpy is stubbed, no Blender needed."""
import importlib.util
import pathlib
import sys
import types

bpy = types.ModuleType("bpy")
bpy.types = types.SimpleNamespace(Operator=object, Panel=object)
sys.modules["bpy"] = bpy

spec = importlib.util.spec_from_file_location(
    "claude_addon", pathlib.Path(__file__).with_name("claude_addon.py")
)
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)

plain = "import bpy\nbpy.ops.object.select_all()"
assert addon.strip_fences(plain) == plain
assert addon.strip_fences("```python\n%s\n```" % plain) == plain
assert addon.strip_fences("```\n%s\n```\n" % plain) == plain
assert addon.strip_fences("```python\n%s" % plain) == plain  # unclosed fence
assert addon.strip_fences("") == ""
print("ok")
