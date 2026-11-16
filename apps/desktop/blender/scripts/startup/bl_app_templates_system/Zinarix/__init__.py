# SPDX-FileCopyrightText: 2026 Zinarix Studio
#
# SPDX-License-Identifier: GPL-2.0-or-later

"""Zinarix Studio 3D: the face Zinarix puts on Blender.

An application template (no rebuild needed). Zinarix Studio launches Blender with
``--app-template Zinarix`` and ``BLENDER_SYSTEM_SCRIPTS`` pointing at the folder
that holds this template and the ``zinarix_ai`` add-on. Blender keeps the
preferences of a template apart, so a normal Blender on the same PC is untouched.

What it changes:
- Theme: Zinarix colors (violet accent, neutral dark grays) over the default theme.
- Top bar: a "Zinarix" menu instead of the Blender one, and fewer menus.
- Splash: Zinarix image and its own quick start.
- Workspaces: only the useful ones, with names in the user's language.
- The Zinarix AI panel is open in the 3D View sidebar.

``ZINARIX_LANG`` ("es" or "en") picks the interface language.
"""

import colorsys
import os

import bpy
from bpy.app.handlers import persistent

LANG = "en" if os.environ.get("ZINARIX_LANG", "es").lower().startswith("en") else "es"

# Zinarix Studio's own palette (apps/desktop/src/renderer/ui/tokens.css).
ACCENT_HUE = 0.684  # #6d5ef6
GRAY_HUE = 0.70
GRAY_SAT = 0.14

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
        "recent": "Recientes",
        "start": "Empezar",
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
        "recent": "Recent",
        "start": "Start",
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


# -----------------------------------------------------------------------------
# Theme


def _tint(color):
    """Blender's blue/orange highlights become the Zinarix violet; grays get a faint violet cast."""
    rgb = tuple(color[:3])
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    if s < 0.12:
        if v <= 0.02 or v >= 0.98:
            return None
        # Dark surfaces get darker and cooler, like the Zinarix app (#1b1b1f); text stays neutral.
        s2 = GRAY_SAT * max(0.0, 1.0 - max(0.0, v - 0.45) * 2.0)
        v2 = v * 0.8 if v < 0.45 else v
        return colorsys.hsv_to_rgb(GRAY_HUE, s2, v2)
    # Blender's accents: the selection blue (~0.6) and the active orange (~0.08).
    if 0.53 <= h <= 0.66 or 0.04 <= h <= 0.13:
        return colorsys.hsv_to_rgb(ACCENT_HUE, max(s, 0.55), max(v, 0.45))
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


def apply_theme():
    """Starts from Blender's default theme every time, so applying twice changes nothing."""
    try:
        bpy.ops.preferences.reset_default_theme()
    except RuntimeError as ex:
        print("Zinarix: could not reset the theme:", ex)
        return
    _walk_theme(bpy.context.preferences.themes[0], set())


def apply_language():
    view = bpy.context.preferences.view
    try:
        view.language = 'es' if LANG == "es" else 'en_US'
        view.use_translate_interface = True
        view.use_translate_tooltips = True
        view.use_translate_new_dataname = False
    except (TypeError, AttributeError) as ex:
        print("Zinarix: could not set the language:", ex)


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
        show_ai_panel(context.window.screen if context.window else None)
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
        import bpy.utils.previews

        _icons = bpy.utils.previews.new()
        path = os.path.join(os.path.dirname(__file__), "icon.png")
        if os.path.isfile(path):
            _icons.load("zinarix", path, 'IMAGE')
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


def draw_splash(self, context):
    layout = self.layout
    layout.operator_context = 'EXEC_DEFAULT'
    layout.emboss = 'PULLDOWN_MENU'
    split = layout.split()

    col = split.column()
    col.label(text=T["start"])
    col.operator("wm.read_homefile", text=T["new"], icon='FILE_NEW').app_template = "Zinarix"
    col.operator_context = 'INVOKE_DEFAULT'
    col.operator("wm.open_mainfile", text=T["open"], icon='FILE_FOLDER')
    col.operator("wm.recover_last_session", text=T["recover"], icon='RECOVER_LAST')
    col.separator()
    col.operator(ZINARIX_OT_ask_ai.bl_idname, text=T["ai"], icon='OUTLINER_DATA_LIGHTPROBE')

    col = split.column()
    col.label(text=T["recent"])
    col.menu_contents("TOPBAR_MT_file_open_recent")
    layout.separator(factor=2.0)


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
    kc_prefs = context.window_manager.keyconfigs.active.preferences
    if hasattr(kc_prefs, "select_mouse"):
        col.row().prop(kc_prefs, "select_mouse", expand=True)
    if hasattr(kc_prefs, "spacebar_action"):
        col.row().prop(kc_prefs, "spacebar_action")
    sub = col.column()
    sub.separator(factor=2)
    sub.operator("wm.save_userpref", text=T["continue"])
    layout.separator(factor=2.0)


_saved = {}


def _patch(cls_name, func):
    cls = getattr(bpy.types, cls_name, None)
    if cls is None:
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


def show_ai_panel(screen=None):
    screens = [screen] if screen else bpy.data.screens
    for scr in screens:
        for area in scr.areas:
            if area.type != 'VIEW_3D':
                continue
            area.spaces.active.show_region_ui = True
            for region in area.regions:
                if region.type == 'UI':
                    try:
                        region.active_panel_category = "Zinarix"
                    except (AttributeError, TypeError, ValueError):
                        pass
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


def _on_new_file():
    tidy_workspaces()
    show_ai_panel()
    # The sidebar only knows its tabs after it has been drawn once: pick "Zinarix" again then.
    bpy.app.timers.register(_show_ai_later, first_interval=0.5)
    return None


def _show_ai_later():
    show_ai_panel()
    return None


@persistent
def load_factory_startup_post(_):
    # Window operators need the window manager to be ready: run on the next tick.
    bpy.app.timers.register(_on_new_file, first_interval=0.01)


def enable_ai_addon():
    import addon_utils

    if "zinarix_ai" in bpy.context.preferences.addons:
        return
    try:
        bpy.utils.refresh_script_paths()
        addon_utils.modules_refresh()
        addon_utils.enable("zinarix_ai", default_set=True, persistent=True)
    except Exception as ex:  # Never block startup because of the add-on.
        print("Zinarix: could not enable zinarix_ai:", ex)


def _first_tick():
    enable_ai_addon()
    apply_language()
    apply_theme()
    if not bpy.data.filepath:
        _on_new_file()
    return None


# -----------------------------------------------------------------------------
# Registration

classes = (ZINARIX_OT_about, ZINARIX_OT_ask_ai, ZINARIX_MT_app, ZINARIX_MT_help)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    _patch("TOPBAR_MT_editor_menus", draw_editor_menus)
    _patch("WM_MT_splash", draw_splash)
    _patch("WM_MT_splash_quick_setup", draw_quick_setup)
    bpy.app.handlers.load_factory_startup_post.append(load_factory_startup_post)
    if not bpy.app.background:
        bpy.app.timers.register(_first_tick, first_interval=0.05)


def unregister():
    if load_factory_startup_post in bpy.app.handlers.load_factory_startup_post:
        bpy.app.handlers.load_factory_startup_post.remove(load_factory_startup_post)
    _unpatch()
    global _icons
    if _icons is not None:
        import bpy.utils.previews

        bpy.utils.previews.remove(_icons)
        _icons = None
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
