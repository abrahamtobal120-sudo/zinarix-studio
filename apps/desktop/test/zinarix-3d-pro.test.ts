/**
 * Zinarix 3D Pro: the "Zinarix" app template loaded by a real Blender (4.2+). Skipped unless
 * Blender is found (installed, on PATH, or named by ZINARIX_BLENDER, e.g. a portable build).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Scene3DService } from '../src/main/scene3d.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const scripts = join(appRoot, 'blender', 'scripts');
const dir = mkdtempSync(join(tmpdir(), 'z3dpro-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const svc = new Scene3DService(dir, () => null);
const blender = await svc.findBlender();
const [major = 0, minor = 0] = (blender?.version ?? '0.0').split('.').map(Number);
const recent = major > 4 || (major === 4 && minor >= 2);

const CHECK = String.raw`
import sys, json, bpy, addon_utils
tpl = next(m for m in list(sys.modules.values()) if getattr(m, "__file__", None) and "bl_app_templates_system" in m.__file__ and "Zinarix" in m.__file__)
out = {}
out["menu"] = hasattr(bpy.types, "ZINARIX_MT_app")
out["topbar"] = bpy.types.TOPBAR_MT_editor_menus.draw.__name__
out["splash"] = bpy.types.WM_MT_splash.draw.__name__
out["setup"] = bpy.types.WM_MT_splash_quick_setup.draw.__name__
tpl.apply_theme()
th = bpy.context.preferences.themes[0]
a = tuple(round(c, 4) for c in th.user_interface.wcol_regular.inner_sel)
tpl.apply_theme()
b = tuple(round(c, 4) for c in th.user_interface.wcol_regular.inner_sel)
out["themeStable"] = a == b
import colorsys
out["accentHue"] = round(colorsys.rgb_to_hsv(*a[:3])[0], 2)
out["panelValue"] = round(max(th.user_interface.wcol_regular.inner[:3]), 2)
out["statusVersion"] = bpy.context.preferences.view.show_statusbar_version
out["roundness"] = round(th.user_interface.wcol_regular.roundness, 2)
out["miniAxis"] = bpy.context.preferences.view.mini_axis_type
out["viewportBg"] = th.view_3d.space.gradients.background_type
tpl.tidy_workspaces()
out["workspaces"] = sorted(ws.name for ws in bpy.data.workspaces)
p = bpy.context.preferences
out["lang"] = p.view.language
out["newDataEnglish"] = not p.view.use_translate_new_dataname
out["autosave"] = p.filepaths.use_auto_save_temporary_files
out["addonByTemplate"] = "zinarix_ai" in p.addons
out["sidebar"] = [a.spaces.active.show_region_ui for s in tpl._layout_screens() for a in s.areas if a.type == 'VIEW_3D']
tpl.simplify_screens()
v3d = [a for s in tpl._layout_screens() for a in s.areas if a.type == 'VIEW_3D']
out["plain"] = [s.show_statusbar for s in tpl._layout_screens()] + [a.show_menus or a.spaces.active.overlay.show_text for a in v3d]
addon_utils.enable("zinarix_ai", default_set=True)
out["ai"] = hasattr(bpy.types, "VIEW3D_PT_zinarix_ai")
tpl.ai_acts_alone()
ai = sys.modules["zinarix_ai"]
out["autoRun"] = p.addons["zinarix_ai"].preferences.auto_run
# A reply of the AI that moves the cube runs at once, with no approval.
fence = chr(96) * 3
nl = chr(10)
ai._on_reply(bpy.context, nl.join(("Moving it.", fence + "python", "import bpy", "bpy.data.objects['Cube'].location.x = 3", fence)))
out["aiMoved"] = bpy.data.objects["Cube"].location.x
out["aiPending"] = ai._state.pending is not None
ai._stop()
print("ZXJSON" + json.dumps(out))
`;

describe.skipIf(!blender || !recent)('Zinarix 3D Pro template', () => {
  it('dresses Blender: menus, splash, violet theme, plain screens, AI that acts', () => {
    const r = spawnSync(
      blender!.path,
      [
        '-b',
        '--factory-startup',
        '--app-template',
        'Zinarix',
        '--python-exit-code',
        '1',
        '--python-expr',
        CHECK,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          BLENDER_SYSTEM_SCRIPTS: scripts,
          BLENDER_USER_RESOURCES: join(dir, 'res'),
          ZINARIX_LANG: 'es',
        },
      },
    );
    const line = (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('ZXJSON'));
    expect(line, r.stdout + r.stderr).toBeTruthy();
    const out = JSON.parse(line!.slice(6));
    expect(out).toMatchObject({
      menu: true,
      topbar: 'draw_editor_menus',
      splash: 'draw_splash',
      setup: 'draw_quick_setup',
      themeStable: true,
      ai: true,
      lang: expect.stringMatching(/^es/),
      newDataEnglish: true,
      autosave: true,
      addonByTemplate: true,
      sidebar: [true],
      roundness: 0.55,
      miniAxis: 'MINIMAL',
      viewportBg: 'RADIAL',
      plain: [false, false],
      autoRun: true,
      aiMoved: 3,
      aiPending: false,
    });
    expect(r.stderr).not.toMatch(/Traceback/);
    expect(out.accentHue).toBeCloseTo(0.68, 1);
    expect(out.panelValue).toBeLessThan(0.45);
    expect(out.workspaces).toEqual(
      ['Animación', 'Escena', 'Escultura', 'Materiales', 'Modelado', 'Render'].sort(),
    );
  }, 150_000);

  it('follows a light app theme: light panels, the app accent', () => {
    const r = spawnSync(
      blender!.path,
      [
        '-b',
        '--factory-startup',
        '--app-template',
        'Zinarix',
        '--python-exit-code',
        '1',
        '--python-expr',
        CHECK,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          BLENDER_SYSTEM_SCRIPTS: scripts,
          BLENDER_USER_RESOURCES: join(dir, 'res-light'),
          ZINARIX_LANG: 'es',
          ZINARIX_LOOK: JSON.stringify({
            dark: false,
            bg: '#ffffff',
            fg: '#2b2b31',
            accent: '#5b4cf0',
          }),
        },
      },
    );
    const line = (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('ZXJSON'));
    expect(line, r.stdout + r.stderr).toBeTruthy();
    const out = JSON.parse(line!.slice(6));
    expect(out.themeStable).toBe(true);
    expect(out.statusVersion).toBe(false);
    expect(out.panelValue).toBeGreaterThan(0.6);
    expect(out.accentHue).toBeCloseTo(0.68, 1);
  }, 150_000);

  it('sets the language on the first start only, never over the user choice', () => {
    // Launched like openPro (no --factory-startup), sharing one user folder across runs.
    const run = (lang: string, expr: string) => {
      const r = spawnSync(
        blender!.path,
        ['-b', '--app-template', 'Zinarix', '--python-exit-code', '1', '--python-expr', expr],
        {
          encoding: 'utf8',
          timeout: 120_000,
          env: {
            ...process.env,
            BLENDER_SYSTEM_SCRIPTS: scripts,
            BLENDER_USER_RESOURCES: join(dir, 'res-first'),
            ZINARIX_LANG: lang,
          },
        },
      );
      expect(r.stderr, r.stdout + r.stderr).not.toMatch(/Traceback/);
      const line = (r.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('ZXLANG'));
      expect(line, r.stdout + r.stderr).toBeTruthy();
      return line!.slice(6).trim();
    };
    const show =
      'import bpy; p = bpy.context.preferences; print("ZXLANG", p.view.language, "zinarix_ai" in p.addons)';
    // First start in Spanish; the user then picks British English and saves.
    expect(run('es', `${show}; p.view.language = "en_GB"; bpy.ops.wm.save_userpref()`)).toMatch(
      /^es\S* True$/,
    );
    expect(run('es', show)).toBe('en_GB True');
    expect(run('en', show)).toBe('en_GB True');
  }, 300_000);

  it('refuses to open without the template folder', async () => {
    await expect(svc.openPro(join(dir, 'nothing'), 'es')).rejects.toThrow(/plantilla/);
  });
});
