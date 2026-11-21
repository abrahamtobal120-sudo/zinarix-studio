/**
 * Fase 7: structured Blender edits (blender_model). Validation always runs; the real Blender
 * part is skipped unless Blender 3.6+ is found (ZINARIX_BLENDER points to a portable build).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BlenderModelService, blenderFailure } from '../src/main/blenderModel.js';
import { Scene3DService } from '../src/main/scene3d.js';
import { describeBlenderOps, describeBlenderReport, validateBlenderOps } from '../src/shared/blenderOps.js';
import { analyzeMesh, checkPrint, parseStl } from '../src/shared/mesh3d.js';
import { runCadTool } from '../src/main/cadTools.js';

const dir = mkdtempSync(join(tmpdir(), 'zs-bmodel-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const inside = (p: string) => {
  if (/^[a-z]:|^\//i.test(p) || p.includes('..')) throw new Error(`outside the project: ${p}`);
  return join(dir, p);
};

describe('validateBlenderOps', () => {
  it('normalises good ops and resolves paths', () => {
    const ops = validateBlenderOps(
      [
        { op: 'add', type: 'cube', name: 'Caja', size: 2, location: [0, 0, 1] },
        { op: 'modifier', object: 'Caja', type: 'bevel', settings: { width: 0.1, segments: 3, limit: 'angle' } },
        { op: 'material', object: 'Caja', color: '#ff0000', metallic: 1 },
        { op: 'export', path: 'out/caja.stl', scale: 1000 },
      ],
      inside,
    );
    expect(ops[1]!.settings).toEqual({ width: 0.1, segments: 3, limit: 'ANGLE' });
    expect((ops[2]!.color as number[])[0]).toBeCloseTo(1);
    expect((ops[2]!.color as number[])[1]).toBe(0);
    expect(ops[3]!.path).toBe(join(dir, 'out/caja.stl'));
    expect(ops[3]!.apply_modifiers).toBe(true);
    expect(describeBlenderOps(ops)).toContain('modificador bevel en "Caja"');
  });

  it('refuses unknown ops, settings and paths outside', () => {
    expect(() => validateBlenderOps([{ op: 'python', code: 'x' }], inside)).toThrow(/unknown op/);
    expect(() =>
      validateBlenderOps([{ op: 'modifier', object: 'A', type: 'bevel', settings: { exec: 1 } }], inside),
    ).toThrow(/no setting "exec"/);
    expect(() => validateBlenderOps([{ op: 'modifier', object: 'A', type: 'boolean' }], inside)).toThrow(/cutter/);
    expect(() => validateBlenderOps([{ op: 'export', path: '../x.stl' }], inside)).toThrow(/outside/);
    expect(() => validateBlenderOps([{ op: 'export', path: 'x.exe' }], inside)).toThrow(/exports/);
    expect(() => validateBlenderOps([{ op: 'add', type: 'cube', name: 'a"b' }], inside)).toThrow(/name/);
    expect(() => validateBlenderOps([{ op: 'material', object: 'A', color: 'red' }], inside)).toThrow(/#rrggbb/);
    expect(() => validateBlenderOps([], inside)).toThrow(/non-empty/);
  });

  it('reads the runner error line', () => {
    expect(blenderFailure('foo\nZINARIX_ERROR op #2 (modifier): no object "X"\nBlender quit')).toBe('op #2 (modifier): no object "X"');
  });
});

const scene3d = new Scene3DService(dir, () => null);
const blender = await scene3d.findBlender();

describe.skipIf(!blender)('blender_model with a real Blender', () => {
  const svc = new BlenderModelService(() => scene3d.findBlender());
  const blend = join(dir, 'modelo.blend');

  it('models, textures, unwraps, exports and saves', async () => {
    const ops = validateBlenderOps(
      [
        { op: 'add', type: 'cube', name: 'Caja', size: 0.04, location: [0, 0, 0.02] },
        { op: 'add', type: 'cylinder', name: 'Hueco', size: 0.02, location: [0, 0, 0.03], scale: [1, 1, 3] },
        { op: 'modifier', object: 'Caja', type: 'boolean', settings: { operation: 'difference', object: 'Hueco' } },
        { op: 'modifier', object: 'Caja', type: 'bevel', settings: { width: 0.002, segments: 2 } },
        { op: 'apply', object: 'Caja' },
        { op: 'delete', object: 'Hueco' },
        { op: 'material', object: 'Caja', name: 'Naranja', color: '#f08020', roughness: 0.4 },
        { op: 'uv', object: 'Caja', method: 'smart' },
        { op: 'shade', object: 'Caja', smooth: true, angle: 30 },
        { op: 'export', path: 'caja.stl', scale: 1000 },
        { op: 'export', path: 'caja.glb' },
      ],
      inside,
    );
    const r = await svc.run({ fresh: true, ops, save: blend, preview: true, previewSize: 256 });
    const caja = r.report.objects.find((o) => o.name === 'Caja')!;
    // Applied: only Blender 4.1+'s "Smooth by Angle" (from shade angle) is left.
    expect(caja.modifiers!.filter((m) => m.type !== 'NODES')).toEqual([]);
    expect(caja.materials).toEqual(['Naranja']);
    expect(caja.uv!.length).toBe(1);
    expect(r.report.objects.some((o) => o.name === 'Hueco')).toBe(false);
    expect(r.preview?.subarray(1, 4).toString()).toBe('PNG');
    expect(existsSync(blend)).toBe(true);
    expect(existsSync(join(dir, 'caja.glb'))).toBe(true);
    // 40 mm cube with a hole through it: watertight, in mm thanks to scale 1000.
    const mesh = analyzeMesh(parseStl(readFileSync(join(dir, 'caja.stl'))));
    expect(mesh.bounds.size[0]).toBeCloseTo(40, 0);
    expect(mesh.watertight).toBe(true);
    expect(checkPrint(mesh).ok).toBe(true);
    expect(describeBlenderReport(r.report)).toContain('"Caja" MESH');
  }, 120_000);

  it('opens the saved file, and a failing op saves nothing', async () => {
    const before = readFileSync(blend);
    await expect(
      svc.run({
        input: blend,
        ops: validateBlenderOps([{ op: 'modifier', object: 'NoExiste', type: 'subsurf' }], inside),
        save: blend,
      }),
    ).rejects.toThrow(/op #1 \(modifier\): no object "NoExiste"/);
    expect(readFileSync(blend).equals(before)).toBe(true);
    const r = await svc.run({ input: blend, ops: validateBlenderOps([{ op: 'modifier', object: 'Caja', type: 'subsurf', settings: { levels: 1 } }], inside) });
    expect(r.report.objects.find((o) => o.name === 'Caja')!.modifiers).toContainEqual({ name: 'Subsurf', type: 'SUBSURF' });
  }, 120_000);

  it('the agent tools drive the real Blender (inspect, then model and export for printing)', async () => {
    const signal = new AbortController().signal;
    const made = await runCadTool(
      undefined,
      svc,
      'blender_model',
      {
        path: 'arte/llavero.blend',
        ops: [
          { op: 'add', type: 'torus', name: 'Aro', size: 0.03, location: [0, 0, 0.005] },
          { op: 'material', object: 'Aro', color: '#2080ff', metallic: 0.8 },
          { op: 'export', path: 'arte/aro.stl', scale: 1000 },
        ],
      },
      dir,
      signal,
    );
    expect(made.ok).toBe(true);
    expect(made.content).toContain('Saved: arte/llavero.blend');
    expect(made.content).toContain('Print check of arte/aro.stl');
    expect(made.content).toContain('watertight');
    expect(made.image?.mediaType).toBe('image/png');
    const seen = await runCadTool(undefined, svc, 'blender_inspect', { path: 'arte/llavero.blend' }, dir, signal);
    expect(seen.ok).toBe(true);
    expect(seen.content).toMatch(/"Aro" MESH .* materials: Material|"Aro" MESH .* materials: Aro material/);
  }, 120_000);

  it('imports a mesh file as input', async () => {
    const r = await svc.run({ input: join(dir, 'caja.glb'), ops: validateBlenderOps([{ op: 'rename', object: 'Caja', name: 'Importada' }], inside) });
    expect(r.report.objects.map((o) => o.name)).toContain('Importada');
  }, 120_000);
});
