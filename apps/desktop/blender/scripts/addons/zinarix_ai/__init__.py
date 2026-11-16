# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Zinarix AI: connect Zinarix Studio 3D to an external AI model.

The model answers questions about the scene or writes ``bpy`` scripts. Scripts
are never run automatically: they go to the text "zinarix_ai.py", the user
reviews them and presses "Run". Running pushes an undo step.

Zinarix Studio (the desktop app) can configure this add-on when it launches
Zinarix Studio 3D, through the environment variables ``ZINARIX_AI_PROVIDER``,
``ZINARIX_AI_MODEL``, ``ZINARIX_AI_BASE_URL`` and ``ZINARIX_AI_KEY``.
"""

bl_info = {
    "name": "Zinarix AI",
    "author": "Zinarix Studio",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D Viewport > Sidebar > Zinarix",
    "description": "Ask an external AI model about the scene or let it write scripts you review",
    "category": "Interface",
    "support": 'OFFICIAL',
}

import os
import queue
import threading

import bpy
from bpy.props import EnumProperty, IntProperty, StringProperty

from . import client

CODE_TEXT = "zinarix_ai.py"
ANSWER_TEXT = "zinarix_ai_answer.md"
MAX_HISTORY = 12  # Messages kept for follow-up questions (user + assistant).
MAX_OBJECTS = 60  # Objects described to the model.

_history = []
_results = queue.Queue()
_busy = False


# -----------------------------------------------------------------------------
# Preferences


# A static tuple: Blender needs the enum strings to stay referenced.
_PROVIDER_ITEMS = tuple((key, info["label"], "") for key, info in client.PROVIDERS.items())


class ZinarixAIPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    provider: EnumProperty(name="Provider", items=_PROVIDER_ITEMS)
    model: StringProperty(
        name="Model",
        description="Model id. Empty uses the provider default",
    )
    base_url: StringProperty(
        name="Server URL",
        description="API base URL. Empty uses the provider default",
    )
    api_key: StringProperty(
        name="API Key",
        description="Stored in your preferences file. Empty reads the environment variable",
        subtype='PASSWORD',
    )
    max_tokens: IntProperty(name="Max Tokens", default=8192, min=256, max=128000)

    def draw(self, _context):
        layout = self.layout
        layout.use_property_split = True
        info = client.PROVIDERS[self.provider]
        layout.prop(self, "provider")
        layout.prop(self, "model", placeholder=info["model"] or "model-id")
        layout.prop(self, "base_url", placeholder=info["base_url"] or "http://host:port/v1")
        layout.prop(self, "api_key")
        layout.prop(self, "max_tokens")
        col = layout.column(align=True)
        col.label(text="Without a key here, {:s} is read.".format(" / ".join(info["key_env"])), icon='INFO')
        col.label(text="Keys saved here are stored in plain text in userpref.blend.")


def _settings(context):
    """Effective settings: environment (set by Zinarix Studio) over preferences."""
    prefs = context.preferences.addons[__package__].preferences
    provider = os.environ.get("ZINARIX_AI_PROVIDER", "").upper() or prefs.provider
    if provider not in client.PROVIDERS:
        provider = prefs.provider
    info = client.PROVIDERS[provider]
    key = prefs.api_key or next((os.environ[k] for k in info["key_env"] if os.environ.get(k)), "")
    return {
        "provider": provider,
        "model": os.environ.get("ZINARIX_AI_MODEL") or prefs.model,
        "base_url": os.environ.get("ZINARIX_AI_BASE_URL") or prefs.base_url or info["base_url"],
        "api_key": key,
        "max_tokens": prefs.max_tokens,
    }


# -----------------------------------------------------------------------------
# Prompting


def _scene_summary(context):
    scene = context.scene
    lines = [
        "Zinarix Studio 3D (Blender {:s} API)".format(bpy.app.version_string),
        "Scene: {!r}, frames {:d}-{:d}, render engine {:s}, units {:s}".format(
            scene.name, scene.frame_start, scene.frame_end,
            scene.render.engine, scene.unit_settings.system,
        ),
        "Mode: {:s}".format(context.mode),
    ]
    active = context.view_layer.objects.active
    if active:
        lines.append("Active object: {!r}".format(active.name))
    objects = list(scene.objects)
    lines.append("Objects ({:d}):".format(len(objects)))
    for ob in objects[:MAX_OBJECTS]:
        loc = ", ".join("{:.2f}".format(v) for v in ob.location)
        mat = ob.active_material.name if getattr(ob, "active_material", None) else "-"
        sel = " selected" if ob.select_get() else ""
        lines.append("- {!r} {:s} at ({:s}), material {!s}{:s}".format(ob.name, ob.type, loc, mat, sel))
    if len(objects) > MAX_OBJECTS:
        lines.append("- ... and {:d} more".format(len(objects) - MAX_OBJECTS))
    return "\n".join(lines)


SYSTEM_CODE = (
    "You are the AI assistant inside Zinarix Studio 3D, a 3D app based on Blender. "
    "When the user asks for something, answer with exactly one ```python code block that "
    "does it through the bpy API, followed by at most two short sentences. Prefer bpy.data "
    "and object/mesh APIs over bpy.ops (bpy.ops depends on the editor context). Do not "
    "delete files, use the network, spawn processes or read outside the project. Name new "
    "objects clearly. The user reviews the code before it runs. Write comments and the "
    "sentences in the user's language."
)
SYSTEM_ASK = (
    "You are the AI assistant inside Zinarix Studio 3D, a 3D app based on Blender. Answer "
    "questions about the user's scene, modeling, materials, animation and rendering, briefly "
    "and in the user's language. Use Markdown. Show bpy code only if it helps."
)


def _worker(settings, system, messages, mode):
    try:
        text = client.chat(
            settings["provider"],
            base_url=settings["base_url"],
            model=settings["model"],
            api_key=settings["api_key"],
            system=system,
            messages=messages,
            max_tokens=settings["max_tokens"],
        )
        _results.put(("ok", mode, text))
    except client.ClientError as ex:
        _results.put(("error", mode, str(ex)))
    except Exception as ex:  # Never let the thread die silently.
        _results.put(("error", mode, "{:s}: {!s}".format(type(ex).__name__, ex)))


def _set_text(name, body):
    text = bpy.data.texts.get(name) or bpy.data.texts.new(name)
    text.clear()
    text.write(body)
    return text


def _show_text(text):
    """Show ``text`` in an open Text Editor, if there is one."""
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == 'TEXT_EDITOR':
                area.spaces.active.text = text
                area.tag_redraw()
                return True
    return False


def _redraw_sidebars():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()


def _poll_results():
    global _busy
    try:
        status, mode, text = _results.get_nowait()
    except queue.Empty:
        return 0.25
    _busy = False
    wm = bpy.context.window_manager
    if status == "error":
        wm.zinarix_ai_status = "Error: " + text
        if _history and _history[-1]["role"] == "user":
            _history.pop()  # Drop the unanswered question.
    else:
        _history.append({"role": "assistant", "content": text})
        del _history[:-MAX_HISTORY]
        if mode == 'CODE':
            code = client.extract_code(text)
            shown = _show_text(_set_text(CODE_TEXT, code))
            wm.zinarix_ai_status = "Script ready in \"{:s}\"{:s}. Review it, then press Run.".format(
                CODE_TEXT, "" if shown else " (open a Text Editor to read it)",
            )
        else:
            shown = _show_text(_set_text(ANSWER_TEXT, text))
            first = text.strip().splitlines()[0][:160]
            wm.zinarix_ai_status = first + ("" if shown else "  (full answer in \"{:s}\")".format(ANSWER_TEXT))
    _redraw_sidebars()
    return None  # Stop the timer.


# -----------------------------------------------------------------------------
# Operators


class ZINARIX_OT_ai_send(bpy.types.Operator):
    """Send the prompt and a summary of the scene to the external AI model"""
    bl_idname = "zinarix.ai_send"
    bl_label = "Send"

    @classmethod
    def poll(cls, context):
        return not _busy and context.window_manager.zinarix_ai_prompt.strip() != ""

    def execute(self, context):
        global _busy
        wm = context.window_manager
        settings = _settings(context)
        if not bpy.app.online_access and not client.is_local_url(settings["base_url"]):
            self.report(
                {'ERROR'},
                "Online access is disabled. Enable it in Preferences > System > Network, "
                "or use a local server (Ollama).",
            )
            return {'CANCELLED'}

        prompt = wm.zinarix_ai_prompt.strip()
        mode = wm.zinarix_ai_mode
        content = "Current scene:\n{:s}\n\nRequest:\n{:s}".format(_scene_summary(context), prompt)
        _history.append({"role": "user", "content": content})
        system = SYSTEM_CODE if mode == 'CODE' else SYSTEM_ASK
        _busy = True
        wm.zinarix_ai_status = "Waiting for {:s}...".format(settings["model"] or settings["provider"].title())
        threading.Thread(
            target=_worker, args=(settings, system, list(_history), mode), daemon=True,
        ).start()
        if not bpy.app.timers.is_registered(_poll_results):
            bpy.app.timers.register(_poll_results, first_interval=0.25)
        wm.zinarix_ai_prompt = ""
        return {'FINISHED'}


class ZINARIX_OT_ai_run(bpy.types.Operator):
    """Run the script the AI wrote (text "zinarix_ai.py"). Review it first"""
    bl_idname = "zinarix.ai_run"
    bl_label = "Run Script"
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return CODE_TEXT in bpy.data.texts and not _busy

    def invoke(self, context, event):
        code = bpy.data.texts[CODE_TEXT].as_string()
        risky = client.risky_calls(code)
        title = "Run the AI script?"
        if risky:
            title = "The script uses {:s}. Run it anyway?".format(", ".join(risky))
        return context.window_manager.invoke_confirm(
            self, event, title=title, confirm_text="Run", icon='WARNING' if risky else 'QUESTION',
        )

    def execute(self, context):
        code = bpy.data.texts[CODE_TEXT].as_string()
        try:
            exec(compile(code, CODE_TEXT, "exec"), {"__name__": "__main__", "bpy": bpy})
        except Exception as ex:
            context.window_manager.zinarix_ai_status = "The script failed: {:s}: {!s}".format(type(ex).__name__, ex)
            self.report({'ERROR'}, "Script failed: {!s}".format(ex))
            return {'CANCELLED'}
        context.window_manager.zinarix_ai_status = "Script ran. Ctrl+Z undoes it."
        return {'FINISHED'}


class ZINARIX_OT_ai_reset(bpy.types.Operator):
    """Forget the conversation so the next prompt starts fresh"""
    bl_idname = "zinarix.ai_reset"
    bl_label = "New Conversation"

    def execute(self, context):
        _history.clear()
        context.window_manager.zinarix_ai_status = ""
        return {'FINISHED'}


# -----------------------------------------------------------------------------
# Panel


class VIEW3D_PT_zinarix_ai(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Zinarix"
    bl_label = "Zinarix AI"

    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        settings = _settings(context)
        info = client.PROVIDERS[settings["provider"]]

        layout.label(text="{:s} · {:s}".format(info["label"], settings["model"] or info["model"]), icon='WORLD')
        layout.row().prop(wm, "zinarix_ai_mode", expand=True)
        layout.prop(wm, "zinarix_ai_prompt", text="")
        row = layout.row(align=True)
        row.scale_y = 1.3
        row.operator(ZINARIX_OT_ai_send.bl_idname, icon='PLAY' if not _busy else 'SORTTIME')
        row.operator(ZINARIX_OT_ai_reset.bl_idname, text="", icon='TRASH')
        if wm.zinarix_ai_mode == 'CODE':
            layout.operator(ZINARIX_OT_ai_run.bl_idname, icon='SCRIPT')
        if wm.zinarix_ai_status:
            box = layout.box()
            col = box.column(align=True)
            for line in _wrap(wm.zinarix_ai_status, 42):
                col.label(text=line)
        if info["needs_key"] and not settings["api_key"]:
            layout.label(text="Add an API key in the add-on preferences", icon='ERROR')


def _wrap(text, width):
    words, lines, line = text.split(), [], ""
    for word in words:
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = word if not line else line + " " + word
    if line:
        lines.append(line)
    return lines[:8]


# -----------------------------------------------------------------------------
# Spanish translations (Zinarix Studio's main language).

_translations = {
    "es": {
        ("*", "Send"): "Enviar",
        ("*", "Run Script"): "Ejecutar script",
        ("*", "New Conversation"): "Nueva conversación",
        ("*", "Write Script"): "Escribir script",
        ("*", "Ask"): "Preguntar",
        ("*", "Provider"): "Proveedor",
        ("*", "Model"): "Modelo",
        ("*", "Server URL"): "URL del servidor",
        ("*", "API Key"): "Clave de API",
        ("*", "Max Tokens"): "Tokens máximos",
        ("*", "Add an API key in the add-on preferences"): "Agrega una clave de API en las preferencias del complemento",
        ("*", "Keys saved here are stored in plain text in userpref.blend."): "Las claves guardadas aquí quedan en texto plano en userpref.blend.",
    },
}


classes = (
    ZinarixAIPreferences,
    ZINARIX_OT_ai_send,
    ZINARIX_OT_ai_run,
    ZINARIX_OT_ai_reset,
    VIEW3D_PT_zinarix_ai,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    wm = bpy.types.WindowManager
    wm.zinarix_ai_prompt = StringProperty(
        name="Prompt",
        description="What you want: e.g. \"add a low-poly tree next to the cube\"",
        options={'SKIP_SAVE'},
    )
    wm.zinarix_ai_mode = EnumProperty(
        name="Mode",
        items=(
            ('CODE', "Write Script", "The AI writes a bpy script that you review and run"),
            ('ASK', "Ask", "The AI only answers, it does not change the scene"),
        ),
        options={'SKIP_SAVE'},
    )
    wm.zinarix_ai_status = StringProperty(options={'SKIP_SAVE'})
    bpy.app.translations.register(__package__, _translations)


def unregister():
    bpy.app.translations.unregister(__package__)
    if bpy.app.timers.is_registered(_poll_results):
        bpy.app.timers.unregister(_poll_results)
    wm = bpy.types.WindowManager
    del wm.zinarix_ai_status
    del wm.zinarix_ai_mode
    del wm.zinarix_ai_prompt
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
