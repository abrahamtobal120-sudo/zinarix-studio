# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Zinarix AI: an AI agent that works inside Zinarix Studio 3D, with the user in control.

The loop: the user sends a request; the model answers with at most one ``bpy``
code block; the code goes to the text "zinarix_ai.py" and runs (automatically
with "Auto-run", otherwise after the user presses "Run Step"); the result goes
back to the model with a fresh description of the scene; repeat until the model
answers without code or the step limit is reached. Code that uses risky calls
(files, processes, network, ``exec``...) always waits for the user's approval.

Only the network request runs in a worker thread. Everything that touches
``bpy`` runs on the main thread, from a ``bpy.app.timers`` callback that polls
a queue. Each loop has a run id: results of a stopped loop are ignored.

Zinarix Studio (the desktop app) configures this add-on when it launches
Zinarix Studio 3D, through the environment variables ``ZINARIX_AI_PROVIDER``,
``ZINARIX_AI_MODEL``, ``ZINARIX_AI_BASE_URL``, ``ZINARIX_AI_KEY``,
``ZINARIX_BRIDGE_URL`` / ``ZINARIX_BRIDGE_TOKEN`` and ``ZINARIX_LANG``.
"""

bl_info = {
    "name": "Zinarix AI",
    "author": "Zinarix Studio",
    "version": (2, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D Viewport > Sidebar > Zinarix",
    "description": "An AI agent that builds and edits your scene step by step, with your approval",
    "category": "Interface",
    "support": 'OFFICIAL',
}

import os
import queue
import threading

import bpy
from bpy.app.handlers import persistent
from bpy.app.translations import pgettext_iface as iface_
from bpy.props import BoolProperty, EnumProperty, IntProperty, StringProperty

from . import agent, client

CODE_TEXT = "zinarix_ai.py"
ANSWER_TEXT = "zinarix_ai_answer.md"
MAX_HISTORY = 12  # Messages kept for follow-up turns (user + assistant).
MAX_OBJECTS = 60  # Objects described to the model.
PREVIEW_LINES = 8  # Lines of pending code shown in the panel.
POLL_INTERVAL = 0.2
# Own context for names Blender's Spanish catalog already translates otherwise
# ("Max Steps" -> "Intervalos máx", "Prompt" -> "Cursor").
I18N_CONTEXT = "ZinarixAI"

# -----------------------------------------------------------------------------
# State (module level, reset on register)


class _State:
    def __init__(self):
        self.history = []  # {"role", "content"}; user turns also keep "scene".
        self.run_id = 0  # Bumped on Send / Stop / Reset / unregister.
        self.busy = False  # A worker is waiting for the model.
        self.active = False  # A loop is running (busy or waiting for approval).
        self.step = 0
        self.max_steps = agent.MAX_STEPS
        self.pending = None  # {"code": str, "risky": [str]} waiting for Run / Skip.
        self.last_answer = ""
        self.last_error = ""
        self.last_failed = False  # The last script that ran raised an error.
        self.status = ""
        self.status_kind = 'INFO'  # 'INFO' | 'ERROR' | 'DONE'
        self.models = []  # From client.list_models.
        self.models_busy = False
        self.bridge = None  # None: unknown, True / False: last check.


_state = _State()
_results = queue.Queue()  # (run_id, kind, payload) from worker threads.
_alive = [False]  # Set False on unregister so late threads drop their results.


def _iface(msg):
    try:
        return iface_(msg)
    except Exception:
        return msg


def _lang():
    lang = os.environ.get("ZINARIX_LANG", "").strip().lower()
    if not lang:
        try:
            if bpy.context.preferences.view.use_translate_interface:
                lang = (bpy.app.translations.locale or "").lower()
        except Exception:
            lang = ""
    return "es" if lang.startswith("es") else "en"


# -----------------------------------------------------------------------------
# Preferences


def _bridge_env():
    return bool(os.environ.get("ZINARIX_BRIDGE_URL"))


def _default_provider():
    env = os.environ.get("ZINARIX_AI_PROVIDER", "").upper()
    if env in client.PROVIDERS:
        return env
    if _bridge_env() and "ZINARIX" in client.PROVIDERS:
        return "ZINARIX"
    for key in client.PROVIDERS:
        if key != "ZINARIX":
            return key
    return next(iter(client.PROVIDERS))


# Static tuples: Blender needs the enum strings to stay referenced.
_PROVIDER_ITEMS = tuple((key, info["label"], "") for key, info in client.PROVIDERS.items())
_MODEL_ITEMS = [("", "(refresh to list models)", "")]


def _model_items(_self, _context):
    return _MODEL_ITEMS


def _model_choice_update(self, _context):
    if self.model_choice:
        self.model = self.model_choice


class ZinarixAIPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    provider: EnumProperty(name="Provider", items=_PROVIDER_ITEMS, default=_default_provider())
    model: StringProperty(
        name="Model",
        description="Model id. Empty uses the provider default",
    )
    model_choice: EnumProperty(
        name="Available Models",
        description="Models offered by the provider (press Refresh to update the list)",
        items=_model_items,
        update=_model_choice_update,
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
    auto_run: BoolProperty(
        name="Auto-run",
        description=(
            "Run each script as soon as the AI writes it. Scripts with risky calls "
            "(files, processes, network) always ask first"
        ),
        default=False,
    )
    max_steps: IntProperty(
        name="Max Steps",
        description="Most scripts the agent may run for one request",
        default=agent.MAX_STEPS, min=1, max=30,
        translation_context=I18N_CONTEXT,
    )

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        settings = _settings(context)
        info = client.PROVIDERS.get(self.provider, {})
        if os.environ.get("ZINARIX_AI_PROVIDER"):
            layout.label(text="Zinarix Studio chose the provider for this session.", icon='INFO')
        layout.prop(self, "provider")
        row = layout.row(align=True)
        row.prop(self, "model", placeholder=info.get("model") or "model-id")
        row.operator(ZINARIX_OT_ai_refresh_models.bl_idname, text="", icon='FILE_REFRESH')
        if len(_MODEL_ITEMS) > 1 or _MODEL_ITEMS[0][0]:
            layout.prop(self, "model_choice")
        if settings["provider"] != "ZINARIX":
            layout.prop(self, "base_url", placeholder=info.get("base_url") or "http://host:port/v1")
            layout.prop(self, "api_key")
        layout.prop(self, "max_tokens")
        layout.separator()
        layout.prop(self, "auto_run")
        layout.prop(self, "max_steps")
        if settings["provider"] != "ZINARIX":
            col = layout.column(align=True)
            env = " / ".join(info.get("key_env", ()))
            if env:
                col.label(text=_iface("Without a key here, {:s} is read.").format(env), icon='INFO', translate=False)
            col.label(text="Keys saved here are stored in plain text in userpref.blend.")


def _prefs(context=None):
    context = context or bpy.context
    addon = context.preferences.addons.get(__package__)
    return addon.preferences if addon else None


def _settings(context=None):
    """Effective settings: environment (set by Zinarix Studio) over preferences."""
    prefs = _prefs(context)
    provider = os.environ.get("ZINARIX_AI_PROVIDER", "").upper() or (prefs.provider if prefs else "")
    if provider not in client.PROVIDERS:
        provider = prefs.provider if prefs and prefs.provider in client.PROVIDERS else _default_provider()
    info = client.PROVIDERS[provider]
    # The bridge token comes from the environment (client.py); the key in the preferences
    # belongs to the other providers and would be rejected by the bridge.
    api_key = "" if provider == "ZINARIX" else (prefs.api_key if prefs else "") or next(
        (os.environ[k] for k in info.get("key_env", ()) if os.environ.get(k)), "",
    )
    return {
        "provider": provider,
        "model": os.environ.get("ZINARIX_AI_MODEL") or (prefs.model if prefs else ""),
        "base_url": os.environ.get("ZINARIX_AI_BASE_URL")
        or ((prefs.base_url if prefs else "") if provider != "ZINARIX" else "")
        or info.get("base_url", ""),
        "api_key": api_key,
        "max_tokens": prefs.max_tokens if prefs else 8192,
        "auto_run": bool(prefs.auto_run) if prefs else False,
        "max_steps": prefs.max_steps if prefs else agent.MAX_STEPS,
    }


# -----------------------------------------------------------------------------
# Worker threads (network only, never bpy)


def _chat_worker(run_id, settings, system, messages):
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
        result = (run_id, "reply", text)
    except client.ClientError as ex:
        result = (run_id, "error", str(ex))
    except Exception as ex:  # Never let the thread die silently.
        result = (run_id, "error", "{:s}: {!s}".format(type(ex).__name__, ex))
    if _alive[0]:
        _results.put(result)


def _models_worker(settings):
    models, bridge, error = None, None, None
    try:
        if settings["provider"] == "ZINARIX" and hasattr(client, "bridge_available"):
            bridge = bool(client.bridge_available(probe=True, timeout=1.0))
        if hasattr(client, "list_models"):
            models = list(client.list_models(settings) or [])
    except Exception as ex:
        error = str(ex)
    if _alive[0]:
        _results.put((None, "models", (models, bridge, error)))


def _bridge_worker():
    try:
        ok = bool(client.bridge_available(probe=True, timeout=1.0))
    except Exception:
        ok = False
    if _alive[0]:
        _results.put((None, "bridge", ok))


def _start_thread(target, *args):
    threading.Thread(target=target, args=args, daemon=True, name="zinarix_ai").start()
    _ensure_timer()


# -----------------------------------------------------------------------------
# Text blocks and redraws (main thread)


def _set_text(name, body):
    text = bpy.data.texts.get(name) or bpy.data.texts.new(name)
    text.clear()
    text.write(body)
    return text


def _show_text(text):
    """Show ``text`` in an open Text Editor, if there is one."""
    wm = bpy.context.window_manager
    if wm is None:
        return False
    for window in wm.windows:
        for area in window.screen.areas:
            if area.type == 'TEXT_EDITOR':
                area.spaces.active.text = text
                area.tag_redraw()
                return True
    return False


def _redraw():
    wm = bpy.context.window_manager
    if wm is None:
        return
    for window in wm.windows:
        for area in window.screen.areas:
            if area.type in {'VIEW_3D', 'TEXT_EDITOR', 'PREFERENCES'}:
                area.tag_redraw()


def _set_status(msg, kind='INFO'):
    _state.status = msg
    _state.status_kind = kind


# -----------------------------------------------------------------------------
# Agent loop (main thread)


def _trim_history():
    history = _state.history
    request = next((m for m in reversed(history) if m.get("request")), None)
    del history[:-MAX_HISTORY]
    while history and history[0]["role"] != "user":
        del history[0]
    # A long run must not forget what it was asked: keep its request first.
    if request is not None and not any(m is request for m in history):
        while len(history) > 1 and history[0]["role"] == "user":
            del history[0]  # Keep user / assistant turns alternating after the request.
        history.insert(0, request)


def _messages():
    """History for the model: only the latest user turn carries the scene description."""
    out = []
    last = len(_state.history) - 1
    for i, msg in enumerate(_state.history):
        content = msg["content"]
        if i == last and msg.get("scene"):
            content = "Current scene:\n{:s}\n\n{:s}".format(msg["scene"], content)
        out.append({"role": msg["role"], "content": content})
    return out


def _describe(context):
    try:
        return agent.describe_scene(context, max_objects=MAX_OBJECTS)
    except Exception as ex:
        return "(scene description failed: {!s})".format(ex)


def _request(context, content, request=False):
    """Append a user turn (``content`` + fresh scene) and ask the model in a thread.

    ``request``: the user's own message, kept by ``_trim_history`` while its run lasts.
    """
    settings = _settings(context)
    if request:
        for msg in _state.history:
            msg.pop("request", None)  # Only the latest request is pinned.
    turn = {"role": "user", "content": content, "scene": _describe(context)}
    if request:
        turn["request"] = True
    _state.history.append(turn)
    _trim_history()
    _state.step += 1
    _state.busy = True
    _state.active = True
    try:
        system = agent.build_system_prompt(_lang(), settings["auto_run"])
    except Exception:
        system = ""
    who = settings["model"] or client.PROVIDERS[settings["provider"]].get("label", settings["provider"])
    _set_status(_iface("Step {:d}/{:d}: waiting for {:s}...").format(_state.step, _state.max_steps, who))
    _start_thread(_chat_worker, _state.run_id, settings, system, _messages())


def _finish(msg, kind='DONE'):
    _state.busy = False
    _state.active = False
    _state.pending = None
    _set_status(msg, kind)


def _on_reply(context, text):
    _state.busy = False
    _state.history.append({"role": "assistant", "content": text})
    _trim_history()
    _state.last_answer = text
    _set_text(ANSWER_TEXT, text)
    try:
        final = agent.is_final(text)
    except Exception:
        final = "```" not in text
    if final:
        if _state.last_failed:
            _finish(_iface("Finished with errors: see the answer."), 'ERROR')
        else:
            _finish(_iface("Done."), 'DONE')
        return
    code = client.extract_code(text)
    _show_text(_set_text(CODE_TEXT, code))
    risky = client.risky_calls(code)
    _state.pending = {"code": code, "risky": risky}
    if _settings(context)["auto_run"] and not risky:
        _run_pending(context)
    elif risky:
        _set_status(_iface("Step {:d}/{:d}: the script uses {:s}. Review it before running.").format(
            _state.step, _state.max_steps, ", ".join(risky)), 'ERROR')
    else:
        _set_status(_iface("Step {:d}/{:d}: review the script, then Run Step or Skip.").format(
            _state.step, _state.max_steps))


def _continue(context, feedback):
    if _state.step >= _state.max_steps:
        _finish(_iface("Reached the step limit ({:d}). Send a new message to continue.").format(
            _state.max_steps), 'INFO')
        return
    _request(context, feedback)


def _run_pending(context):
    pending = _state.pending
    if pending is None:
        return None
    _state.pending = None
    result = agent.run_code(pending["code"])
    _state.last_failed = not result.get("ok")
    if result.get("ok"):
        _state.last_error = ""
    else:
        _state.last_error = result.get("error") or "unknown error"
    try:
        feedback = agent.feedback_message(result, _lang())
    except Exception:
        feedback = "Result: {!r}".format(result)
    _continue(context, feedback)
    if not result.get("ok") and not _state.active:
        _set_status(_iface("The script failed: {:s}").format(_state.last_error.strip().splitlines()[-1]), 'ERROR')
    return result


def _stop():
    _state.run_id += 1
    if _state.busy and _state.history and _state.history[-1]["role"] == "user":
        _state.history.pop()  # The unanswered turn.
    _state.busy = False
    _state.active = False
    _state.pending = None


def _handle(context, item):
    run_id, kind, payload = item
    if kind == "models":
        models, bridge, error = payload
        _state.models_busy = False
        if bridge is not None:
            _state.bridge = bridge
        if models:
            _state.models = models
            _MODEL_ITEMS[:] = [(m, m, "") for m in models]
            _set_status(_iface("{:d} models available.").format(len(models)))
        elif error:
            _set_status(_iface("Could not list models: {:s}").format(_iface(error)), 'ERROR')
        else:
            _set_status(_iface("The provider did not list any models."))
        return
    if kind == "bridge":
        _state.bridge = payload
        return
    if run_id != _state.run_id or not _state.busy:
        return  # A stopped or replaced loop.
    if kind == "error":
        _state.busy = False
        _state.active = False
        _state.step = max(0, _state.step - 1)
        if _state.history and _state.history[-1]["role"] == "user":
            _state.history.pop()
        _state.last_error = payload
        # Fixed client messages are in translations.py; others come back unchanged.
        _set_status(_iface("Error: {:s}").format(_iface(payload)), 'ERROR')
    else:
        _on_reply(context, payload)


def _poll():
    if not _alive[0]:
        return None
    handled = False
    while True:
        try:
            item = _results.get_nowait()
        except queue.Empty:
            break
        handled = True
        try:
            _handle(bpy.context, item)
        except Exception as ex:
            _finish(_iface("Error: {:s}").format("{:s}: {!s}".format(type(ex).__name__, ex)), 'ERROR')
    if handled:
        _redraw()
    if _state.busy or _state.models_busy or threading.active_count() > 1 and _has_workers():
        return POLL_INTERVAL
    return None


def _has_workers():
    return any(t.name == "zinarix_ai" and t.is_alive() for t in threading.enumerate())


def _ensure_timer():
    if not bpy.app.timers.is_registered(_poll):
        bpy.app.timers.register(_poll, first_interval=POLL_INTERVAL, persistent=True)


@persistent
def _on_load_pre(*_args):
    """Opening another file stops the loop (its scripts were meant for the old scene)."""
    if _state.active:
        _stop()
        _set_status(_iface("Stopped: another file was opened."))


# -----------------------------------------------------------------------------
# Operators


def _base_url(settings):
    resolve = getattr(client, "resolve_base_url", None)
    if resolve is not None:
        return resolve(settings["provider"], settings["base_url"])
    return settings["base_url"]


def _check_online(op, settings):
    if bpy.app.online_access:
        return True
    if client.is_local_url(_base_url(settings)):
        return True
    op.report(
        {'ERROR'},
        "Online access is disabled. Enable it in Preferences > System > Network, "
        "or use Zinarix Studio or a local server (Ollama).",
    )
    return False


class ZINARIX_OT_ai_send(bpy.types.Operator):
    """Send the request and a description of the scene to the AI agent"""
    bl_idname = "zinarix.ai_send"
    bl_label = "Send"

    @classmethod
    def poll(cls, context):
        return not _state.active and context.window_manager.zinarix_ai_prompt.strip() != ""

    def execute(self, context):
        wm = context.window_manager
        settings = _settings(context)
        if not _check_online(self, settings):
            return {'CANCELLED'}
        _state.run_id += 1
        _state.step = 0
        _state.max_steps = settings["max_steps"]
        _state.pending = None
        _state.last_failed = False
        _request(context, "Request:\n" + wm.zinarix_ai_prompt.strip(), request=True)
        wm.zinarix_ai_prompt = ""
        return {'FINISHED'}


class ZINARIX_OT_ai_stop(bpy.types.Operator):
    """Stop the agent. A reply still on its way is ignored"""
    bl_idname = "zinarix.ai_stop"
    bl_label = "Stop"

    @classmethod
    def poll(cls, _context):
        return _state.active

    def execute(self, _context):
        _stop()
        _set_status(_iface("Stopped."))
        _redraw()
        return {'FINISHED'}


class ZINARIX_OT_ai_run(bpy.types.Operator):
    """Run the script the AI wrote (text "zinarix_ai.py") and send the result back. Ctrl+Z undoes it"""
    bl_idname = "zinarix.ai_run"
    bl_label = "Run Step"

    @classmethod
    def poll(cls, _context):
        return _state.pending is not None and not _state.busy

    def _sync_code(self):
        # The user may have edited the script in the Text Editor before running it.
        text = bpy.data.texts.get(CODE_TEXT)
        if text is not None and _state.pending is not None:
            code = text.as_string()
            _state.pending = {"code": code, "risky": client.risky_calls(code)}

    def invoke(self, context, event):
        self._sync_code()
        risky = _state.pending["risky"]
        if not risky:
            return self.execute(context)
        return context.window_manager.invoke_confirm(
            self, event,
            title=_iface("The script uses {:s}. Run it anyway?").format(", ".join(risky)),
            confirm_text=_iface("Run"),
            icon='WARNING',
        )

    def execute(self, context):
        self._sync_code()
        result = _run_pending(context)
        if result is not None and not result.get("ok"):
            self.report({'WARNING'}, _iface("The script failed; the error was sent to the AI."))
        _redraw()
        return {'FINISHED'}


class ZINARIX_OT_ai_skip(bpy.types.Operator):
    """Do not run this script; tell the AI and let it try something else"""
    bl_idname = "zinarix.ai_skip"
    bl_label = "Skip"

    @classmethod
    def poll(cls, _context):
        return _state.pending is not None and not _state.busy

    def execute(self, context):
        _state.pending = None
        _state.last_failed = False  # Nothing ran: the scene is as the last good step left it.
        _continue(
            context,
            "The user skipped that script without running it; the scene did not change. "
            "Propose a different approach, or reply without a code block if the task should stop.",
        )
        _redraw()
        return {'FINISHED'}


class ZINARIX_OT_ai_reset(bpy.types.Operator):
    """Forget the conversation so the next request starts fresh"""
    bl_idname = "zinarix.ai_reset"
    bl_label = "Reset Conversation"

    def execute(self, _context):
        _stop()
        _state.history.clear()
        _state.step = 0
        _state.last_answer = ""
        _state.last_error = ""
        _state.last_failed = False
        _set_status("")
        _redraw()
        return {'FINISHED'}


_QUICK_ACTIONS = (
    ('DESCRIBE', "Describe the Scene", "Describe what is in the scene and suggest improvements", 'VIEWZOOM'),
    ('FIX', "Fix Last Error", "Ask the AI to fix the last error", 'ERROR'),
    ('LIGHTING', "Add Lighting", "Add good-looking lighting to the scene", 'LIGHT_SUN'),
    ('MATERIALS', "Realistic Materials", "Make the materials realistic", 'MATERIAL'),
    ('CAMERA', "Camera and Render", "Set up a camera and the render settings", 'CAMERA_DATA'),
)
_QUICK_PROMPTS = {
    'DESCRIBE': "Describe the scene: what is in it and what could be improved. Do not change anything.",
    'FIX': "Fix the last error.",
    'LIGHTING': "Add good-looking lighting to the scene (key, fill and rim lights, and a world background).",
    'MATERIALS': "Make the materials of the objects realistic, using Principled BSDF settings that suit each object.",
    'CAMERA': "Set up a camera that frames the whole scene nicely and configure the render settings for a good image.",
}


class ZINARIX_OT_ai_quick(bpy.types.Operator):
    """Fill the prompt with a common request"""
    bl_idname = "zinarix.ai_quick"
    bl_label = "Quick Action"
    bl_options = {'INTERNAL'}

    action: EnumProperty(items=tuple(a[:3] for a in _QUICK_ACTIONS))

    @classmethod
    def description(cls, _context, props):
        for key, _label, desc, _icon in _QUICK_ACTIONS:
            if props and key == props.action:
                return desc
        return cls.__doc__

    def execute(self, context):
        prompt = _iface(_QUICK_PROMPTS[self.action])
        if self.action == 'FIX' and _state.last_error:
            prompt += " " + _state.last_error.strip().splitlines()[-1][:300]
        context.window_manager.zinarix_ai_prompt = prompt
        return {'FINISHED'}


class ZINARIX_OT_ai_open_text(bpy.types.Operator):
    """Open the AI script or the last answer in a Text Editor"""
    bl_idname = "zinarix.ai_open_text"
    bl_label = "Open Text"

    which: EnumProperty(items=(
        ('CODE', "Script", "The script \"zinarix_ai.py\""),
        ('ANSWER', "Answer", "The last answer \"zinarix_ai_answer.md\""),
    ))

    @classmethod
    def poll(cls, _context):
        return CODE_TEXT in bpy.data.texts or ANSWER_TEXT in bpy.data.texts

    def execute(self, context):
        name = CODE_TEXT if self.which == 'CODE' else ANSWER_TEXT
        text = bpy.data.texts.get(name)
        if text is None:
            self.report({'WARNING'}, _iface("Nothing to show yet."))
            return {'CANCELLED'}
        if _show_text(text):
            return {'FINISHED'}
        # No Text Editor open: open one in a new window.
        try:
            before = set(context.window_manager.windows[:])
            bpy.ops.wm.window_new()
            new = [w for w in context.window_manager.windows if w not in before]
            if new:
                area = new[0].screen.areas[0]
                area.ui_type = 'TEXT_EDITOR'
                area.spaces.active.text = text
                return {'FINISHED'}
        except Exception:
            pass
        self.report({'INFO'}, _iface("Open a Text Editor to read \"{:s}\".").format(name))
        return {'FINISHED'}


class ZINARIX_OT_ai_refresh_models(bpy.types.Operator):
    """Ask the provider which models it offers and check the connection"""
    bl_idname = "zinarix.ai_refresh_models"
    bl_label = "Refresh Models"

    @classmethod
    def poll(cls, _context):
        return not _state.models_busy

    def execute(self, context):
        settings = _settings(context)
        if not hasattr(client, "list_models"):
            self.report({'WARNING'}, _iface("This version cannot list models; type the model id."))
            return {'CANCELLED'}
        if not _check_online(self, settings):
            return {'CANCELLED'}
        _state.models_busy = True
        _set_status(_iface("Looking for models..."))
        _start_thread(_models_worker, settings)
        return {'FINISHED'}


# -----------------------------------------------------------------------------
# Panel


def _wrap(text, width, max_lines=8):
    lines = []
    for para in (text or "").splitlines():
        words, line = para.split(), ""
        for word in words:
            while len(word) > width:  # Long tokens (paths, tracebacks).
                if line:
                    lines.append(line)
                    line = ""
                lines.append(word[:width])
                word = word[width:]
            if line and len(line) + 1 + len(word) > width:
                lines.append(line)
                line = word
            else:
                line = word if not line else line + " " + word
        if line:
            lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines - 1] + [lines[max_lines - 1][: max(0, width - 3)] + "..."]
    return lines


def _strip_code(text):
    """The answer without its code blocks (the code is shown separately)."""
    out, inside = [], False
    for line in (text or "").splitlines():
        if line.strip().startswith("```"):
            inside = not inside
            continue
        if not inside:
            out.append(line)
    return "\n".join(out).strip()


_ICONS = None


def _icon(*names):
    """First icon name this Blender knows (icon names change between versions)."""
    global _ICONS
    if _ICONS is None:
        _ICONS = set(bpy.types.UILayout.bl_rna.functions["label"].parameters["icon"].enum_items.keys())
    return next((n for n in names if n in _ICONS), 'NONE')


def _connection(settings):
    """``(ok, text)`` for the status row."""
    provider = settings["provider"]
    info = client.PROVIDERS[provider]
    model = settings["model"] or info.get("model") or ""
    if provider == "ZINARIX":
        if not _bridge_env():
            return False, _iface("Zinarix Studio not connected")
        if _state.bridge is True:
            return True, _iface("Zinarix Studio connected") + (" · " + model if model else "")
        if _state.bridge is False:
            return False, _iface("Zinarix Studio not connected")
        return None, _iface("Zinarix Studio") + (" · " + model if model else "")
    label = "{:s} · {:s}".format(info.get("label", provider), model or "?")
    if info.get("needs_key") and not settings["api_key"]:
        return False, label
    return True, label


class VIEW3D_PT_zinarix_ai(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Zinarix"
    bl_label = "Zinarix AI"

    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        settings = _settings(context)
        prefs = _prefs(context)
        width = max(20, int(context.region.width / (7.0 * (context.preferences.system.ui_scale or 1.0))) - 2)

        # Connection.
        ok, label = _connection(settings)
        row = layout.row(align=True)
        row.alert = ok is False
        icon = (_icon('STRIP_COLOR_04', 'SEQUENCE_COLOR_04', 'CHECKMARK') if ok
                else _icon('STRIP_COLOR_01', 'SEQUENCE_COLOR_01', 'ERROR') if ok is False
                else _icon('STRIP_COLOR_09', 'SEQUENCE_COLOR_09', 'QUESTION'))
        row.label(text=label, icon=icon, translate=False)
        row.operator(ZINARIX_OT_ai_refresh_models.bl_idname, text="", icon='FILE_REFRESH')
        if ok is False and settings["provider"] != "ZINARIX":
            layout.label(text="Add an API key in the add-on preferences", icon='ERROR')

        # Prompt.
        col = layout.column(align=True)
        col.prop(wm, "zinarix_ai_prompt", text="", icon='OUTLINER_DATA_LIGHTPROBE')
        row = col.row(align=True)
        row.scale_y = 1.4
        if _state.active:
            row.operator(ZINARIX_OT_ai_stop.bl_idname, icon='CANCEL')
        else:
            row.operator(ZINARIX_OT_ai_send.bl_idname, icon='PLAY')
        row.operator(ZINARIX_OT_ai_reset.bl_idname, text="", icon='TRASH')

        # Quick actions.
        flow = layout.grid_flow(row_major=True, columns=2, even_columns=True, align=True)
        flow.enabled = not _state.active
        for key, text, _desc, icon in _QUICK_ACTIONS:
            flow.operator(ZINARIX_OT_ai_quick.bl_idname, text=text, icon=icon).action = key

        # Loop state.
        row = layout.row()
        if _state.step:
            row.label(text=_iface("Step {:d}/{:d}").format(_state.step, _state.max_steps),
                      icon='SORTTIME' if _state.busy else 'LINENUMBERS_ON', translate=False)
        else:
            row.label(text="Ready", icon='LINENUMBERS_ON')
        if prefs is not None:
            row.prop(prefs, "auto_run", toggle=True, icon='AUTO')

        if _state.status:
            box = layout.box()
            box.alert = _state.status_kind == 'ERROR'
            col = box.column(align=True)
            lines = _wrap(_state.status, width, 6)
            icon = {'ERROR': 'ERROR', 'DONE': 'CHECKMARK'}.get(_state.status_kind, 'INFO')
            for i, line in enumerate(lines):
                col.label(text=line, icon=icon if i == 0 else 'BLANK1', translate=False)

        # Pending script.
        pending = _state.pending
        if pending is not None:
            box = layout.box()
            header = box.row()
            header.label(text="Script waiting for approval", icon='SCRIPT')
            header.operator(ZINARIX_OT_ai_open_text.bl_idname, text="", icon='WINDOW').which = 'CODE'
            if pending["risky"]:
                warn = box.row()
                warn.alert = True
                warn.label(text=_iface("Uses: {:s}").format(", ".join(pending["risky"])),
                           icon='ERROR', translate=False)
            code_col = box.column(align=True)
            code_col.scale_y = 0.8
            code_lines = pending["code"].rstrip().splitlines()
            for line in code_lines[:PREVIEW_LINES]:
                code_col.label(text=line[:width].replace("\t", "    ") or " ", translate=False)
            if len(code_lines) > PREVIEW_LINES:
                code_col.label(text=_iface("... {:d} more lines").format(len(code_lines) - PREVIEW_LINES),
                               translate=False)
            row = box.row(align=True)
            row.scale_y = 1.3
            row.operator(ZINARIX_OT_ai_run.bl_idname, icon='PLAY')
            row.operator(ZINARIX_OT_ai_skip.bl_idname, icon='FORWARD')

        # Last answer.
        answer = _strip_code(_state.last_answer)
        if answer:
            box = layout.box()
            header = box.row()
            header.label(text="Last Answer", icon='TEXT')
            header.operator(ZINARIX_OT_ai_open_text.bl_idname, text="", icon='WINDOW').which = 'ANSWER'
            col = box.column(align=True)
            for line in _wrap(answer, width, 10):
                col.label(text=line, translate=False)

        row = layout.row(align=True)
        row.operator(ZINARIX_OT_ai_open_text.bl_idname, text="Open Script", icon='SCRIPT').which = 'CODE'
        row.operator(ZINARIX_OT_ai_open_text.bl_idname, text="Open Answer", icon='TEXT').which = 'ANSWER'


# -----------------------------------------------------------------------------
# Translations: translations.py (if present) owns them; a minimal Spanish set otherwise.

_FALLBACK_TRANSLATIONS = {
    "es": {
        ("*", "Send"): "Enviar",
        ("*", "Stop"): "Detener",
        ("*", "Run Step"): "Ejecutar paso",
        ("*", "Skip"): "Omitir",
        ("*", "Reset Conversation"): "Reiniciar conversación",
        ("*", "Auto-run"): "Ejecución automática",
        (I18N_CONTEXT, "Max Steps"): "Pasos máximos",
        (I18N_CONTEXT, "Prompt"): "Solicitud",
        ("*", "Provider"): "Proveedor",
        ("*", "Model"): "Modelo",
        ("*", "Server URL"): "URL del servidor",
        ("*", "API Key"): "Clave de API",
        ("*", "Max Tokens"): "Tokens máximos",
        ("*", "Zinarix Studio connected"): "Zinarix Studio conectado",
        ("*", "Step {:d}/{:d}"): "Paso {:d}/{:d}",
        ("*", "Add an API key in the add-on preferences"): "Agrega una clave de API en las preferencias del complemento",
    },
}


def _translations_dict():
    try:
        from . import translations
        return translations.translations_dict
    except (ImportError, AttributeError):
        return _FALLBACK_TRANSLATIONS


classes = (
    ZinarixAIPreferences,
    ZINARIX_OT_ai_send,
    ZINARIX_OT_ai_stop,
    ZINARIX_OT_ai_run,
    ZINARIX_OT_ai_skip,
    ZINARIX_OT_ai_reset,
    ZINARIX_OT_ai_quick,
    ZINARIX_OT_ai_open_text,
    ZINARIX_OT_ai_refresh_models,
    VIEW3D_PT_zinarix_ai,
)


def register():
    global _state, _results
    old_run_id = _state.run_id
    _state = _State()
    _state.run_id = old_run_id + 1  # Threads from a previous registration never match.
    _results = queue.Queue()
    _alive[0] = True
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.WindowManager.zinarix_ai_prompt = StringProperty(
        name="Prompt",
        description="What you want, e.g. \"add a low-poly tree next to the cube\"",
        options={'SKIP_SAVE'},
        translation_context=I18N_CONTEXT,
    )
    try:
        bpy.app.translations.register(__package__, _translations_dict())
    except Exception as ex:  # Already registered (reload) or a bad dictionary.
        print("Zinarix AI: translations not registered:", ex)
    if _on_load_pre not in bpy.app.handlers.load_pre:
        bpy.app.handlers.load_pre.append(_on_load_pre)
    if "ZINARIX" in client.PROVIDERS and _bridge_env() and hasattr(client, "bridge_available"):
        _start_thread(_bridge_worker)


def unregister():
    _alive[0] = False  # Late worker results are dropped.
    _state.run_id += 1
    _state.busy = _state.active = _state.models_busy = False
    if bpy.app.timers.is_registered(_poll):
        bpy.app.timers.unregister(_poll)
    if _on_load_pre in bpy.app.handlers.load_pre:
        bpy.app.handlers.load_pre.remove(_on_load_pre)
    try:
        bpy.app.translations.unregister(__package__)
    except Exception:
        pass
    del bpy.types.WindowManager.zinarix_ai_prompt
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
