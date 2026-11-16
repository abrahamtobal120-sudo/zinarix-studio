/**
 * Fase 14 with a real Blender. Skipped unless Blender 3.6+ is found (installed, on PATH, or
 * named by ZINARIX_BLENDER, e.g. a portable build): it takes about a minute.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findFfmpeg, VideoService } from '../src/main/video.js';
import { Scene3DService } from '../src/main/scene3d.js';
import {
  fromTemplate,
  makeModel,
  newScene,
  sanitizeScene,
  studioLights,
} from '../src/shared/scene3d.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'z3db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const svc = new Scene3DService(dir, () => tools.ffmpeg);
const blender = tools.ffmpeg ? await svc.findBlender() : null;

/** RGBA of every decoded frame (libvpx keeps the alpha). */
function frames(path: string, w: number, h: number): Uint8Array[] {
  const r = spawnSync(
    tools.ffmpeg!,
    ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1 << 28 },
  );
  const buf = new Uint8Array(r.stdout);
  const size = w * h * 4;
  return Array.from({ length: Math.floor(buf.length / size) }, (_, i) =>
    buf.subarray(i * size, (i + 1) * size),
  );
}
const opaque = (f: Uint8Array) => {
  let n = 0;
  for (let i = 3; i < f.length; i += 4) if (f[i]! > 128) n++;
  return n;
};

describe.skipIf(!blender)('Fase 14 with Blender', () => {
  const W = 320;
  const H = 180;

  it('renders the turning logo to a WebM with alpha, with the curve baked in', async () => {
    const s = sanitizeScene(
      fromTemplate('logo', { text: 'Zx', duration: 1, width: W, height: H, fps: 12 }),
    );
    const logo = s.nodes.find((n) => n.shape === 'text')!;
    logo.keys = {
      ry: [
        { t: 0, v: 0, ease: 'back' },
        { t: 1, v: 360 },
      ],
    };
    const progress: number[] = [];
    const r = await svc.renderWithBlender(
      s,
      { engine: 'eevee', format: 'webm', name: 'logo-blender', samples: 4 },
      dir,
      (k) => progress.push(k),
    );
    expect(r.frames).toBe(12);
    expect(r.path).toMatch(/media[\\/]3d[\\/]logo-blender-.+\.webm$/);
    const m = await new VideoService(appRoot, dir, () => undefined).probe(r.path);
    expect(m.alpha).toBe('vp9');
    expect(m.width).toBe(W);
    const f = frames(r.path, W, H);
    expect(f.length).toBe(12);
    // Transparent around, the logo in the middle of the first frame (facing the camera).
    expect(f[0]![3]).toBeLessThan(10);
    expect(opaque(f[0]!)).toBeGreaterThan(W * H * 0.005);
    // The text turns: its silhouette changes over the second.
    const sizes = f.map(opaque);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(W * H * 0.003);
    expect(progress.length).toBeGreaterThan(0);
  }, 300_000);

  it.each(['eevee', 'cycles'] as const)(
    '%s: an opaque render shows the background colour, not the ambient light',
    async (engine) => {
      const s = sanitizeScene(
        fromTemplate('logo', { duration: 0.25, width: W, height: H, fps: 12, transparent: false }),
      );
      expect(s.background).toBe('#101318');
      const r = await svc.renderWithBlender(
        s,
        { engine, format: 'mp4', name: `fondo-${engine}`, samples: 4 },
        dir,
      );
      const px = spawnSync(
        tools.ffmpeg!,
        ['-v', 'error', '-i', r.path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: 1 << 26 },
      ).stdout as Buffer;
      // Corner pixel: dark blue-grey (AgX and the encoder move it a little), not the grey of the
      // white ambient light the world used to show.
      expect(Math.max(px[0]!, px[1]!, px[2]!)).toBeLessThan(45);
    },
    300_000,
  );

  it('blender_script output (a GLB) opens as a model in a Blender render', async () => {
    const r = await svc.runScript(
      [
        'import bpy, os',
        'bpy.ops.wm.read_factory_settings(use_empty=True)',
        'bpy.ops.mesh.primitive_monkey_add()',
        "bpy.ops.export_scene.gltf(filepath=os.path.join(os.environ['ZINARIX_OUT'], 'mono.glb'))",
      ].join('\n'),
      { fps: 12, format: 'mp4', name: 'mono' },
      dir,
    );
    const glb = r.paths.find((p) => p.endsWith('.glb'));
    expect(glb, r.log).toBeTruthy();

    const s = newScene({ width: W, height: H, fps: 12, duration: 0.5, nodes: studioLights() });
    s.nodes.push(
      makeModel(glb!, {
        keys: {
          ry: [
            { t: 0, v: 0 },
            { t: 0.5, v: 90 },
          ],
        },
      }),
    );
    const out = await svc.renderWithBlender(
      sanitizeScene(s),
      { engine: 'eevee', format: 'webm', name: 'mono', samples: 4 },
      dir,
    );
    const f = frames(out.path, W, H);
    expect(f.length).toBe(6);
    expect(opaque(f[0]!)).toBeGreaterThan(W * H * 0.02);
  }, 300_000);
});
