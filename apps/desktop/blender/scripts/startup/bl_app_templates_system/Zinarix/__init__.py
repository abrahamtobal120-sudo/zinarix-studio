# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Zinarix Studio 3D: the face Zinarix puts on Blender.

An application template (no rebuild needed). Zinarix Studio launches Blender with
``--app-template Zinarix`` and ``BLENDER_SYSTEM_SCRIPTS`` pointing at the folder
that holds this template and the ``zinarix_ai`` add-on. Blender keeps the
preferences of a template apart, so a normal Blender on the same PC is untouched.

What it changes:
- Theme: the app's colors over Blender's dark or light theme, rounder widgets and panels, a
  radial viewport background and a plain navigation axis.
- New files: no status bar or tool settings row, viewport menus folded into one button, no
  corner text or 3D cursor.
- Top bar: a "Zinarix" menu instead of the Blender one, and fewer menus.
- Splash: Zinarix image and its own quick start.
- Workspaces: only the useful ones, with names in the user's language.
- The ``zinarix_ai`` add-on is enabled and its "Zinarix" tab is open in the sidebar of the
  3D View of the main workspace.
- First start only: interface language, autosave, more undo steps, and the AI runs its own
  scripts (risky ones still ask). Later launches never
  overwrite what the user chose (a marker in the config folder remembers what was set).

Every UI override is put back by ``unregister()``. The template never uses the network.

``ZINARIX_LANG`` ("es" or "en") picks the interface language. ``ZINARIX_LOOK`` (JSON:
``dark``, ``bg``, ``fg``, ``accent``) gives the app's current theme colors, so a light app
opens a light Zinarix 3D. On Windows the window title and icon are Zinarix's too.
"""

import colorsys
import json
import os
import re
import sys

import bpy
from bpy.app.handlers import persistent

LANG = "en" if os.environ.get("ZINARIX_LANG", "es").lower().startswith("en") else "es"


def _css_rgb(text):
    """'#rgb', '#rrggbb' or 'rgb(r, g, b)' as floats 0..1; None if it is something else."""
    text = (text or "").strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?", text)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    m = re.fullmatch(r"rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+).*\)", text)
    if m:
        return tuple(min(255, int(x)) / 255 for x in m.groups())
    return None


def _read_look():
    """The app's theme (ZINARIX_LOOK); the app's own dark theme when missing or broken."""
    look = {"dark": True, "bg": "#1b1b1f", "fg": "#d6d6dc", "accent": "#6d5ef6"}
    try:
        given = json.loads(os.environ.get("ZINARIX_LOOK") or "{}")
        if isinstance(given, dict):
            look.update({k: v for k, v in given.items() if k in look})
    except ValueError:
        pass
    dark = bool(look["dark"])
    accent = _css_rgb(look["accent"]) or (0.427, 0.369, 0.965)
    bg = _css_rgb(look["bg"]) or ((0.106, 0.106, 0.122) if dark else (1.0, 1.0, 1.0))
    ah, asat, _ = colorsys.rgb_to_hsv(*accent)
    bh, bsat, _ = colorsys.rgb_to_hsv(*bg)
    return {
        "dark": dark,
        "accent_hue": ah,
        "accent_sat": max(asat, 0.45),
        # Grays take the app background's cast (a faint accent cast when it is pure gray).
        "gray_hue": bh if bsat > 0.03 else ah,
        "gray_sat": min(max(bsat, 0.06 if dark else 0.03), 0.18 if dark else 0.08),
        "bg": bg,
    }


LOOK = _read_look()

T = {
    "es": {
        "about": "Acerca de Zinarix Studio 3D",
        "splash": "Pantalla de inicio",
        "prefs": "Preferencias",
        "system": "Sistema",
        "manual": "Manual",
        "new": "Escena nueva",
        "open": "Abrir…",
        "recover": "Recuperar última sesión",
        "empty": "Escena vacía",
        "recent": "Recientes",
        "no_recent": "Todavía no hay archivos recientes.",
        "start": "Nuevo",
        "ai": "Pedirle algo a la IA",
        "ai_hint": "Panel Zinarix AI: barra lateral del visor (tecla N)",
        "based": "Basado en Blender {:s}, software libre (GNU GPL).",
        "credit": "Blender es una marca de la Blender Foundation.",
        "help": "Ayuda",
        "continue": "Continuar",
    },
    "en": {
        "about": "About Zinarix Studio 3D",
        "splash": "Splash Screen",
        "prefs": "Preferences",
        "system": "System",
        "manual": "Manual",
        "new": "New Scene",
        "open": "Open…",
        "recover": "Recover Last Session",
        "empty": "Empty Scene",
        "recent": "Recent",
        "no_recent": "No recent files yet.",
        "start": "New",
        "ai": "Ask the AI",
        "ai_hint": "Zinarix AI panel: viewport sidebar (N key)",
        "based": "Based on Blender {:s}, free software (GNU GPL).",
        "credit": "Blender is a trademark of the Blender Foundation.",
        "help": "Help",
        "continue": "Continue",
    },
}[LANG]

# Workspaces kept, in order, with their Zinarix names. The rest are removed from new files.
WORKSPACES = {
    "Layout": {"es": "Escena", "en": "Scene"},
    "Modeling": {"es": "Modelado", "en": "Modeling"},
    "Sculpting": {"es": "Escultura", "en": "Sculpting"},
    "Shading": {"es": "Materiales", "en": "Materials"},
    "Animation": {"es": "Animación", "en": "Animation"},
    "Rendering": {"es": "Render", "en": "Render"},
}

# Rounder widgets and panels than Blender's (0.2-0.4): the app's pill buttons and soft cards.
ROUNDNESS = 0.55
PANEL_ROUNDNESS = 0.8

AI_ADDON = "zinarix_ai"
AI_TAB = "Zinarix"
# On the splash. Literal English on purpose: the Zinarix i18n phase translates it.
AI_HINT = "Ask the AI: press N → Zinarix"

# Spanish for the template's English literals: AI_HINT always, and the English T texts in case
# Blender's interface is switched to Spanish while ZINARIX_LANG is "en". Blender calls Spanish
# "es" (4.2-5.x); "es_ES" too, as _language_id() asks for it first.
_ES = {("*", AI_HINT): "Pregúntale a la IA: presiona N → Zinarix"}
for _en, _es in (
    ("About Zinarix Studio 3D", "Acerca de Zinarix Studio 3D"),
    ("Splash Screen", "Pantalla de inicio"),
    ("New Scene", "Escena nueva"),
    ("Open…", "Abrir…"),
    ("Recover Last Session", "Recuperar última sesión"),
    ("Empty Scene", "Escena vacía"),
    ("Recent", "Recientes"),
    ("No recent files yet.", "Todavía no hay archivos recientes."),
    ("New", "Nuevo"),
    ("Ask the AI", "Pedirle algo a la IA"),
    ("Zinarix AI panel: viewport sidebar (N key)", "Panel Zinarix AI: barra lateral del visor (tecla N)"),
    ("Blender is a trademark of the Blender Foundation.", "Blender es una marca de la Blender Foundation."),
    ("Help", "Ayuda"),
    ("Continue", "Continuar"),
    ("Zinarix Studio 3D and the Blender version it is built on",
     "Zinarix Studio 3D y la versión de Blender en la que se basa"),
    ("Open the Zinarix AI panel in the 3D View sidebar",
     "Abre el panel Zinarix AI en la barra lateral de la Vista 3D"),
):
    _ES[("*", _en)] = _ES[("Operator", _en)] = _es
TRANSLATIONS = {"es": _ES, "es_ES": _ES}
del _en, _es


# -----------------------------------------------------------------------------
# Theme


def _tint(color):
    """Blender's blue/orange highlights take the app's accent; grays take the app's cast."""
    rgb = tuple(color[:3])
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    if s < 0.12:
        if v <= 0.02 or v >= 0.98:
            return None
        if LOOK["dark"]:
            # Dark surfaces get darker and cooler, like the app; light text stays neutral.
            s2 = LOOK["gray_sat"] * max(0.0, 1.0 - max(0.0, v - 0.45) * 2.0)
            v2 = v * 0.8 if v < 0.45 else v
        else:
            # Light surfaces get a bit brighter with a faint cast; dark text stays neutral.
            s2 = LOOK["gray_sat"] * max(0.0, min(1.0, (v - 0.35) * 2.0))
            v2 = min(1.0, v * 1.06) if v > 0.5 else v
        return colorsys.hsv_to_rgb(LOOK["gray_hue"], s2, v2)
    # Blender's accents: the selection blue (~0.6) and the active orange (~0.08).
    if 0.53 <= h <= 0.66 or 0.04 <= h <= 0.13:
        v2 = max(v, 0.45) if LOOK["dark"] else min(max(v, 0.45), 0.85)
        return colorsys.hsv_to_rgb(LOOK["accent_hue"], max(s, LOOK["accent_sat"]), v2)
    return None


def _walk_theme(struct, seen):
    if struct is None:
        return
    # A nested struct can share its parent's address (first member): key by type too.
    key = (struct.as_pointer(), struct.bl_rna.identifier)
    if key in seen:
        return
    seen.add(key)
    for prop in struct.bl_rna.properties:
        pid = prop.identifier
        if pid == "rna_type":
            continue
        if prop.type == 'POINTER':
            _walk_theme(getattr(struct, pid, None), seen)
        elif prop.type == 'COLLECTION':
            for item in getattr(struct, pid, ()):
                _walk_theme(item, seen)
        elif (
            prop.type == 'FLOAT'
            and prop.subtype in {'COLOR', 'COLOR_GAMMA'}
            and prop.array_length in {3, 4}
            and not prop.is_readonly
        ):
            value = getattr(struct, pid)
            rgb = _tint(value)
            if rgb is not None:
                setattr(struct, pid, (*rgb, value[3]) if prop.array_length == 4 else rgb)


def _light_theme_path():
    """Blender's own "Blender Light" preset. preset_find misses it when BLENDER_SYSTEM_SCRIPTS
    points at Zinarix's scripts, so it also looks next to the bpy module (<ver>/scripts)."""
    path = bpy.utils.preset_find("Blender_Light", "interface_theme")
    if path:
        return path
    bundled = os.path.dirname(os.path.dirname(os.path.dirname(bpy.__file__)))
    for root in (*bpy.utils.script_paths(), bundled):
        path = os.path.join(root, "presets", "interface_theme", "Blender_Light.xml")
        if os.path.isfile(path):
            return path
    return None


def apply_theme():
    """Starts from Blender's dark or light theme (as the app is) every time, so applying twice
    changes nothing."""
    try:
        bpy.ops.preferences.reset_default_theme()
        if not LOOK["dark"]:
            path = _light_theme_path()
            if path:
                bpy.ops.script.execute_preset(
                    filepath=path, menu_idname="USERPREF_MT_interface_theme_presets"
                )
            else:
                print("Zinarix: the light theme preset is missing")
    except RuntimeError as ex:
        print("Zinarix: could not reset the theme:", ex)
        return
    _walk_theme(bpy.context.preferences.themes[0], set())
    theme = bpy.context.preferences.themes[0]
    _round_widgets(theme.user_interface)
    _viewport_background(theme)
    view = bpy.context.preferences.view
    # Otherwise the status bar shows Blender's version.
    _set(view, "show_statusbar_version", False)
    # A small plain axis instead of Blender's colored navigation ball.
    _set(view, "mini_axis_type", 'MINIMAL')


def _round_widgets(ui):
    for prop in ui.bl_rna.properties:
        if prop.type == 'POINTER':
            widget = getattr(ui, prop.identifier, None)
            if widget is not None and hasattr(widget, "roundness"):
                _set(widget, "roundness", ROUNDNESS)
    _set(ui, "panel_roundness", PANEL_ROUNDNESS)


def _shade(rgb, factor):
    return tuple(min(1.0, max(0.0, c * factor)) for c in rgb)


def _viewport_background(theme):
    """A soft radial glow in the app's background color instead of Blender's flat gray."""
    grad = getattr(theme.view_3d.space, "gradients", None)
    if grad is None:
        return
    bg = LOOK["bg"]
    accent = colorsys.hsv_to_rgb(LOOK["accent_hue"], LOOK["accent_sat"], 1.0)
    if LOOK["dark"]:
        center = tuple(b * 1.5 + a * 0.05 for b, a in zip(_shade(bg, 1.0), accent))
        edge = _shade(bg, 0.7)
    else:
        center = tuple(min(1.0, b * 1.02) for b in bg)
        edge = tuple(b * 0.86 + a * 0.04 for b, a in zip(bg, accent))
    _set(grad, "background_type", 'RADIAL')
    _set(grad, "high_gradient", center)
    _set(grad, "gradient", edge)


# -----------------------------------------------------------------------------
# First start: language and preferences

SETUP_FILE = "zinarix_setup.json"
UNDO_STEPS = 64
AUTOSAVE_MINUTES = 2


def _language_id():
    """The Blender locale for ``ZINARIX_LANG`` (identifiers vary a little between versions)."""
    view = bpy.context.preferences.view
    items = {item.identifier for item in view.bl_rna.properties["language"].enum_items}
    wanted = ("es_ES", "es") if LANG == "es" else ("en_US", "en_GB")
    return next((lang for lang in wanted if lang in items), None)


def _config_dir():
    try:
        return bpy.utils.user_resource('CONFIG') or ""
    except Exception:  # Odd setups: no marker, never an error.
        return ""


def _setup_path():
    folder = _config_dir()
    return os.path.join(folder, SETUP_FILE) if folder else ""


def _prefs_saved():
    """True once Blender wrote the preferences (only then can they hold the user's choices)."""
    folder = _config_dir()
    return bool(folder) and any(
        os.path.isfile(os.path.join(folder, *sub, "userpref.blend")) for sub in ((), ("Zinarix",))
    )


def _read_setup():
    path = _setup_path()
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_setup(data):
    if getattr(bpy.app, "factory_startup", False):
        return  # Factory settings are never saved: a marker would skip the real first start.
    path = _setup_path()
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
    except OSError as ex:
        print("Zinarix: could not save the first start marker:", ex)


def _set(struct, name, value):
    """Sets a preference if this Blender has it (some come and go between 4.2 and 5.x)."""
    if struct is None or not hasattr(struct, name):
        return
    try:
        setattr(struct, name, value)
    except (AttributeError, TypeError, ValueError):
        pass


def apply_language():
    """Interface in the user's language. Data names stay English (scripts and the AI use them).
    Returns the language now set."""
    view = bpy.context.preferences.view
    lang = _language_id()
    if lang is None or not bpy.app.build_options.international:
        return view.language
    _set(view, "language", lang)
    _set(view, "use_translate_interface", True)
    _set(view, "use_translate_tooltips", True)
    _set(view, "use_translate_reports", True)
    _set(view, "use_translate_new_dataname", False)
    return view.language


def apply_defaults():
    prefs = bpy.context.preferences
    _set(prefs.view, "show_splash", True)
    _set(prefs.view, "show_extensions_updates", False)
    _set(prefs.filepaths, "use_auto_save_temporary_files", True)
    _set(prefs.filepaths, "auto_save_time", AUTOSAVE_MINUTES)
    if getattr(prefs.edit, "undo_steps", UNDO_STEPS) < UNDO_STEPS:
        _set(prefs.edit, "undo_steps", UNDO_STEPS)
    # No "allow online access?" nag. Online access itself keeps Blender's default (off): the AI
    # add-on works with local models, and it can be turned on in Preferences > System.
    _set(getattr(prefs, "extensions", None), "use_online_access_handled", True)
    _set(prefs.filepaths, "use_extension_online_access_handled", True)


def first_start_setup():
    """Language and preferences on the first start only, never over the user's own choices.

    - No marker, or the preferences were never saved: Zinarix defaults and ``ZINARIX_LANG``.
    - ``ZINARIX_LANG`` changed since: the new language, unless the user picked another one.
    - Otherwise nothing. Returns True if something was set.
    """
    prefs = bpy.context.preferences
    state = _read_setup()
    if state is None or not _prefs_saved():
        apply_defaults()
        language = apply_language()
    elif state.get("lang") != LANG and prefs.view.language == state.get("language"):
        language = apply_language()
    else:
        return False
    _set(prefs, "is_dirty", True)  # Saved with the preferences when Blender quits.
    _write_setup({**(state or {}), "lang": LANG, "language": language})
    return True


def ai_acts_alone():
    """Once: the AI runs its own scripts (it moves and builds things itself). Scripts that touch
    files, processes or the network still ask. Never over the user's later choice."""
    state = _read_setup() or {}
    if state.get("ai_auto_run"):
        return False
    addon = bpy.context.preferences.addons.get(AI_ADDON)
    prefs = getattr(addon, "preferences", None)
    if prefs is None or not hasattr(prefs, "auto_run"):
        return False
    prefs.auto_run = True
    _set(bpy.context.preferences, "is_dirty", True)
    _write_setup({**state, "ai_auto_run": True})
    return True


# -----------------------------------------------------------------------------
# Window title and icon (Windows). Blender writes "Blender" in the title on every change, so a
# timer puts Zinarix back. user32 through ctypes: part of Windows, nothing to install.

_TITLE_RE = re.compile(r"Blender(?: \d+\.\d+(?:\.\d+)?)?")
_win = None


def _win_setup():
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.LoadImageW.restype = wintypes.HANDLE
    user32.LoadImageW.argtypes = [
        wintypes.HINSTANCE,
        wintypes.LPCWSTR,
        wintypes.UINT,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    icons = {}
    ico = os.path.join(os.path.dirname(__file__), "zinarix.ico")
    if os.path.isfile(ico):
        # ICON_BIG (1) at SM_CXICON (11), ICON_SMALL (0) at SM_CXSMICON (49).
        for kind, metric in ((1, 11), (0, 49)):
            size = user32.GetSystemMetrics(metric)
            handle = user32.LoadImageW(None, ico, 1, size, size, 0x10)  # IMAGE_ICON, from file
            if handle:
                icons[kind] = handle
    return {
        "ctypes": ctypes,
        "wintypes": wintypes,
        "user32": user32,
        "enum_proc": enum_proc,
        "icons": icons,
        "iconed": set(),
        "pid": os.getpid(),
    }


def _brand_windows():
    """Timer: Zinarix title and icon on this Blender's windows. Stops itself on any error."""
    global _win
    try:
        if _win is None:
            _win = _win_setup()
        w = _win
        ctypes, wintypes, user32 = w["ctypes"], w["wintypes"], w["user32"]
        found = []

        def each(hwnd, _lparam):
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value == w["pid"] and user32.IsWindowVisible(hwnd):
                found.append(hwnd)
            return True

        user32.EnumWindows(w["enum_proc"](each), 0)
        for hwnd in found:
            n = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if "Blender" in buf.value:
                user32.SetWindowTextW(hwnd, _TITLE_RE.sub("Zinarix Studio 3D", buf.value))
            if hwnd not in w["iconed"]:
                w["iconed"].add(hwnd)
                for kind, handle in w["icons"].items():
                    user32.SendMessageW(hwnd, 0x80, kind, handle)  # WM_SETICON
    except Exception as ex:  # Cosmetic only: never break Blender for it.
        print("Zinarix: could not brand the window:", ex)
        return None
    return 0.4


# -----------------------------------------------------------------------------
# Menus


class ZINARIX_OT_about(bpy.types.Operator):
    """Zinarix Studio 3D and the Blender version it is built on"""

    bl_idname = "zinarix.about"
    bl_label = T["about"]

    def execute(self, _context):
        return {'FINISHED'}

    def invoke(self, context, _event):
        return context.window_manager.invoke_popup(self, width=380)

    def draw(self, _context):
        col = self.layout.column(align=True)
        col.label(text="Zinarix Studio 3D", icon='SHADING_RENDERED')
        col.separator()
        col.label(text=T["based"].format(bpy.app.version_string))
        col.label(text=T["credit"])


class ZINARIX_OT_ask_ai(bpy.types.Operator):
    """Open the Zinarix AI panel in the 3D View sidebar"""

    bl_idname = "zinarix.ask_ai"
    bl_label = T["ai"]

    def execute(self, context):
        enable_ai_addon()
        screen = context.window.screen if context.window else None
        show_ai_panel([screen] if screen else None)
        self.report({'INFO'}, T["ai_hint"])
        return {'FINISHED'}


class ZINARIX_MT_app(bpy.types.Menu):
    bl_idname = "ZINARIX_MT_app"
    bl_label = "Zinarix"
    bl_translation_context = "*"

    def draw(self, _context):
        layout = self.layout
        layout.operator("wm.splash", text=T["splash"])
        layout.operator(ZINARIX_OT_about.bl_idname, text=T["about"])
        layout.separator()
        layout.operator(ZINARIX_OT_ask_ai.bl_idname, text=T["ai"], icon='OUTLINER_DATA_LIGHTPROBE')
        layout.separator()
        layout.operator("screen.userpref_show", text=T["prefs"], icon='PREFERENCES')
        layout.menu("TOPBAR_MT_blender_system", text=T["system"])


class ZINARIX_MT_help(bpy.types.Menu):
    bl_idname = "ZINARIX_MT_help"
    bl_label = T["help"]

    def draw(self, _context):
        layout = self.layout
        layout.operator("wm.url_open_preset", text=T["manual"], icon='HELP').type = 'MANUAL'
        layout.separator()
        layout.operator(ZINARIX_OT_about.bl_idname, text=T["about"])


_icons = None


def _icon_id():
    """The Zinarix logo (icon.png next to this file) as an icon; 0 if it could not be loaded."""
    global _icons
    if _icons is None:
        from bpy.utils import previews

        _icons = previews.new()
        path = os.path.join(os.path.dirname(__file__), "icon.png")
        if os.path.isfile(path):
            try:
                _icons.load("zinarix", path, 'IMAGE')
            except (RuntimeError, KeyError):
                pass
    item = _icons.get("zinarix")
    return item.icon_id if item else 0


def draw_editor_menus(self, context):
    layout = self.layout
    if getattr(context.area, "show_menus", False):
        icon = _icon_id()
        if icon:
            layout.menu(ZINARIX_MT_app.bl_idname, text="", icon_value=icon)
        else:
            layout.menu(ZINARIX_MT_app.bl_idname, text="", icon='SHADING_RENDERED')
    else:
        layout.menu(ZINARIX_MT_app.bl_idname, text="Zinarix")
    layout.menu("TOPBAR_MT_file")
    layout.menu("TOPBAR_MT_edit")
    layout.menu("TOPBAR_MT_render")
    layout.menu("TOPBAR_MT_window")
    layout.menu(ZINARIX_MT_help.bl_idname, text=T["help"])


def _recent_files(col, rows=6):
    """Recent files (the call grew filters in 5.x; the defaults list them all). False if none."""
    if not hasattr(col, "template_recent_files"):
        return False
    try:
        return bool(col.template_recent_files(rows=rows))
    except (TypeError, RuntimeError):
        return False


def draw_splash(self, context):
    layout = self.layout
    layout.operator_context = 'EXEC_DEFAULT'
    layout.emboss = 'PULLDOWN_MENU'

    # The AI first: how to reach it.
    box = layout.box()
    row = box.row()
    row.alignment = 'CENTER'
    row.scale_y = 1.4
    hint = bpy.app.translations.pgettext_iface(AI_HINT)
    row.label(text=hint, icon='OUTLINER_DATA_LIGHTPROBE', translate=False)
    layout.separator()

    split = layout.split()

    col = split.column()
    col.label(text=T["start"])
    new = col.operator("wm.read_homefile", text=T["new"], icon='FILE_NEW')
    new.app_template = "Zinarix"
    empty = col.operator("wm.read_homefile", text=T["empty"], icon='FILE')
    empty.app_template = "Zinarix"
    if hasattr(empty, "use_empty"):
        empty.use_empty = True
    col.separator()
    sub = col.column()
    sub.operator_context = 'INVOKE_DEFAULT'
    sub.operator("wm.open_mainfile", text=T["open"], icon='FILE_FOLDER')
    col.operator("wm.recover_last_session", text=T["recover"], icon='RECOVER_LAST')

    col = split.column()
    col.label(text=T["recent"])
    if not _recent_files(col):
        col.label(text=T["no_recent"])

    layout.separator()
    row = layout.row()
    row.operator(ZINARIX_OT_ask_ai.bl_idname, text=T["ai"], icon='OUTLINER_DATA_LIGHTPROBE')
    sub = row.row()
    sub.operator_context = 'INVOKE_DEFAULT'
    sub.operator("screen.userpref_show", text=T["prefs"], icon='PREFERENCES')
    layout.separator()


def draw_quick_setup(self, context):
    """First run: language and mouse only (no Blender themes, keymaps or "import from Blender")."""
    layout = self.layout
    layout.operator_context = 'EXEC_DEFAULT'
    layout.label(text="Zinarix Studio 3D")
    split = layout.split(factor=0.20)
    split.label()
    col = split.split(factor=0.73).column()
    col.use_property_split = True
    col.use_property_decorate = False
    if bpy.app.build_options.international:
        col.prop(context.preferences.view, "language")
    keyconfig = context.window_manager.keyconfigs.active
    kc_prefs = getattr(keyconfig, "preferences", None) if keyconfig else None
    if kc_prefs is not None and hasattr(kc_prefs, "select_mouse"):
        col.row().prop(kc_prefs, "select_mouse", expand=True)
    if kc_prefs is not None and hasattr(kc_prefs, "spacebar_action"):
        col.row().prop(kc_prefs, "spacebar_action")
    sub = col.column()
    sub.separator(factor=2)
    sub.operator("wm.save_userpref", text=T["continue"])
    layout.separator(factor=2.0)


_saved = {}


def _patch(cls_name, func):
    cls = getattr(bpy.types, cls_name, None)
    if cls is None or cls_name in _saved:
        return
    _saved[cls_name] = cls.draw
    cls.draw = func


def _unpatch():
    for name, draw in _saved.items():
        cls = getattr(bpy.types, name, None)
        if cls is not None:
            cls.draw = draw
    _saved.clear()


# -----------------------------------------------------------------------------
# Startup file


def _layout_screens():
    names = {"Layout", WORKSPACES["Layout"][LANG]}
    return [scr for ws in bpy.data.workspaces if ws.name in names for scr in ws.screens]


def show_ai_panel(screens=None):
    """Opens the 3D View sidebar on the "Zinarix" tab (main workspace unless screens are given)."""
    if screens is None:
        screens = _layout_screens() or list(bpy.data.screens)
    for scr in screens:
        for area in scr.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            if hasattr(space, "show_region_ui"):
                space.show_region_ui = True
            for region in area.regions:
                if region.type == 'UI' and hasattr(region, "active_panel_category"):
                    try:
                        region.active_panel_category = AI_TAB
                    except (AttributeError, TypeError, ValueError):
                        pass  # The tab appears once the sidebar was drawn: retried later.
            area.tag_redraw()


def tidy_workspaces():
    """Keeps the useful workspaces, renamed; works on new files only (never on the user's)."""
    keep = set(WORKSPACES) | {names[LANG] for names in WORKSPACES.values()}
    if not any(ws.name in keep for ws in bpy.data.workspaces):
        return  # Not Blender's default startup: leave it alone.
    first = next(ws for ws in bpy.data.workspaces if ws.name in keep)
    for window in bpy.context.window_manager.windows:
        if window.workspace.name not in keep:
            window.workspace = first
    drop = [ws for ws in bpy.data.workspaces if ws.name not in keep]
    if drop:
        try:
            bpy.data.batch_remove(ids=drop)
        except (RuntimeError, TypeError) as ex:
            print("Zinarix: could not remove workspaces:", ex)
    for old, names in WORKSPACES.items():
        ws = bpy.data.workspaces.get(old)
        if ws is not None:
            ws.name = names[LANG]


def simplify_screens(screens=None):
    """Less of Blender's chrome on new files: no status bar, no tool settings row, viewport menus
    folded into one button, no corner text (view name, object) and no 3D cursor."""
    for scr in screens if screens is not None else bpy.data.screens:
        _set(scr, "show_statusbar", False)
        for area in scr.areas:
            if area.type != 'VIEW_3D':
                continue
            _set(area, "show_menus", False)
            space = area.spaces.active
            _set(space, "show_region_tool_header", False)
            overlay = getattr(space, "overlay", None)
            _set(overlay, "show_text", False)
            _set(overlay, "show_stats", False)
            _set(overlay, "show_cursor", False)
            area.tag_redraw()


def enable_ai_addon():
    """Enables ``zinarix_ai`` and keeps it in the preferences. True if it is enabled."""
    import addon_utils

    if AI_ADDON in bpy.context.preferences.addons:
        return True
    try:
        mod = addon_utils.enable(AI_ADDON, default_set=True, handle_error=_addon_error)
    except Exception as ex:  # Never block startup because of the add-on.
        _addon_error(ex)
        mod = None
    return mod is not None


def _addon_error(ex):
    print("Zinarix: could not enable {:s}: {!s}".format(AI_ADDON, ex))


# -----------------------------------------------------------------------------
# Startup

_started = False
_timers = []


def _timer(func, delay):
    """A timer that survives file loads; unregister() removes it."""
    if not bpy.app.timers.is_registered(func):
        bpy.app.timers.register(func, first_interval=delay, persistent=True)
    if func not in _timers:
        _timers.append(func)


def startup():
    """Once per session: first start setup, AI add-on, theme. Never raises."""
    global _started
    if _started:
        return
    _started = True
    for step in (first_start_setup, enable_ai_addon, ai_acts_alone, apply_theme):
        try:
            step()
        except Exception as ex:
            print("Zinarix: {:s} failed: {!s}".format(step.__name__, ex))


def _on_new_file():
    try:
        tidy_workspaces()
        simplify_screens()
        show_ai_panel()
    except Exception as ex:
        print("Zinarix: could not set up the new file:", ex)
    if not bpy.app.background:
        # The sidebar only knows its tabs after it has been drawn once: pick "Zinarix" again then.
        _timer(_show_ai_later, 0.5)
    return None


def _show_ai_later():
    try:
        show_ai_panel()
    except Exception:
        pass
    return None


def _first_tick():
    startup()
    if not bpy.data.filepath:
        _on_new_file()
    return None


@persistent
def load_post(_):
    startup()


@persistent
def load_factory_startup_post(_):
    startup()
    if bpy.app.background:
        _on_new_file()
    else:
        # Window operators need the window manager to be ready: run on the next tick.
        _timer(_on_new_file, 0.01)


_handlers = (
    ("load_post", load_post),
    ("load_factory_startup_post", load_factory_startup_post),
)


# -----------------------------------------------------------------------------
# Registration

classes = (ZINARIX_OT_about, ZINARIX_OT_ask_ai, ZINARIX_MT_app, ZINARIX_MT_help)


def register():
    global _started
    _started = False
    for cls in classes:
        bpy.utils.register_class(cls)
    try:
        bpy.app.translations.unregister(__name__)  # Left over from an earlier register().
    except Exception:
        pass
    try:
        bpy.app.translations.register(__name__, TRANSLATIONS)
    except Exception as ex:  # Translations are never worth breaking startup for.
        print("Zinarix: translations not registered:", ex)
    _patch("TOPBAR_MT_editor_menus", draw_editor_menus)
    _patch("WM_MT_splash", draw_splash)
    _patch("WM_MT_splash_quick_setup", draw_quick_setup)
    for name, func in _handlers:
        handlers = getattr(bpy.app.handlers, name)
        if func not in handlers:
            handlers.append(func)
    if not bpy.app.background:
        _timer(_first_tick, 0.05)
        if sys.platform == "win32":
            _timer(_brand_windows, 0.01)


def unregister():
    """Puts back everything register() changed in Blender's UI."""
    for func in _timers:
        if bpy.app.timers.is_registered(func):
            bpy.app.timers.unregister(func)
    _timers.clear()
    for name, func in _handlers:
        handlers = getattr(bpy.app.handlers, name)
        while func in handlers:
            handlers.remove(func)
    _unpatch()
    try:
        bpy.app.translations.unregister(__name__)
    except Exception:
        pass
    global _icons
    if _icons is not None:
        # "import bpy.utils.previews" here would make bpy a local name of this function.
        from bpy.utils import previews

        previews.remove(_icons)
        _icons = None
    for cls in reversed(classes):
        if getattr(cls, "is_registered", True):
            bpy.utils.unregister_class(cls)
