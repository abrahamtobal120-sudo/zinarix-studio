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
tpl.tidy_workspaces()
out["workspaces"] = sorted(ws.name for ws in bpy.data.workspaces)
addon_utils.enable("zinarix_ai", default_set=True)
out["ai"] = hasattr(bpy.types, "VIEW3D_PT_zinarix_ai")
print("ZXJSON" + json.dumps(out))
`;

describe.skipIf(!blender || !recent)('Zinarix 3D Pro template', () => {
  it('dresses Blender: menus, splash, violet theme, workspaces, AI panel', () => {
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
    });
    expect(out.accentHue).toBeCloseTo(0.68, 1);
    expect(out.workspaces).toEqual(
      ['Animación', 'Escena', 'Escultura', 'Materiales', 'Modelado', 'Render'].sort(),
    );
  }, 150_000);

  it('refuses to open without the template folder', async () => {
    await expect(svc.openPro(join(dir, 'nothing'), 'es')).rejects.toThrow(/plantilla/);
  });
});
