bl_info = {
    "name": "Claude",
    "version": (1, 0),
    "blender": (5, 2, 0),
    "location": "View3D > Sidebar > Claude",
    "description": "Ask Claude Fable 5.1 for a bpy script against the open scene",
    "category": "Development",
}

import os
import queue
import threading

import bpy

MODEL = "claude-fable-5-1"
TEXT_NAME = "claude.py"
SYSTEM = """You write Python for Blender 5.2's bpy API.
Reply with one runnable script and nothing else: no prose, no markdown fences.
It runs inside the .blend described below, so operate on what is already there
instead of building a scene from scratch. Comment only where a line's reason is
not obvious from reading it."""

_status = "Idle"
_inbox = queue.Queue()


def strip_fences(reply):
    """Drop a leading ```lang line and its closing ``` if the reply came fenced."""
    lines = reply.strip().split("\n")
    if not lines or not lines[0].startswith("```"):
        return reply
    lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines)


def scene_summary(context):
    scene = context.scene
    out = ["Blender %s, mode %s." % (bpy.app.version_string, context.mode)]
    ob = context.active_object
    if ob:
        out.append("Active object: %s (%s)." % (ob.name, ob.type))
        if ob.type == "ARMATURE":
            bones = [b.name for b in ob.data.bones]
            out.append("%d bones: %s" % (len(bones), ", ".join(bones)))
        action = ob.animation_data.action if ob.animation_data else None
        if action:
            out.append("Active action: %s, frames %s." % (action.name, tuple(action.frame_range)))
    selected = [o.name for o in context.selected_objects]
    if selected:
        out.append("Selected: %s" % ", ".join(selected))
    out.append("Objects: " + ", ".join("%s(%s)" % (o.name, o.type) for o in bpy.data.objects[:80]))
    if bpy.data.actions:
        out.append("Actions: " + ", ".join(a.name for a in bpy.data.actions[:80]))
    out.append("Frame %d of %d-%d." % (scene.frame_current, scene.frame_start, scene.frame_end))
    return "\n".join(out)


def _ask(prompt, summary):
    """Runs off the main thread; talks to the UI only through _inbox."""
    try:
        import anthropic
    except ImportError:
        _inbox.put(("error", "anthropic is not installed in Blender's Python"))
        return
    if not os.environ.get("ANTHROPIC_API_KEY"):
        _inbox.put(("error", "ANTHROPIC_API_KEY is not set for this Blender process"))
        return
    try:
        with anthropic.Anthropic().beta.messages.stream(
            model=MODEL,
            max_tokens=64000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            messages=[{"role": "user", "content": "%s\n\n%s" % (summary, prompt)}],
        ) as stream:
            message = stream.get_final_message()
    except Exception as exc:
        _inbox.put(("error", "%s: %s" % (type(exc).__name__, exc)))
        return
    if message.stop_reason == "refusal":
        _inbox.put(("error", "Claude declined that one"))
        return
    _inbox.put(("ok", "\n".join(b.text for b in message.content if b.type == "text")))


def _poll():
    global _status
    try:
        kind, payload = _inbox.get_nowait()
    except queue.Empty:
        return 0.5
    if kind == "error":
        _status = payload
    else:
        text = bpy.data.texts.get(TEXT_NAME) or bpy.data.texts.new(TEXT_NAME)
        text.clear()
        text.write(strip_fences(payload))
        _status = "Wrote %s, %d lines" % (TEXT_NAME, len(text.lines))
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            area.tag_redraw()
    return None


class CLAUDE_OT_ask(bpy.types.Operator):
    bl_idname = "claude.ask"
    bl_label = "Ask Claude"

    def execute(self, context):
        global _status
        prompt = context.scene.claude_prompt.strip()
        if not prompt:
            self.report({"ERROR"}, "Write a prompt first")
            return {"CANCELLED"}
        _status = "Thinking..."
        threading.Thread(
            target=_ask, args=(prompt, scene_summary(context)), daemon=True
        ).start()
        if not bpy.app.timers.is_registered(_poll):
            bpy.app.timers.register(_poll)
        return {"FINISHED"}


class CLAUDE_OT_run(bpy.types.Operator):
    bl_idname = "claude.run"
    bl_label = "Run claude.py"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        text = bpy.data.texts.get(TEXT_NAME)
        if not text:
            self.report({"ERROR"}, "Nothing to run yet")
            return {"CANCELLED"}
        try:
            # ponytail: no sandbox. Read claude.py in the Text editor before running it.
            exec(compile(text.as_string(), TEXT_NAME, "exec"), {"__name__": "__main__"})
        except Exception as exc:
            self.report({"ERROR"}, "%s: %s" % (type(exc).__name__, exc))
            return {"CANCELLED"}
        return {"FINISHED"}


class CLAUDE_PT_panel(bpy.types.Panel):
    bl_label = "Claude"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Claude"

    def draw(self, context):
        col = self.layout.column()
        col.prop(context.scene, "claude_prompt", text="")
        col.operator("claude.ask", icon="CONSOLE")
        col.operator("claude.run", icon="PLAY")
        col.label(text=_status)


_classes = (CLAUDE_OT_ask, CLAUDE_OT_run, CLAUDE_PT_panel)


def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.claude_prompt = bpy.props.StringProperty(
        name="Prompt", description="What Claude should script against this scene"
    )


def unregister():
    if bpy.app.timers.is_registered(_poll):
        bpy.app.timers.unregister(_poll)
    del bpy.types.Scene.claude_prompt
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
