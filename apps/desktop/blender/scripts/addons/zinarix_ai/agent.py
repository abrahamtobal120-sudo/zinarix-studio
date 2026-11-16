# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Agent brain for Zinarix AI: look at the scene, run code, read the result.

The UI module drives the loop (threads, operators, timers). This module only
builds the prompts, describes the scene, runs code and formats the feedback.

``bpy`` is imported lazily so the pure string helpers (prompt, feedback,
``is_final``, traceback trimming, truncation) can be tested with plain Python.
"""

__all__ = (
    "MAX_STEPS",
    "CODE_FILENAME",
    "build_system_prompt",
    "describe_scene",
    "run_code",
    "feedback_message",
    "is_final",
    "capture_viewport",
    "truncate_tail",
    "format_exception",
)

import contextlib
import io
import os
import traceback

try:
    from . import client
except ImportError:  # Plain Python tests import this file as a top-level module.
    import client

MAX_STEPS = 8
CODE_FILENAME = "<zinarix_ai>"
MAX_OUTPUT = 4000
MAX_ERROR = 3000


# -----------------------------------------------------------------------------
# Pure helpers (no bpy)


def _is_es(lang):
    return str(lang or "").lower().startswith("es")


def truncate_tail(text, limit=MAX_OUTPUT):
    """Keep the last ``limit`` characters of ``text`` (the tail is the useful part)."""
    text = text or ""
    if len(text) <= limit:
        return text
    cut = len(text) - limit
    tail = text[cut:]
    # Start at a line boundary when one is close, to avoid a half line.
    nl = tail.find("\n")
    if 0 <= nl < 200:
        tail = tail[nl + 1:]
    return "[... {:d} characters truncated ...]\n{:s}".format(len(text) - len(tail), tail)


def format_exception(exc, code="", filename=CODE_FILENAME):
    """Return a short traceback: only frames of the generated code + the exception line.

    ``code`` is the source that was compiled as ``filename``; it provides the
    source lines, since ``linecache`` does not know the pseudo file name.
    """
    lines = code.splitlines() if code else []
    out = []
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == filename]
    if frames:
        out.append("Traceback (most recent call last):")
        for frame in frames:
            out.append('  File "{:s}", line {:d}, in {:s}'.format(filename, frame.lineno or 0, frame.name))
            src = ""
            if frame.lineno and 0 < frame.lineno <= len(lines):
                src = lines[frame.lineno - 1].strip()
            if src:
                out.append("    " + src)
    if isinstance(exc, SyntaxError):
        # format_exception_only already shows file, line, source and caret.
        if exc.text is None and exc.lineno and 0 < exc.lineno <= len(lines):
            exc.text = lines[exc.lineno - 1] + "\n"
        out.extend(s.rstrip("\n") for s in traceback.format_exception_only(type(exc), exc))
    else:
        out.append("".join(traceback.format_exception_only(type(exc), exc)).rstrip("\n"))
    text = "\n".join(out)
    if len(text) > MAX_ERROR:
        text = text[:MAX_ERROR // 3] + "\n[...]\n" + text[-(MAX_ERROR * 2 // 3):]
    return text


def _version_string():
    try:
        import bpy
        return bpy.app.version_string
    except Exception:
        return "4.2+"


def _version_tuple():
    try:
        import bpy
        return tuple(bpy.app.version)
    except Exception:
        return None


def build_system_prompt(lang, auto_run):
    """System prompt for the agent loop. ``lang`` is "es" or "en"."""
    version = _version_string()
    vt = _version_tuple()
    if vt is None:
        eevee = "'BLENDER_EEVEE_NEXT' in 4.2-4.x, 'BLENDER_EEVEE' in 5.x (check bpy.app.version)"
    elif vt[0] >= 5:
        eevee = "'BLENDER_EEVEE' (this is 5.x; 4.2-4.x used 'BLENDER_EEVEE_NEXT')"
    else:
        eevee = "'BLENDER_EEVEE_NEXT' (this is 4.x; 5.x uses 'BLENDER_EEVEE')"
    language = "Spanish" if _is_es(lang) else "English"
    if auto_run:
        run_note = "Your code runs automatically as soon as you send it; you then get the result."
    else:
        run_note = "The user reviews each code block and runs it; you then get the result."

    return "\n".join((
        "You are the AI agent inside Zinarix Studio 3D, a 3D app built on Blender {:s}. "
        "You control it directly through its Python API (bpy) and can do anything a user "
        "can do: modeling, materials, lighting, cameras, animation, rendering setup.".format(version),
        "",
        "How it works:",
        "- Each turn, reply with AT MOST ONE ```python code block. " + run_note,
        "- The code runs inside Blender's main thread in a fresh namespace (bpy, mathutils and "
        "bmesh are importable). You get back its stdout and any error with a traceback.",
        "- Use print() to inspect the scene or check results; you only see what you print.",
        "- Work in small steps: inspect, act, verify. If an error comes back, fix it and retry.",
        "- When the task is done, reply WITHOUT any code block and summarize briefly what was done.",
        "- Write explanations, the final summary and code comments in {:s}.".format(language),
        "",
        "Rules:",
        "- Prefer bpy.data and object/mesh APIs over bpy.ops (operators depend on the editor context).",
        "- Never read, write or delete files outside the current .blend / bpy.path unless the user asks.",
        "- No network access, no subprocess, no os.system, no installing packages.",
        "- Do not quit Blender, save over files or reset the scene unless asked. Name new data clearly.",
        "",
        "bpy 4.x/5.x notes:",
        "- Principled BSDF inputs: 'Base Color', 'Metallic', 'Roughness', 'Specular IOR Level', "
        "'Emission Color', 'Emission Strength', 'Transmission Weight', 'Coat Weight', "
        "'Subsurface Weight', 'Alpha'. Old names 'Emission', 'Specular', 'Transmission' fail.",
        "- Look up nodes by type, e.g. next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').",
        "- New objects: bpy.data.objects.new(name, data) then collection.objects.link(ob) "
        "(e.g. bpy.context.scene.collection or bpy.context.collection).",
        "- After changing transforms or data, call bpy.context.view_layer.update() before "
        "reading matrix_world or evaluated data.",
        "- EEVEE engine id: " + eevee + ". Cycles is 'CYCLES'.",
        "- If you must use an operator that needs an editor, find the area and use "
        "with bpy.context.temp_override(window=win, area=area, region=region): ...",
        "- Rotations are radians (math.radians). Use mathutils.Vector / Matrix for math.",
        "- For mesh editing prefer bmesh (bm = bmesh.new(); bm.from_mesh(me); ...; bm.to_mesh(me); bm.free()).",
    ))


def feedback_message(result, lang):
    """Next user message for the model, built from a ``run_code`` result."""
    es = _is_es(lang)
    output = (result.get("output") or "").strip()
    error = result.get("error")
    parts = []
    if result.get("ok"):
        parts.append("El código se ejecutó correctamente." if es else "The code ran successfully.")
        if output:
            parts.append(("Salida:\n" if es else "Output:\n") + output)
        else:
            parts.append("(Sin salida. Usa print() para inspeccionar.)" if es
                         else "(No output. Use print() to inspect.)")
        parts.append(
            "Continúa con el siguiente paso, o si la tarea está terminada responde sin bloque de "
            "código con un resumen de lo que hiciste." if es else
            "Continue with the next step, or if the task is done reply without a code block "
            "and summarize what you did."
        )
    else:
        parts.append("El código falló." if es else "The code failed.")
        if output:
            parts.append(("Salida antes del error:\n" if es else "Output before the error:\n") + output)
        parts.append("Error:\n" + (error or "unknown error"))
        parts.append(
            "Corrige el problema y envía el código corregido, o si no se puede hacer responde sin "
            "bloque de código explicando por qué." if es else
            "Fix the problem and send corrected code, or if it cannot be done reply without a "
            "code block explaining why."
        )
    return "\n\n".join(parts)


def is_final(reply):
    """True when the reply contains no fenced Python code block."""
    reply = reply or ""
    if "```" not in reply:
        return True
    # extract_code returns the text itself when there is no python block.
    return client.extract_code(reply).strip() == reply.strip()


# -----------------------------------------------------------------------------
# Blender helpers (need bpy, call on the main thread)


def _r(values, nd=3):
    return "(" + ", ".join("{:g}".format(round(v, nd)) for v in values) + ")"


def _collection_tree(coll, depth, out, limit=40):
    if len(out) >= limit:
        return
    out.append("{:s}- {:s} ({:d} objects){:s}".format(
        "  " * depth, coll.name, len(coll.objects),
        "" if not getattr(coll, "hide_render", False) else " hidden-render",
    ))
    for child in coll.children:
        _collection_tree(child, depth + 1, out, limit)


def describe_scene(context, max_objects=60):
    """Compact, read-only text description of the current scene."""
    import bpy
    import math

    scene = context.scene
    render = scene.render
    units = scene.unit_settings
    lines = [
        "Zinarix Studio 3D (Blender {:s})".format(bpy.app.version_string),
        "File: {:s}".format(bpy.path.basename(bpy.data.filepath) or "(unsaved)"),
        "Scene: {!r}, mode {:s}, frames {:d}-{:d} (current {:d}), fps {:g}".format(
            scene.name, context.mode, scene.frame_start, scene.frame_end, scene.frame_current,
            render.fps / (render.fps_base or 1.0),
        ),
        "Render: engine {:s}, {:d}x{:d} at {:d}%".format(
            render.engine, render.resolution_x, render.resolution_y, render.resolution_percentage,
        ),
        "Camera: {:s}".format(repr(scene.camera.name) if scene.camera else "none"),
        "Units: {:s}, length {:s}, scale {:g}".format(
            units.system, getattr(units, "length_unit", "-"), units.scale_length,
        ),
    ]
    world = scene.world
    if world is not None:
        color = getattr(world, "color", None)
        lines.append("World: {!r}{:s}".format(
            world.name, ", color " + _r(color) if color is not None else "",
        ))
    else:
        lines.append("World: none")

    view_layer = context.view_layer
    active = view_layer.objects.active if view_layer else None
    lines.append("Active object: {:s}".format(repr(active.name) if active else "none"))
    selected = [ob.name for ob in scene.objects if ob.select_get()] if view_layer else []
    lines.append("Selected: {:s}".format(", ".join(repr(n) for n in selected[:20]) or "none")
                 + (" ... {:d} more".format(len(selected) - 20) if len(selected) > 20 else ""))

    lines.append("Collections:")
    tree = []
    _collection_tree(scene.collection, 1, tree)
    lines.extend(tree)

    objects = list(scene.objects)
    lines.append("Objects ({:d}):".format(len(objects)))
    for ob in objects[:max_objects]:
        rot = [math.degrees(a) for a in ob.rotation_euler]
        info = "- {!r} {:s} loc {:s} rot_deg {:s} scale {:s}".format(
            ob.name, ob.type, _r(ob.location), _r(rot, 1), _r(ob.scale),
        )
        if ob.parent:
            info += " parent {!r}".format(ob.parent.name)
        if ob.type == 'MESH' and ob.data is not None:
            info += " verts {:d} faces {:d}".format(len(ob.data.vertices), len(ob.data.polygons))
        elif ob.type == 'LIGHT' and ob.data is not None:
            info += " light {:s} {:g}W".format(ob.data.type, ob.data.energy)
        elif ob.type == 'CAMERA' and ob.data is not None:
            info += " lens {:g}mm".format(ob.data.lens)
        if ob.modifiers:
            info += " mods [{:s}]".format(", ".join(
                "{:s}:{:s}".format(m.name, m.type) for m in ob.modifiers))
        mats = [s.material.name for s in getattr(ob, "material_slots", ()) if s.material]
        if mats:
            info += " mats [{:s}]".format(", ".join(mats))
        if ob.hide_get() if view_layer else False:
            info += " hidden"
        lines.append(info)
    if len(objects) > max_objects:
        lines.append("- ... {:d} more".format(len(objects) - max_objects))
    return "\n".join(lines)


def run_code(code):
    """Run ``code`` in a fresh namespace. MUST be called on Blender's main thread.

    Returns ``{"ok": bool, "output": str, "error": str | None}``.
    """
    import bpy

    namespace = {"bpy": bpy, "__name__": "__zinarix_ai__"}
    try:
        import mathutils
        import bmesh
        namespace["mathutils"] = mathutils
        namespace["bmesh"] = bmesh
    except ImportError:
        pass

    buffer = io.StringIO()
    error = None
    try:
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
            compiled = compile(code, CODE_FILENAME, "exec")
            exec(compiled, namespace)
    except BaseException as ex:  # Also SystemExit / KeyboardInterrupt raised by the code.
        error = format_exception(ex, code)

    ok = error is None
    if ok:
        try:
            bpy.ops.ed.undo_push(message="Zinarix AI")
        except Exception:
            pass
    return {"ok": ok, "output": truncate_tail(buffer.getvalue()), "error": error}


def capture_viewport(path):
    """Screenshot the first 3D viewport to a PNG at ``path``. False on failure."""
    try:
        import bpy
        wm = bpy.context.window_manager
        for window in wm.windows:
            for area in window.screen.areas:
                if area.type != 'VIEW_3D':
                    continue
                region = next((r for r in area.regions if r.type == 'WINDOW'), None)
                with bpy.context.temp_override(window=window, screen=window.screen,
                                               area=area, region=region):
                    result = bpy.ops.screen.screenshot_area(filepath=path)
                return 'FINISHED' in result and os.path.isfile(path)
    except Exception:
        pass
    return False
